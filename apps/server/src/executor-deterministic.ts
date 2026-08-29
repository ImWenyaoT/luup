import { EvidenceLedger, type EvidenceCitation } from "./agent/evidence.ts";
import type { Research } from "./agent/contracts.ts";
import { reportStructuredOutput } from "./agent/roles/structured-output.ts";
import type { StageExecutor } from "./roles.ts";
import type { SqliteStore } from "./store/store.ts";
import { createReferenceVerifier, type ReferenceVerifier } from "./verify/verifier.ts";

/** 写死的检索结果。五条而不是一条，是因为终局引用验收要求 references ≥5（B3）——
 *  确定性运行时必须能走完包括验收在内的整条流水线，否则它验证不了自己声称验证的东西。
 *  元数据取自真实论文，反查替身直接照抄它们，所以 B2/B4 在离线状态下也是真的在比对。 */
const SOURCES: EvidenceCitation[] = [
  {
    source_type: "arxiv",
    title: "Ragas: Automated Evaluation of Retrieval Augmented Generation",
    locator: "arxiv:2309.15217v2",
    url: "https://arxiv.org/abs/2309.15217v2",
    authors: ["Shahul Es", "Jithin James", "Luis Espinosa-Anke", "Steven Schockaert"],
    year: 2023,
  },
  {
    source_type: "arxiv",
    title: "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks",
    locator: "arxiv:2005.11401v4",
    url: "https://arxiv.org/abs/2005.11401v4",
    authors: ["Patrick Lewis", "Ethan Perez", "Aleksandra Piktus"],
    year: 2020,
  },
  {
    source_type: "arxiv",
    title: "ReAct: Synergizing Reasoning and Acting in Language Models",
    locator: "arxiv:2210.03629v3",
    url: "https://arxiv.org/abs/2210.03629v3",
    authors: ["Shunyu Yao", "Jeffrey Zhao", "Dian Yu"],
    year: 2022,
  },
  {
    source_type: "arxiv",
    title: "Chain-of-Thought Prompting Elicits Reasoning in Large Language Models",
    locator: "arxiv:2201.11903v6",
    url: "https://arxiv.org/abs/2201.11903v6",
    authors: ["Jason Wei", "Xuezhi Wang", "Dale Schuurmans"],
    year: 2022,
  },
  {
    source_type: "arxiv",
    title: "Toolformer: Language Models Can Teach Themselves to Use Tools",
    locator: "arxiv:2302.04761v1",
    url: "https://arxiv.org/abs/2302.04761v1",
    authors: ["Timo Schick", "Jane Dwivedi-Yu", "Roberto Dessì"],
    year: 2023,
  },
];

/** 与 SOURCES 同源的反查替身：确定性运行时不打网络，验收也不例外。 */
export function createDeterministicVerifier(): ReferenceVerifier {
  return createReferenceVerifier({
    lookup: async (ids) => {
      const wanted = new Set(ids.map((id) => id.replace(/v\d+$/, "")));
      return SOURCES.map((source) => ({
        arxivId: source.locator.replace(/^arxiv:/, ""),
        title: source.title,
        authors: source.authors ?? [],
        year: source.year ?? null,
      })).filter((record) => wanted.has(record.arxivId.replace(/v\d+$/, "")));
    },
  });
}

/** 不花钱的确定性运行时。
 *
 * 本地开发、UI 联调和演示都不该每次都真调 Qwen —— 对应 Python 侧的 `fake_agents.py`。
 * 它产出的是**合法**的 Artifact：走同一套证据门、同一套 plan_quality，
 * 所以它能验证的是编排与合同，验证不了模型质量。
 *
 * 证据仍然经由台账登记并落库，只是检索结果是写死的，不打网络。
 */
