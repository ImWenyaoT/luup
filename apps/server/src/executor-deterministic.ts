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
      return SOURCES
        .map((source) => ({
          arxivId: source.locator.replace(/^arxiv:/, ""),
          title: source.title,
          authors: source.authors ?? [],
          year: source.year ?? null,
        }))
        .filter((record) => wanted.has(record.arxivId.replace(/v\d+$/, "")));
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
      const inherited = ofType("research")
        .flatMap((item) => (item.content as Research).citations.map((c) => c.evidence_id));
      // 与真模型走同一条上报通道：产物经由 structured_output 工具提交，
      // 所以离线运行时也要过那份参数 schema。直接 return 会绕开它。
      return await reportStructuredOutput(agent, {
        artifact_type: "research",
        question: payload.question,
        summary: "已冻结一条可核验的来源，支撑后续假设与实验设计。",
        claims: [{
          statement: "引用可核验性可以被自动评测。",
          evidence_ids: [...new Set([search.evidenceId, ...inherited])],
        }],
        queries: [{
          evidence_id: search.evidenceId,
          source_type: "arxiv",
          query: "retrieval augmented generation evaluation",
          status: "succeeded",
          result_summary: `arXiv returned ${SOURCES.length} citable record(s)`,
        }],
        citations: SOURCES.map((source) => ({ evidence_id: search.evidenceId, ...source })),
        limitations: ["确定性运行时只登记一条固定来源。"],
      });
    }

    if (role === "hypothesis-generation") {
      const research = ofType("research").at(-1)!;
      return {
        artifact_type: "hypothesis",
        question: payload.question,
        hypothesis: "强制引用冻结证据 ID 能降低科研 Agent 的无来源引用率。",
        rationale: "证据 ID 由代码写定，模型无法在事后改写归因。",
        falsifiable_predictions: ["证据门组的无来源引用率显著低于自由生成组。"],
        boundaries: ["只覆盖引用可靠性，不涉及结论正确性。"],
        research_artifact_ids: [research.id],
        evidence_ids: (research.content as Research).citations.map((item) => item.evidence_id),
        validation_conditions: ["使用预注册的配对问题集与同一模型。"],
      };
    }

    if (role === "evidence-review") {
      const research = ofType("research").at(-1)!;
      return {
        artifact_type: "evidence-review",
        hypothesis_artifact_id: ofType("hypothesis").at(-1)!.id,
        research_artifact_ids: [research.id],
        assessments: [{
          claim: "引用可核验性可以被自动评测。",
          verdict: "supports",
          rationale: "已冻结来源给出了可用的评测框架。",
          evidence_ids: (research.content as Research).citations.map((item) => item.evidence_id),
        }],
        gaps: [],
        supported: true,
      };
    }

    if (role === "research-plan") {
      const cited = ofType("research").flatMap((item) => (item.content as Research).citations);
      const frozen = cited[0]!;
      return {
        artifact_type: "research-plan",
        problem_statement: "测量科研 Agent 的无来源引用率。",
        rationale: "冻结证据使引用可靠性可被检验。",
        technical_details: "先冻结证据，再逐条核验引用是否落在冻结集合内。",
        datasets: ["preregistered question set"],
        source: "Frozen Research Artifacts",
        target: "降低无来源引用率并保持任务完成率。",
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
          expected_outcomes: [
            { metric: "无来源引用率", statement: "证据门组显著更低。" },
            { metric: "任务完成率", statement: "证据门组不显著劣于基线。" },
          ],
        },
        // 去重：补证轮会把同一批来源再冻结一次，重复 URL 不该冒充更多参考文献。
        references: [...new Set(cited.map((item) => item.url!))],
        input_artifact_ids: inputs.map((item) => item.id),
        verification_evidence_ids: [frozen.evidence_id],
      };
    }

    return {
      artifact_type: "review",
      research_plan_artifact_id: ofType("research-plan").at(-1)!.id,
      evidence_review_artifact_id: ofType("evidence-review").at(-1)!.id,
      scores: { scientific_value: 4, technical_depth: 4, application_potential: 4 },
      weaknesses: [],
      feedback: [],
      suggested_successor_roles: [],
      accepted: true,
    };
  };

  return { execute, createLedger };
}