export function createDeterministicRuntime(store: SqliteStore): {
  execute: StageExecutor;
  createLedger: (scope: { runId: string; attemptId: string }) => EvidenceLedger;
} {
  let ledger!: EvidenceLedger;

  const createLedger = (scope: { runId: string; attemptId: string }) => {
    ledger = new EvidenceLedger({
      namespace: `${scope.attemptId}_`,
      onRecord: (record) => store.recordEvidence(scope.runId, scope.attemptId, record),
    });
    return ledger;
  };

  const execute: StageExecutor = async ({ role, agent, input }) => {
    const payload = JSON.parse(input);
    const inputs = (payload.input_artifacts ?? []) as Array<{ id: string; type: string; content: any }>;
    const ofType = (type: string) => inputs.filter((item) => item.type === type);

    if (role === "researcher") {
      const search = ledger.record({
        tool: "arxiv_search",
        sourceType: "arxiv",
        query: "retrieval augmented generation evaluation",
        status: "succeeded",
        resultSummary: `arXiv returned ${SOURCES.length} citable record(s)`,
        citations: SOURCES,
      });
      const inherited = ofType("research").flatMap((item) =>
        (item.content as Research).citations.map((c) => c.evidence_id),
      );
      // 与真模型走同一条上报通道：产物经由 structured_output 工具提交，
      // 所以离线运行时也要过那份参数 schema。直接 return 会绕开它。
      return await reportStructuredOutput(agent, {
        artifact_type: "research",
        question: payload.question,
        research_framing: {
          research_object: "科研 Agent 的证据归因机制",
          scope: "固定模型和问题集下的引用可靠性",
          variables: [
            { name: "证据门条件", role: "independent", operationalization: "是否启用冻结 evidence_id 校验" },
            { name: "无来源引用率", role: "dependent", operationalization: "未绑定冻结证据的引用数除以引用总数" },
          ],
          known: ["冻结证据 ID 可以被确定性验收。"],
          controversies: ["提示词约束是否足以替代代码持有的证据归因仍有争议。"],
          unknowns: ["证据门对跨问题任务完成率的影响未知。"],
          knowledge_gap: "缺少在相同问题和模型条件下对证据归因机制的配对比较。",
          constraints: ["不能把候选假设写成已证实结论。"],
        },
        summary: "已冻结一条可核验的来源，支撑后续假设与实验设计。",
        claims: [
          {
            statement: "引用可核验性可以被自动评测。",
            evidence_ids: [...new Set([search.evidenceId, ...inherited])],
          },
        ],
        queries: [
          {
            evidence_id: search.evidenceId,
            source_type: "arxiv",
            query: "retrieval augmented generation evaluation",
            status: "succeeded",
            result_summary: `arXiv returned ${SOURCES.length} citable record(s)`,
          },
        ],
        citations: SOURCES.map((source) => ({ evidence_id: search.evidenceId, ...source })),
        limitations: ["确定性运行时只登记一条固定来源。"],
      });
    }

    if (role === "hypothesis-generation") {
      const research = ofType("research");
      const evidenceIds = [
        ...new Set(
          research.flatMap((item) => {
            const content = item.content as Research;
            return [
              ...content.queries.map((query) => query.evidence_id),
              ...content.citations.map((citation) => citation.evidence_id),
            ];
          }),
        ),
      ];
      return {
        artifact_type: "hypothesis",
        question: payload.question,
        candidates: [
          {
            candidate_id: "evidence-gate",
            claim_status: "candidate",
            core_claim: "强制引用冻结证据 ID 能降低科研 Agent 的无来源引用率。",
            basis: "冻结证据 ID 使归因关系可核验；这是基于工具记录的模型推断，不是已证实结论。",
            supporting_evidence_ids: evidenceIds.slice(0, 1),
            opposing_evidence_ids: [],
            falsifiable_predictions: ["证据门组的无来源引用率低于自由生成组。"],
            alternative_explanations: ["提示词约束或问题难度差异也可能导致引用率变化。"],
            uncertainty: ["固定来源只说明可审计性，尚未测量跨问题泛化。"],
            boundaries: ["只覆盖引用可靠性，不涉及结论正确性。"],
            validation_conditions: ["使用预注册的配对问题集与同一模型。"],
          },
          {
            candidate_id: "prompt-only",
            claim_status: "candidate",
            core_claim: "仅通过提示词要求引用证据也足以降低科研 Agent 的无来源引用率。",
            basis: "语言约束可能改变模型的引用选择，但没有代码持有的证据归因保障。",
            supporting_evidence_ids: evidenceIds.slice(0, 1),
            opposing_evidence_ids: [],
            falsifiable_predictions: ["提示词约束组的无来源引用率低于无约束基线。"],
            alternative_explanations: ["模型对提示词的服从度或任务熟悉度可能解释观察到的差异。"],
            uncertainty: ["提示词不能阻止模型生成不存在的 evidence_id。"],
            boundaries: ["只覆盖结构化引用行为，不涉及来源真实性。"],
            validation_conditions: ["固定模型、问题集、总 token 预算后做配对对照。"],
          },
        ],
        comparison: {
          criteria: [
            { criterion: "引用可核验性", rationale: "候选必须能把论断绑定到真实冻结证据，而不是只改变措辞。" },
            { criterion: "可证伪性", rationale: "候选必须给出可观测预测，允许后续结果否定它。" },
          ],
          evaluations: [
            {
              candidate_id: "evidence-gate",
              rank: 1,
              strengths: ["代码持有 evidence_id 与来源台账，归因可由确定性验收复核。"],
              weaknesses: ["需要额外的证据冻结和结构化输出约束。"],
              evidence_ids: evidenceIds.slice(0, 1),
              rationale: "在当前证据下，它比纯提示词方案更容易被直接核验，但仍需配对实验验证效果。",
            },
            {
              candidate_id: "prompt-only",
              rank: 2,
              strengths: ["实现成本较低，可能改善模型的引用意识。"],
              weaknesses: ["无法阻止捏造 ID，也无法由代码确认来源是否真实发生。"],
              evidence_ids: evidenceIds.slice(0, 1),
              rationale: "保留作为替代候选与对照条件，不因暂未选中而删除。",
            },
          ],
          selected_candidate_id: "evidence-gate",
          selection_rationale:
            "选择证据门候选进入研究计划，因为它的关键机制可被确定性验收；这只是研究优先级，不是实验结论。",
        },
        selection_status: "candidate_selected",
        research_artifact_ids: research.map((item) => item.id),
      };
    }

    if (role === "evidence-review") {
      const research = ofType("research").at(-1)!;
      return {
        artifact_type: "evidence-review",
        hypothesis_artifact_id: ofType("hypothesis").at(-1)!.id,
        research_artifact_ids: [research.id],
        assessments: [
          {
            candidate_id: "evidence-gate",
            claim: "引用可核验性可以被自动评测。",
            verdict: "supports",
            rationale: "已冻结来源给出了可用的评测框架。",
            evidence_ids: (research.content as Research).citations.map((item) => item.evidence_id),
          },
          {
            candidate_id: "prompt-only",
            claim: "仅提示词约束也可能降低无来源引用。",
            verdict: "uncertain",
            rationale: "冻结来源不足以证明提示词本身可以阻止捏造证据 ID。",
            evidence_ids: [],
          },
        ],
        gaps: [],
        supported: true,
      };
    }

    if (role === "research-plan") {
      const cited = ofType("research").flatMap((item) => (item.content as Research).citations);
      const frozen = cited[0]!;
      return await reportStructuredOutput(agent, {
        artifact_type: "research-plan",
        problem_statement: "测量科研 Agent 的无来源引用率。",
        rationale: "冻结证据使引用可靠性可被检验。",
        technical_details: "先冻结证据，再逐条核验引用是否落在冻结集合内。",
        datasets: ["preregistered question set"],
        source: "Frozen Research Artifacts",
        target: "降低无来源引用率并保持任务完成率。",
        execution_plan: {
          predictions: [
            {
              candidate_id: "evidence-gate",
              prediction: "证据门组的无来源引用率低于自由生成组。",
              falsification_criterion: "若无来源引用率没有下降，则否定该预测。",
            },
          ],
          data_requirements: [
            {
              source: "预注册问题集",
              variables: ["无来源引用率", "任务完成率"],
              conditions: ["固定模型、问题集和总 token 预算。"],
            },
          ],
          steps: [
            { order: 1, action: "冻结问题集并分别运行证据门与对照条件。", expected_output: "每题一份结构化产物。" },
            { order: 2, action: "按同一规则核验引用并汇总配对指标。", expected_output: "逐题结果表和失败记录。" },
          ],
          analysis: [
            {
              method: "配对比例比较",
              inputs: ["两组逐题引用核验结果"],
              decision_rule: "报告差值及置信区间，不把未执行结果写成假设已证实。",
            },
          ],
          result_interpretations: [
            { observed_result: "无来源引用率下降且完成率不下降。", meaning: "支持继续验证证据门候选。" },
            { observed_result: "无来源引用率不下降或完成率下降。", meaning: "否定或回退证据门候选，并检查替代解释。" },
          ],
          stop_conditions: ["达到预注册样本量且所有题都有终态记录。"],
          rollback_conditions: ["引用核验无法复现或数据完整性门失败。"],
          supplement_evidence_conditions: ["关键变量缺少可用来源或出现无法解释的冲突证据。"],
        },
        paper_title: "可审计证据门对科研 Agent 引用可靠性的影响",
        paper_abstract: "本研究通过配对对照实验检验冻结证据 ID 对无来源引用率的影响。",
        methods: "固定问题集与模型，做配对盲评。",
        experiments: {
          baselines: [
            { name: "自由生成基线", evidence_id: frozen.evidence_id },
            { name: "仅提示词约束基线", evidence_id: frozen.evidence_id },
          ],
          metrics: [
            { name: "无来源引用率", evidence_id: frozen.evidence_id },
            { name: "任务完成率", evidence_id: frozen.evidence_id },
          ],
          design: "同一问题集下对比三组，报告置信区间。",
        },
        results: {
          status: "pending_verification",
          validation_basis: "formula_derivation",
          feasibility_argument:
            "令证据门组与基线组的无来源引用率分别为 r_gate 与 r_base；若预期 r_gate < r_base，且任务完成率差异处于预设容许范围内，则可用同一验收规则判定设计可行。这里只是公式与逻辑推导，不代表实验已执行。",
          expected_outcomes: [
            { metric: "无来源引用率", statement: "证据门组的逐题比例差值预期低于基线组，并报告区间。" },
            { metric: "任务完成率", statement: "证据门组与基线组的逐题完成率差值及区间均需如实报告。" },
          ],
        },
        // 去重：补证轮会把同一批来源再冻结一次，重复 URL 不该冒充更多参考文献。
        references: [...new Set(cited.map((item) => item.url!))],
        input_artifact_ids: inputs.map((item) => item.id),
        verification_evidence_ids: [frozen.evidence_id],
      });
    }

    // Reviewer 的独立检索必须进入同一本台账；记录固定来源即可保持离线执行零网络。
    let independentEvidenceId: string | undefined;
    if (role === "reviewer") {
      independentEvidenceId = ledger.record({
        tool: "arxiv_search",
        sourceType: "arxiv",
        query: "counterevidence and methodological risks",
        status: "succeeded",
        resultSummary: "arXiv returned one independent citable record",
        citations: [SOURCES[0]!],
      }).evidenceId;
    }

    return await reportStructuredOutput(agent, {
      artifact_type: "review",
      research_plan_artifact_id: ofType("research-plan").at(-1)!.id,
      evidence_review_artifact_id: ofType("evidence-review").at(-1)!.id,
      independent_evidence_ids: independentEvidenceId ? [independentEvidenceId] : [],
      scores: { scientific_value: 4, technical_depth: 4, application_potential: 4 },
      weaknesses: [],
      feedback: [],
      suggested_successor_roles: [],
      accepted: true,
    });
  };

  return { execute, createLedger };
}
