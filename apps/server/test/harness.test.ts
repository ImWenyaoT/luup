import { passingReviewFoundations } from "./fixtures/review-foundations.ts";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onTestFinished, test } from "vitest";

import { ArxivLookupError } from "../src/agent/arxiv.ts";
import type { ResearchPlan } from "../src/agent/contracts.ts";
import { EvidenceLedger, type EvidenceCitation, type EvidenceRecord } from "../src/agent/evidence.ts";
import { StageError } from "../src/agent/failures.ts";
import { reportStructuredOutput } from "../src/agent/roles/structured-output.ts";
import { Harness } from "../src/harness.ts";
import { CampaignMemory } from "../src/campaign/campaign.ts";
import { runTask, type StageExecutor } from "../src/roles.ts";
import { SqliteStore } from "../src/store/store.ts";
import { createReferenceVerifier, type ArxivLookup } from "../src/verify/verifier.ts";

/** Science-125 的题面：英文原题包在中文出处里（`science125Text`）。
 *  这里写的是 store 归一化之后的形态 —— `normalizeQuestion` 会把换行压成空格。 */
const FROZEN_QUESTION =
  "来源：《Science》125 前沿科学问题（Science-125 题库）第 1 题，" +
  "Mathematical Sciences。 问题：What makes prime numbers so special?";

/** live 取证到的漂移形态：**截断**而不是翻译 —— 中文出处整段丢掉，只填回英文原题。 */
const DRIFTED_QUESTION = "What makes prime numbers so special?";

/** `researchProposalSchema.queries` 的条数上限 —— 模型一次最多能写这么多条转录。
 *  产物里的 `queries` 由台账填充，不受它约束。 */
const MODEL_WRITABLE_QUERY_CAP = 12;

/** 台账里不存在的 evidence_id：模型虚报一次检索时写的就是这种东西。 */
const INVENTED_EVIDENCE_ID = "ev_never_happened_arxiv";

const citation = {
  source_type: "arxiv" as const,
  title: "Fixture source",
  locator: "arxiv:2301.00001v1",
  url: "https://arxiv.org/abs/2301.00001v1",
  authors: ["Ada Lovelace", "Grace Hopper"],
  year: 2023,
};

/** 五条来源，因为终局引用验收要求 references ≥5（B3）。 */
const sources: EvidenceCitation[] = [
  citation,
  ...[2, 3, 4, 5].map((n) => ({
    source_type: "arxiv" as const,
    title: `Fixture source ${n}`,
    locator: `arxiv:2301.0000${n}v1`,
    url: `https://arxiv.org/abs/2301.0000${n}v1`,
    authors: ["Ada Lovelace"],
    year: 2023,
  })),
];

/** arXiv 反查替身：照抄冻结来源，所以 B2/B4 在零网络下也是真的在比对。 */
const fixtureLookup: ArxivLookup = async (ids) => {
  const wanted = new Set(ids.map((id) => id.replace(/v\d+$/, "")));
  return sources
    .map((source) => ({
      arxivId: source.locator.replace(/^arxiv:/, ""),
      title: source.title,
      authors: source.authors ?? [],
      year: source.year ?? null,
    }))
    .filter((record) => wanted.has(record.arxivId.replace(/v\d+$/, "")));
};

function fake(
  options: {
    gapOnce?: boolean;
    blockingFoundation?: boolean;
    /** 选中候选（evidence-gate）在最终 evidence-review 上的 verdict；默认 supports。 */
    selectedVerdict?: "supports" | "contradicts" | "uncertain";
    /** 非自选候选（prompt-only）的 verdict；用于 Propose≠Select 晋升旁路。 */
    alternateVerdict?: "supports" | "contradicts" | "uncertain";
    rejectReviews?: number;
    invalidPlanOnce?: boolean;
    hidesASearch?: boolean;
    claimsFailedSearch?: boolean;
    inventsReviewEvidence?: boolean;
    omitsCandidateAssessment?: boolean;
    repeatsSupplementarySearch?: boolean;
    rewritesResearchQuestion?: boolean;
    rewritesHypothesisQuestion?: boolean;
    claimsUnfrozenSearch?: boolean;
    searchCount?: number;
    inventsAQuery?: boolean;
    inventsACitation?: boolean;
    stageFails?: boolean;
    primitiveFailure?: boolean;
    usesProviderSourceAlias?: boolean;
    thinReferences?: boolean;
    rewritesPlanCandidateId?: boolean;
    beforeFirstReviewer?: () => Promise<void>;
  } = {},
) {
  let ledger = new EvidenceLedger();
  const calls: Array<{ role: string; input: any; timeoutMs: number }> = [];
  let evidenceReviews = 0;
  let researchCalls = 0;
  let reviews = 0;
  let plans = 0;

  const execute: StageExecutor = async ({ role, agent, input, timeoutMs }) => {
    const payload = JSON.parse(input);
    calls.push({ role, input: payload, timeoutMs });
    const inputs = (payload.input_artifacts ?? []) as Array<{ id: string; type: string; content: any }>;
    const ofType = (type: string) => inputs.filter((item) => item.type === type);

    if (options.primitiveFailure) return await Promise.reject(null);
    if (options.stageFails) throw new StageError("deadline_exceeded", `${role} exceeded the deadline`);
    if (role === "reviewer" && reviews === 0 && options.beforeFirstReviewer) await options.beforeFirstReviewer();

    if (role === "researcher") {
      researchCalls += 1;
      // 真实链路上这条记录由 arxiv_search 的执行结果写入
      const searches: EvidenceRecord[] = [
        ledger.record({
          tool: "arxiv_search",
          sourceType: "arxiv",
          query: options.repeatsSupplementarySearch
            ? researchCalls === 1
              ? "fixture query"
              : "FIXTURE QUERY"
            : `fixture query ${researchCalls}`,
          status: "succeeded",
          resultSummary: "arXiv returned 1 citable record(s)",
          citations: sources,
        }),
      ];
      if (options.hidesASearch || options.claimsFailedSearch) {
        searches.push(
          ledger.record({
            tool: "arxiv_search",
            sourceType: "arxiv",
            query: "the search it wants to hide",
            status: "empty",
            resultSummary: "arXiv returned no valid records",
            citations: [],
          }),
        );
      }
      // 一个 Attempt 可以检索很多次：v2 实测最多 20 次。SDK 的 maxTurns 不是上界——
      // 百炼会在同一 turn 并发调工具，`parallelToolCalls: false` 并不总被遵守。
      for (let extra = 1; extra < (options.searchCount ?? 1); extra += 1) {
        searches.push(
          ledger.record({
            tool: "arxiv_search",
            sourceType: "arxiv",
            query: `flood query ${extra}`,
            status: "succeeded",
            resultSummary: "arXiv returned 1 citable record(s)",
            citations: sources,
          }),
        );
      }
      if (options.claimsUnfrozenSearch) {
        searches.push(
          ledger.record({
            tool: "arxiv_search",
            sourceType: "arxiv",
            query: "second successful search",
            status: "succeeded",
            resultSummary: "arXiv returned 1 citable record(s)",
            citations: sources,
          }),
        );
      }
      const reported = (options.hidesASearch ? searches.slice(0, 1) : searches).slice(0, MODEL_WRITABLE_QUERY_CAP);
      const inheritedIds = ofType("research").flatMap((item) => item.content.citations.map((c: any) => c.evidence_id));
      // 替身也走 structured_output 上报 —— 与真模型同一条通路，同一份参数 schema。
      return await reportStructuredOutput(agent, {
        artifact_type: "research",
        question: options.rewritesResearchQuestion ? DRIFTED_QUESTION : payload.question,
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
        summary: "冻结证据支撑一条可审计的论断。",
        claims: [
          {
            statement: "证据门提升可审计性。",
            evidence_ids: [
              ...new Set([
                options.claimsFailedSearch || options.claimsUnfrozenSearch
                  ? searches[1]!.evidenceId
                  : searches[0]!.evidenceId,
                ...inheritedIds,
              ]),
            ],
          },
        ],
        queries: [
          ...reported.map((record) => ({
            evidence_id: record.evidenceId,
            source_type: options.usesProviderSourceAlias ? "crossref" : "arxiv",
            query: "模型转述的查询词，代码会整条覆写",
            status: "succeeded",
            result_summary: "模型转述的摘要",
          })),
          // 虚报：模型写了一条台账里根本没有的检索。
          ...(options.inventsAQuery === true
            ? [
                {
                  evidence_id: INVENTED_EVIDENCE_ID,
                  source_type: "arxiv",
                  query: "从未发生过的检索",
                  status: "succeeded",
                  result_summary: "凭空捏造的摘要",
                },
              ]
            : []),
        ],
        // 第一条故意让模型转述并改写 URL，其余照抄 —— 代码覆写与否要在同一份产物里看得见。
        citations: [
          ...sources.map((source, index) => ({
            evidence_id: searches[0]!.evidenceId,
            source_type: options.usesProviderSourceAlias ? "crossref" : "arxiv",
            title: index === 0 ? "模型转述的标题" : source.title,
            locator: source.locator,
            url: index === 0 ? "https://evil.example.com/other" : source.url,
          })),
          // citations 是模型的**选择**行为，不是转录：挂在虚构检索上的引用照旧判死。
          ...(options.inventsACitation === true
            ? [
                {
                  evidence_id: INVENTED_EVIDENCE_ID,
                  source_type: "arxiv",
                  title: "凭空捏造的来源",
                  locator: "arxiv:9999.99999v1",
                  url: null,
                },
              ]
            : []),
        ],
        limitations: ["fixture"],
      });
    }

    if (role === "hypothesis-generation") {
      const research = ofType("research");
      const evidenceIds = [
        ...new Set(research.flatMap((item) => item.content.citations.map((c: any) => c.evidence_id))),
      ];
      return await reportStructuredOutput(agent, {
        artifact_type: "hypothesis",
        question: options.rewritesHypothesisQuestion ? DRIFTED_QUESTION : payload.question,
        candidates: [
          {
            candidate_id: "evidence-gate",
            claim_status: "candidate",
            core_claim: "证据门降低无来源引用。",
            basis: "冻结证据可审计；这是待验证的模型推断。",
            supporting_evidence_ids: evidenceIds,
            opposing_evidence_ids: [],
            falsifiable_predictions: ["无来源引用率低于基线。"],
            alternative_explanations: ["提示词服从度差异也可能造成引用率变化。"],
            uncertainty: ["当前 fixture 未测量真实科学结论正确性。"],
            boundaries: ["仅限引用可靠性。"],
            validation_conditions: ["使用预注册的配对基准。"],
          },
          {
            candidate_id: "prompt-only",
            claim_status: "candidate",
            core_claim: "仅提示词约束也可能降低无来源引用。",
            basis: "提示词可能改变模型行为，但没有代码持有的证据归因。",
            supporting_evidence_ids: evidenceIds,
            opposing_evidence_ids: [],
            falsifiable_predictions: ["提示词约束组的无来源引用率低于基线。"],
            alternative_explanations: ["任务难度差异可能解释观察结果。"],
            uncertainty: ["提示词不能阻止模型编造 evidence_id。"],
            boundaries: ["不覆盖来源真实性。"],
            validation_conditions: ["固定问题集、模型与预算后做配对比较。"],
          },
        ],
        comparison: {
          criteria: [
            { criterion: "引用可核验性", rationale: "候选必须能绑定真实冻结证据。" },
            { criterion: "可证伪性", rationale: "候选必须有可观测预测。" },
          ],
          evaluations: [
            {
              candidate_id: "evidence-gate",
              rank: 1,
              strengths: ["冻结证据可被确定性验收。"],
              weaknesses: ["需要结构化证据门。"],
              evidence_ids: evidenceIds,
              rationale: "优先验证，但不是已证实结论。",
            },
            {
              candidate_id: "prompt-only",
              rank: 2,
              strengths: ["实现成本低。"],
              weaknesses: ["不能阻止捏造证据 ID。"],
              evidence_ids: evidenceIds,
              rationale: "保留作为替代候选和对照。",
            },
          ],
          selected_candidate_id: "evidence-gate",
          selection_rationale: "优先验证可由代码核验的候选；这只是研究优先级。",
        },
        selection_status: "candidate_selected",
        research_artifact_ids: research.map((item) => item.id),
      });
    }

    if (role === "evidence-review") {
      evidenceReviews += 1;
      const gap = options.gapOnce === true && evidenceReviews === 1;
      const research = ofType("research");
      // 补证首轮仍用 uncertain（触发 gaps）；最终轮才应用 selectedVerdict 门禁夹具。
      const selectedVerdict = gap ? "uncertain" : (options.selectedVerdict ?? "supports");
      return await reportStructuredOutput(agent, {
        artifact_type: "evidence-review",
        hypothesis_artifact_id: ofType("hypothesis").at(-1)!.id,
        research_artifact_ids: research.map((item) => item.id),
        assessments: [
          {
            candidate_id: "evidence-gate",
            claim: "证据门降低无来源引用。",
            verdict: selectedVerdict,
            rationale:
              selectedVerdict === "supports"
                ? "冻结证据支持开展验证。"
                : selectedVerdict === "contradicts"
                  ? "冻结证据与该论断相悖。"
                  : "冻结证据不足以判定该论断。",
            evidence_ids:
              selectedVerdict === "uncertain"
                ? []
                : options.inventsReviewEvidence
                  ? ["ev_never_existed"]
                  : research.flatMap((item) => item.content.citations.map((c: any) => c.evidence_id)),
          },
          ...(options.omitsCandidateAssessment
            ? []
            : [
                {
                  candidate_id: "prompt-only",
                  claim: "仅提示词约束也可能降低无来源引用。",
                  verdict: (options.alternateVerdict ?? "uncertain") as "supports" | "contradicts" | "uncertain",
                  rationale:
                    (options.alternateVerdict ?? "uncertain") === "supports"
                      ? "冻结证据支持将该对照候选作为可验证主张推进。"
                      : "冻结证据尚不足以排除任务差异等替代解释。",
                  evidence_ids:
                    (options.alternateVerdict ?? "uncertain") === "supports"
                      ? research.flatMap((item) => item.content.citations.map((c: any) => c.evidence_id))
                      : [],
                },
              ]),
        ],
        gaps: gap ? ["comparison source"] : [],
        supported: !gap && (selectedVerdict === "supports" || options.alternateVerdict === "supports"),
      });
    }

    if (role === "research-plan") {
      plans += 1;
      if (options.invalidPlanOnce === true && plans === 1) {
        await new Promise((done) => setTimeout(done, 10));
      }
      const frozenId = ofType("research").flatMap((item) => item.content.citations.map((c: any) => c.evidence_id))[0];
      return await reportStructuredOutput(agent, {
        artifact_type: "research-plan",
        problem_statement: "测量科研 Agent 的无来源引用率。",
        rationale: "冻结证据使引用可靠性可被检验。",
        technical_details: "先冻结证据，再逐条核验引用。",
        datasets: ["preregistered questions"],
        source: "Frozen Artifacts",
        target: "降低无来源引用率。",
        execution_plan: {
          predictions: [
            {
              candidate_id: options.rewritesPlanCandidateId ? "H1_Structural_Foundation" : "evidence-gate",
              prediction: "证据门组的无来源引用率低于基线组。",
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
        paper_title: "可审计证据门研究",
        paper_abstract: "开展证据门的配对对照研究。",
        methods: "使用配对盲评方法。",
        experiments: {
          baselines: [
            { name: "无证据门基线", evidence_id: frozenId },
            { name: "仅提示词约束基线", evidence_id: frozenId },
          ],
          metrics: [
            { name: "无来源引用率", evidence_id: frozenId },
            { name: "任务完成率", evidence_id: frozenId },
          ],
          design: "固定问题与模型后做配对盲测。",
        },
        results: {
          status: "pending_verification",
          validation_basis: "formula_derivation",
          feasibility_argument:
            options.invalidPlanOnce === true && plans === 1
              ? "可行"
              : "令证据门组与基线组的无来源引用率分别为 r_gate 与 r_base；若预期 r_gate < r_base，且任务完成率差异处于预设容许范围内，则可用同一验收规则判定设计可行。这里只是公式与逻辑推导，不代表实验已执行。",
          expected_outcomes: [{ metric: "无来源引用率", statement: "证据门组的无来源引用率更低。" }],
        },
        references:
          options.thinReferences === true
            ? [citation.url]
            : [
                ...new Set(
                  ofType("research").flatMap((item) => item.content.citations.map((c: any) => c.url as string)),
                ),
              ],
        input_artifact_ids: payload.input_artifacts.map((item: any) => item.id),
        verification_evidence_ids: [frozenId],
      });
    }

    const independentEvidence = ledger.record({
      tool: "arxiv_search",
      sourceType: "arxiv",
      query: "reviewer counterevidence and methodological risks",
      status: "succeeded",
      resultSummary: "arXiv returned one independent citable record",
      citations: [citation],
    });
    reviews += 1;
    const rejected = reviews <= (options.rejectReviews ?? 0);
    return await reportStructuredOutput(agent, {
      artifact_type: "review",
      foundation_checks: {
        ...passingReviewFoundations(),
        ...(options.blockingFoundation
          ? {
              executability: {
                verdict: "fail",
                reason: "统计判据无法区分成功与失败",
                plan_paths: ["experiments.design"],
              },
            }
          : {}),
      },
      research_plan_artifact_id: ofType("research-plan").at(-1)!.id,
      evidence_review_artifact_id: ofType("evidence-review").at(-1)!.id,
      independent_evidence_ids: [independentEvidence.evidenceId],
      scores: { scientific_value: 4, technical_depth: 4, application_potential: 4 },
      weaknesses: rejected ? ["需要澄清对照。"] : [],
      feedback: rejected ? ["修订计划。"] : [],
      suggested_successor_roles: rejected ? ["research-plan"] : [],
      accepted: !rejected,
    });
  };

  // fake 必须往 Harness 那本台账里记，否则 runTask 看到的检索记录是空的
  const useLedger = (next: EvidenceLedger) => {
    ledger = next;
  };
  return { execute, calls, useLedger };
}

function harness(options: Parameters<typeof fake>[0] & { lookupFails?: boolean } = {}) {
  const store = new SqliteStore(":memory:");
  const f = fake(options);
  // 每个 Attempt 一本新台账，且检索发生时就落库 —— 和默认实现同形
  const runner = new Harness(store, f.execute, {
    // 生产同一个验收器，只把 arXiv 反查换成替身：零网络零 LLM，判定逻辑仍是真的。
    verifyReferences: createReferenceVerifier({
      lookup:
        options.lookupFails === true
          ? async () => {
              throw new ArxivLookupError("arXiv lookup returned HTTP 503");
            }
          : fixtureLookup,
    }),
    createLedger: (scope) => {
      const ledger = new EvidenceLedger({
        namespace: `${scope.attemptId}_`,
        onRecord: (record) => store.recordEvidence(scope.runId, scope.attemptId, record),
      });
      f.useLedger(ledger);
      return ledger;
    },
  });
  return { store, calls: f.calls, harness: runner };
}

test("marks a run interrupted when its database is reopened", () => {
  const t = { onTestFinished };
  const directory = mkdtempSync(join(tmpdir(), "luup-store-"));
  const database = join(directory, "runs.db");
  t.onTestFinished(() => rmSync(directory, { recursive: true, force: true }));

  let store = new SqliteStore(database);
  const runId = store.createRun("q");
  store.startAttempt(runId, "researcher");
  store.close();

  store = new SqliteStore(database);
  const snapshot = store.snapshot(runId)!;
  assert.equal(snapshot.status, "failed");
  assert.equal(snapshot.error_code, "interrupted");
  assert.equal(snapshot.attempts[0]!.status, "failed");
  assert.equal(snapshot.attempts[0]!.failure_code, "interrupted");
  assert.equal(snapshot.recent_events.at(-1)!.kind, "run.failed");
  store.close();
});

test("refuses a second writer without interrupting the active run", () => {
  const t = { onTestFinished };
  const directory = mkdtempSync(join(tmpdir(), "luup-lock-"));
  const database = join(directory, "runs.db");
  t.onTestFinished(() => rmSync(directory, { recursive: true, force: true }));

  const store = new SqliteStore(database);
  const runId = store.createRun("q");
  assert.throws(() => new SqliteStore(database), /locked/);
  assert.equal(store.snapshot(runId)!.status, "running");
  store.close();
});

test("opens an empty SQLite writer-lock database", () => {
  const t = { onTestFinished };
  const directory = mkdtempSync(join(tmpdir(), "luup-stale-lock-"));
  const database = join(directory, "runs.db");
  t.onTestFinished(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(`${database}.writer-lock.db`, "");

  const store = new SqliteStore(database);
  assert.ok(store.createRun("q"));
  store.close();
});

test("drives a run to completed through the store task graph", async () => {
  const h = harness();
  const runId = h.harness.createRun("设计一个可证伪的实验");
  await h.harness.execute(runId);

  const snapshot = h.store.snapshot(runId)!;
  assert.equal(snapshot.status, "completed");
  assert.deepEqual(
    snapshot.artifacts.map((a: any) => a.type),
    ["research", "hypothesis", "evidence-review", "research-plan", "review"],
  );
  assert.deepEqual(
    h.calls.map((c) => c.role),
    ["researcher", "hypothesis-generation", "evidence-review", "research-plan", "reviewer"],
  );
  assert.equal(
    snapshot.attempts.every((a: any) => a.status === "completed"),
    true,
  );
  const lifecycle = snapshot.recent_events.filter((event: any) => event.kind.startsWith("subagent."));
  assert.deepEqual(
    lifecycle.map((event: any) => [event.kind, event.payload.role, event.payload.status ?? null]),
    [
      ["subagent.started", "researcher", null],
      ["subagent.ended", "researcher", "completed"],
      ["subagent.started", "hypothesis-generation", null],
      ["subagent.ended", "hypothesis-generation", "completed"],
      ["subagent.started", "evidence-review", null],
      ["subagent.ended", "evidence-review", "completed"],
      ["subagent.started", "research-plan", null],
      ["subagent.ended", "research-plan", "completed"],
      ["subagent.started", "reviewer", null],
      ["subagent.ended", "reviewer", "completed"],
    ],
  );
  h.store.close();
});

test("research plan candidate ids are frozen from the selected hypothesis instead of model transcription", async () => {
  const h = harness({ rewritesPlanCandidateId: true });
  const runId = h.harness.createRun("设计一个可证伪的实验");
  await h.harness.execute(runId);

  const snapshot = h.store.snapshot(runId)!;
  assert.equal(snapshot.status, "completed");
  const planRef = snapshot.artifacts.find((artifact: any) => artifact.type === "research-plan")!;
  const plan = h.store.artifact(planRef.id)!.content as ResearchPlan;
  assert.deepEqual(
    plan.execution_plan.predictions.map((prediction) => prediction.candidate_id),
    ["evidence-gate"],
  );
  assert.ok(
    snapshot.recent_events.some(
      (event: any) =>
        event.kind === "artifact.field_overwritten" &&
        event.payload.field === "execution_plan.predictions.candidate_id",
    ),
  );
  h.store.close();
});

test("publishes multiple traceable candidate hypotheses and a comparison decision", async () => {
  const h = harness();
  const runId = h.harness.createRun("设计一个可证伪的实验");
  await h.harness.execute(runId);

  const hypothesis = h.store.snapshot(runId)!.artifacts.find((a: any) => a.type === "hypothesis")!.content;
  assert.equal(hypothesis.selection_status, "candidate_selected");
  assert.ok(hypothesis.candidates.length >= 2);
  assert.equal(
    new Set(hypothesis.candidates.map((candidate: any) => candidate.candidate_id)).size,
    hypothesis.candidates.length,
  );
  for (const candidate of hypothesis.candidates) {
    assert.equal(candidate.claim_status, "candidate");
    assert.ok(candidate.core_claim);
    assert.ok(candidate.supporting_evidence_ids.length + candidate.opposing_evidence_ids.length > 0);
    assert.ok(candidate.falsifiable_predictions.length > 0);
    assert.ok(candidate.alternative_explanations.length > 0);
    assert.ok(candidate.uncertainty.length > 0);
  }
  assert.ok(hypothesis.comparison.criteria.length > 0);
  assert.equal(hypothesis.comparison.evaluations.length, hypothesis.candidates.length);
  assert.ok(hypothesis.comparison.selected_candidate_id);
  assert.ok(
    hypothesis.candidates.some(
      (candidate: any) => candidate.candidate_id === hypothesis.comparison.selected_candidate_id,
    ),
  );
  assert.ok(!hypothesis.candidates.some((candidate: any) => candidate.claim_status !== "candidate"));
  h.store.close();
});

test("overwrites model-authored search metadata with what actually happened", async () => {
  // live 百炼会把 Crossref 的领域类别 `web` 写成工具名 `crossref`；解析层接受这个薄别名，
  // 最终值仍由检索台账决定，不能让模型改写。
  const h = harness({ usesProviderSourceAlias: true });
  const runId = h.harness.createRun("q");
  await h.harness.execute(runId);

  const research = h.store.snapshot(runId)!.artifacts.find((a: any) => a.type === "research")!.content;
  assert.equal(research.queries[0].query, "fixture query 1");
  assert.equal(research.queries[0].result_summary, "arXiv returned 1 citable record(s)");
  // citation 的 title/url 也是代码拥有的，模型的转述与改写都不留
  assert.equal(research.citations[0].title, citation.title);
  assert.equal(research.citations[0].url, citation.url);
  h.store.close();
});

/** 这个 run 里全部 queries 漂移记录，按事件顺序。 */
function queryDrift(snapshot: any): any[] {
  return snapshot.recent_events.filter(
    (event: any) => event.kind === "artifact.field_overwritten" && event.payload.field === "queries",
  );
}

test("fills queries from the ledger when the Artifact hides one of its searches", async () => {
  const h = harness({ hidesASearch: true });
  const runId = h.harness.createRun("q");
  await h.harness.execute(runId);

  const snapshot = h.store.snapshot(runId)!;
  // 漏报不再判死：转录不是模型该负责的事，台账才是权威。
  assert.equal(snapshot.status, "completed");
  // 而且不花纠错：藏一次检索连第二次调用都不会触发。
  assert.equal(h.calls.filter((call) => call.role === "researcher").length, 1);

  const researchArtifact = snapshot.artifacts.find((a: any) => a.type === "research")!;
  const research = researchArtifact.content;
  const recorded = snapshot.tool_evidence
    .filter((row: any) => row.attempt_id === researchArtifact.attempt_id)
    .map((row: any) => row.id);
  assert.equal(recorded.length, 2);
  // 被藏起来的那次检索照样进了产物，而且逐条与实录对齐。
  assert.deepEqual(
    research.queries.map((query: any) => query.evidence_id),
    recorded,
  );
  assert.deepEqual(
    research.queries.map((query: any) => query.status),
    ["succeeded", "empty"],
  );

  // 覆写救回了这一步，所以它必须留痕：漏一条、虚报零条。
  const drift = queryDrift(snapshot);
  assert.equal(drift.length, 1);
  assert.equal(drift[0]!.payload.artifact_type, "research");
  assert.equal(drift[0]!.payload.missing_count, 1);
  assert.equal(drift[0]!.payload.invented_count, 0);
  assert.equal(drift[0]!.payload.missing, recorded[1]);
  assert.equal(drift[0]!.payload.invented, "");
  h.store.close();
});

test("discards a query the model invented and records it as drift", async () => {
  const h = harness({ inventsAQuery: true });
  const runId = h.harness.createRun("q");
  await h.harness.execute(runId);

  const snapshot = h.store.snapshot(runId)!;
  assert.equal(snapshot.status, "completed");

  const researchArtifact = snapshot.artifacts.find((a: any) => a.type === "research")!;
  const research = researchArtifact.content;
  const recorded = snapshot.tool_evidence
    .filter((row: any) => row.attempt_id === researchArtifact.attempt_id)
    .map((row: any) => row.id);
  // 虚报的那条不对应任何真实检索，进不了证据面。
  assert.deepEqual(
    research.queries.map((query: any) => query.evidence_id),
    recorded,
  );
  assert.ok(!JSON.stringify(research).includes(INVENTED_EVIDENCE_ID));

  const drift = queryDrift(snapshot);
  assert.equal(drift.length, 1);
  assert.equal(drift[0]!.payload.missing_count, 0);
  assert.equal(drift[0]!.payload.invented_count, 1);
  assert.equal(drift[0]!.payload.invented, INVENTED_EVIDENCE_ID);
  h.store.close();
});

test("hands downstream roles the queries the ledger actually recorded", async () => {
  const h = harness({ hidesASearch: true });
  const runId = h.harness.createRun("q");
  await h.harness.execute(runId);

  const snapshot = h.store.snapshot(runId)!;
  const researchArtifact = snapshot.artifacts.find((item: any) => item.type === "research")!;
  const recorded = snapshot.tool_evidence
    .filter((row: any) => row.attempt_id === researchArtifact.attempt_id)
    .map((row: any) => ({ evidence_id: row.id, query: row.query, status: row.status }));
  // 冻结 Artifact 会原样传给后面每个角色；模型转述的查询词一个字都不该传下去。
  let seen = 0;
  for (const call of h.calls.filter((item) => item.role !== "researcher")) {
    for (const input of call.input.input_artifacts as any[]) {
      if (input.type !== "research") continue;
      seen += 1;
      assert.deepEqual(
        input.content.queries.map((query: any) => ({
          evidence_id: query.evidence_id,
          query: query.query,
          status: query.status,
        })),
        recorded,
      );
    }
  }
  assert.ok(seen > 0, "下游必须真的收到过 Research Artifact");
  h.store.close();
});

test("freezes every search of an attempt that out-searched the model-writable cap", async () => {
  // 13 = 模型可写上限 + 1，也就是旧 canonical schema 头一个会抛的条数，边界钉在这里。
  // v2 实测这不是边角情形：一个 Attempt 最多跑了 20 次检索，21 题里 5 个超过 12 次。
  // 产物的 queries 由代码填满，条数上限只能把「查得多」判死，不能挡住任何滥用。
  const h = harness({ searchCount: MODEL_WRITABLE_QUERY_CAP + 1 });
  const runId = h.harness.createRun("q");
  await h.harness.execute(runId);

  const snapshot = h.store.snapshot(runId)!;
  assert.equal(snapshot.status, "completed");
  const researchArtifact = snapshot.artifacts.find((a: any) => a.type === "research")!;
  const research = researchArtifact.content;
  assert.equal(research.queries.length, MODEL_WRITABLE_QUERY_CAP + 1);
  assert.deepEqual(
    research.queries.map((query: any) => query.evidence_id),
    snapshot.tool_evidence
      .filter((row: any) => row.attempt_id === researchArtifact.attempt_id)
      .map((row: any) => row.id),
  );
  // 模型只写得下 12 条，第 13 条是漏报 —— 记成一条漂移，不是一次死亡。
  const drift = queryDrift(snapshot);
  assert.equal(drift.length, 1);
  assert.equal(drift[0]!.payload.missing_count, 1);
  assert.equal(drift[0]!.payload.invented_count, 0);
  h.store.close();
});

test("still refuses a citation hung on a search that never ran", async () => {
  // citations 是模型的**选择**行为，不是转录：这道成员性校验一字未动。
  const h = harness({ inventsACitation: true });
  const runId = h.harness.createRun("q");
  await h.harness.execute(runId);

  const snapshot = h.store.snapshot(runId)!;
  assert.equal(snapshot.status, "failed");
  assert.equal(snapshot.error_code, "invalid_output");
  assert.deepEqual(snapshot.artifacts, []);
  h.store.close();
});

test("failed searches cannot support Research claims", async () => {
  const h = harness({ claimsFailedSearch: true });
  const runId = h.harness.createRun("q");
  await h.harness.execute(runId);

  const snapshot = h.store.snapshot(runId)!;
  assert.equal(snapshot.status, "failed");
  assert.equal(snapshot.error_code, "invalid_output");
  h.store.close();
});

test("claims can only use evidence frozen in the Research citations", async () => {
  const h = harness({ claimsUnfrozenSearch: true });
  const runId = h.harness.createRun("q");
  await h.harness.execute(runId);

  const snapshot = h.store.snapshot(runId)!;
  assert.equal(snapshot.status, "failed");
  assert.equal(snapshot.error_code, "invalid_output");
  h.store.close();
});

test("Evidence Review can only cite frozen Research evidence", async () => {
  const h = harness({ inventsReviewEvidence: true });
  const runId = h.harness.createRun("q");
  await h.harness.execute(runId);

  const snapshot = h.store.snapshot(runId)!;
  assert.equal(snapshot.status, "failed");
  assert.equal(snapshot.attempts.at(-1)!.role, "evidence-review");
  h.store.close();
});

test("Evidence Review must independently assess every Hypothesis candidate", async () => {
  const h = harness({ omitsCandidateAssessment: true });
  const runId = h.harness.createRun("q");
  await h.harness.execute(runId);

  const snapshot = h.store.snapshot(runId)!;
  assert.equal(snapshot.status, "failed");
  assert.equal(snapshot.error_code, "invalid_output");
  assert.equal(snapshot.attempts.at(-1)!.role, "evidence-review");
  h.store.close();
});

test("candidate gate fail-closes when selected verdict is contradicts (no research-plan)", async () => {
  const h = harness({ selectedVerdict: "contradicts" });
  const runId = h.harness.createRun("q");
  await h.harness.execute(runId);

  const snapshot = h.store.snapshot(runId)!;
  assert.equal(snapshot.status, "failed");
  assert.equal(snapshot.error_code, "invalid_output");
  assert.equal(h.calls.filter((c) => c.role === "research-plan").length, 0);
  assert.equal(h.calls.filter((c) => c.role === "reviewer").length, 0);
  assert.deepEqual(
    h.calls.map((c) => c.role),
    ["researcher", "hypothesis-generation", "evidence-review"],
  );
  const gate = snapshot.recent_events.find((e: any) => e.kind === "evaluation.candidate_gate");
  assert.ok(gate);
  assert.equal(gate!.payload.selected_candidate_id, "evidence-gate");
  assert.equal(gate!.payload.verdict, "contradicts");
  assert.equal(gate!.payload.promoted, false);
  h.store.close();
});

test("candidate gate fail-closes when selected verdict is uncertain", async () => {
  const h = harness({ selectedVerdict: "uncertain" });
  const runId = h.harness.createRun("q");
  await h.harness.execute(runId);

  const snapshot = h.store.snapshot(runId)!;
  assert.equal(snapshot.status, "failed");
  assert.equal(snapshot.error_code, "invalid_output");
  assert.equal(h.calls.filter((c) => c.role === "research-plan").length, 0);
  const gate = snapshot.recent_events.find((e: any) => e.kind === "evaluation.candidate_gate");
  assert.ok(gate);
  assert.equal(gate!.payload.selected_verdict, "uncertain");
  assert.equal(gate!.payload.promoted, false);
  assert.equal(gate!.payload.supports_count, 0);
  h.store.close();
});

test.each(["uncertain", "contradicts"] as const)(
  "candidate gate promotes an alternate supports candidate when selected is %s",
  async (selectedVerdict) => {
    const h = harness({ selectedVerdict, alternateVerdict: "supports" });
    const runId = h.harness.createRun("q");
    await h.harness.execute(runId);

    const snapshot = h.store.snapshot(runId)!;
    assert.equal(snapshot.status, "completed");
    assert.ok(h.calls.some((c) => c.role === "research-plan"));
    const planCall = h.calls.find((c) => c.role === "research-plan");
    assert.match(String(planCall!.input.goal), /prompt-only/);
    const gate = snapshot.recent_events.find((e: any) => e.kind === "evaluation.candidate_gate");
    assert.ok(gate);
    assert.equal(gate!.payload.selected_candidate_id, "evidence-gate");
    assert.equal(gate!.payload.selected_verdict, selectedVerdict);
    assert.equal(gate!.payload.promoted_candidate_id, "prompt-only");
    assert.equal(gate!.payload.verdict, "supports");
    assert.equal(gate!.payload.promoted, true);
    assert.equal(gate!.payload.selection_overridden, true);
    assert.equal(gate!.payload.supports_count, 1);
    const plan = h.store.latestArtifact(runId, "research-plan")!.content as ResearchPlan;
    assert.deepEqual(
      plan.execution_plan.predictions.map((prediction) => prediction.candidate_id),
      ["prompt-only"],
    );
    assert.equal(planCall!.input.promoted_candidate_id, "prompt-only");
    const frozenHypothesis = h.store.latestArtifact(runId, "hypothesis")!.content as {
      comparison: { selected_candidate_id: string };
    };
    assert.equal(frozenHypothesis.comparison.selected_candidate_id, "evidence-gate");
    h.store.close();
  },
);

test("candidate gate promotes selected when its verdict is supports", async () => {
  const h = harness({ selectedVerdict: "supports" });
  const runId = h.harness.createRun("q");
  await h.harness.execute(runId);

  const snapshot = h.store.snapshot(runId)!;
  assert.equal(snapshot.status, "completed");
  assert.ok(h.calls.some((c) => c.role === "research-plan"));
  const gate = snapshot.recent_events.find((e: any) => e.kind === "evaluation.candidate_gate");
  assert.ok(gate);
  assert.equal(gate!.payload.selected_candidate_id, "evidence-gate");
  assert.equal(gate!.payload.promoted_candidate_id, "evidence-gate");
  assert.equal(gate!.payload.verdict, "supports");
  assert.equal(gate!.payload.promoted, true);
  assert.equal(gate!.payload.selection_overridden, false);
  h.store.close();
});

test("candidate gate runs after the gaps loop, not instead of it", async () => {
  // 首轮 gaps 触发补证；第二轮 supports → 闸放行。证明闸在循环之后。
  const h = harness({ gapOnce: true, selectedVerdict: "supports" });
  const runId = h.harness.createRun("q");
  await h.harness.execute(runId);

  const snapshot = h.store.snapshot(runId)!;
  assert.equal(snapshot.status, "completed");
  assert.equal(h.calls.filter((c) => c.role === "evidence-review").length, 2);
  assert.equal(h.calls.filter((c) => c.role === "research-plan").length, 1);
  const gate = snapshot.recent_events.find((e: any) => e.kind === "evaluation.candidate_gate");
  assert.ok(gate);
  assert.equal(gate!.payload.verdict, "supports");
  assert.equal(gate!.payload.promoted, true);
  h.store.close();
});

test("candidate gate fail-closes after gaps loop when final verdict contradicts", async () => {
  const h = harness({ gapOnce: true, selectedVerdict: "contradicts" });
  const runId = h.harness.createRun("q");
  await h.harness.execute(runId);

  const snapshot = h.store.snapshot(runId)!;
  assert.equal(snapshot.status, "failed");
  assert.equal(snapshot.error_code, "invalid_output");
  // 补证两轮都跑完，但绝不进 research-plan
  assert.equal(h.calls.filter((c) => c.role === "evidence-review").length, 2);
  assert.equal(h.calls.filter((c) => c.role === "research-plan").length, 0);
  const gate = snapshot.recent_events.find((e: any) => e.kind === "evaluation.candidate_gate");
  assert.ok(gate);
  assert.equal(gate!.payload.verdict, "contradicts");
  assert.equal(gate!.payload.promoted, false);
  h.store.close();
});

/** 这个 run 里全部漂移记录，按事件顺序。 */
function driftEvents(snapshot: any): any[] {
  return snapshot.recent_events.filter((event: any) => event.kind === "artifact.field_overwritten");
}

test("restores the frozen question a Hypothesis rewrote, and records the drift", async () => {
  const h = harness({ rewritesHypothesisQuestion: true });
  const runId = h.harness.createRun(FROZEN_QUESTION);
  await h.harness.execute(runId);

  const snapshot = h.store.snapshot(runId)!;
  // 改写不再打死 Attempt：question 是回显字段，代码写定就是了。
  assert.equal(snapshot.status, "completed");
  const hypothesis = snapshot.artifacts.find((a: any) => a.type === "hypothesis")!.content;
  assert.equal(hypothesis.question, FROZEN_QUESTION);

  // 覆写救回了这一步，所以它必须留痕 —— 漂移是证据不是秘密。
  const drift = driftEvents(snapshot);
  assert.equal(drift.length, 1);
  assert.equal(drift[0]!.payload.artifact_type, "hypothesis");
  assert.equal(drift[0]!.payload.field, "question");
  assert.equal(drift[0]!.payload.before, DRIFTED_QUESTION);
  assert.equal(drift[0]!.payload.after, FROZEN_QUESTION);
  // 事件顺序要说得通：先记覆写，再发布那份被覆写过的产物。
  const published = snapshot.recent_events
    .filter((e: any) => e.kind === "artifact.published")
    .find((e: any) => e.payload.artifact_type === "hypothesis")!;
  assert.ok(drift[0]!.version < published.version);
  h.store.close();
});

test("restores the frozen question a Research Artifact rewrote", async () => {
  const h = harness({ rewritesResearchQuestion: true });
  const runId = h.harness.createRun(FROZEN_QUESTION);
  await h.harness.execute(runId);

  const snapshot = h.store.snapshot(runId)!;
  assert.equal(snapshot.status, "completed");
  const research = snapshot.artifacts.find((a: any) => a.type === "research")!.content;
  assert.equal(research.question, FROZEN_QUESTION);
  const drift = driftEvents(snapshot);
  assert.equal(drift.length, 1);
  assert.equal(drift[0]!.payload.artifact_type, "research");
  assert.equal(drift[0]!.payload.before, DRIFTED_QUESTION);

  // 下游拿到的是冻结值：Research 的 question 会随冻结输入原样传给后面每个角色，
  // 改写不覆写就等于让一份被截断的题面替代原题在流水线里往下走。
  for (const call of h.calls.filter((item) => item.role !== "researcher")) {
    for (const input of call.input.input_artifacts as any[]) {
      if (input.type === "research") assert.equal(input.content.question, FROZEN_QUESTION);
    }
  }
  h.store.close();
});

test("writes no drift record when the model copies the frozen question verbatim", async () => {
  const h = harness();
  const runId = h.harness.createRun(FROZEN_QUESTION);
  await h.harness.execute(runId);

  const snapshot = h.store.snapshot(runId)!;
  assert.equal(snapshot.status, "completed");
  // 覆写没发生就不该有记录 —— 每个 run 都挂一条会让这条事件什么也不说明。
  // queries 同理：模型转录得与台账逐条一致时，一条漂移事件都不该落。
  assert.deepEqual(driftEvents(snapshot), []);
  h.store.close();
});

test("records the drift of the accepted round only", async () => {
  // 首轮改写了 question，又引了一条不存在的证据：漂移记下了，可这份产物从未发布。
  // 纠错轮仍然改写 question —— 落库的事实只有一条，不是两条。
  let call = 0;
  const research = {
    id: "art_research",
    type: "research",
    content: {
      queries: [{ evidence_id: "ev_1" }],
      citations: [{ evidence_id: "ev_1", url: null }],
    },
  };
  const execute: StageExecutor = ({ agent }) => {
    call += 1;
    return reportStructuredOutput(agent, {
      artifact_type: "hypothesis",
      question: DRIFTED_QUESTION,
      candidates: [
        {
          candidate_id: "evidence-gate",
          claim_status: "candidate",
          core_claim: "证据门降低无来源引用。",
          basis: "冻结证据可审计。",
          supporting_evidence_ids: call === 1 ? ["ev_never_existed"] : ["ev_1"],
          opposing_evidence_ids: [],
          falsifiable_predictions: ["无来源引用率低于基线。"],
          alternative_explanations: ["提示词服从度差异。"],
          uncertainty: ["尚未完成配对验证。"],
          boundaries: ["仅限引用可靠性。"],
          validation_conditions: ["使用预注册的配对基准。"],
        },
        {
          candidate_id: "prompt-only",
          claim_status: "candidate",
          core_claim: "提示词约束也可能降低无来源引用。",
          basis: "提示词可能改变模型行为。",
          supporting_evidence_ids: ["ev_1"],
          opposing_evidence_ids: [],
          falsifiable_predictions: ["提示词约束组低于基线。"],
          alternative_explanations: ["任务难度差异。"],
          uncertainty: ["无法保证 ID 真实存在。"],
          boundaries: ["不覆盖来源真实性。"],
          validation_conditions: ["固定问题集和模型。"],
        },
      ],
      comparison: {
        criteria: [{ criterion: "可核验性", rationale: "证据 ID 必须可回查。" }],
        evaluations: [
          {
            candidate_id: "evidence-gate",
            rank: 1,
            strengths: ["代码可验收。"],
            weaknesses: ["有额外结构成本。"],
            evidence_ids: ["ev_1"],
            rationale: "优先验证。",
          },
          {
            candidate_id: "prompt-only",
            rank: 2,
            strengths: ["成本低。"],
            weaknesses: ["可能捏造 ID。"],
            evidence_ids: ["ev_1"],
            rationale: "保留对照。",
          },
        ],
        selected_candidate_id: "evidence-gate",
        selection_rationale: "选择可核验候选进入计划。",
      },
      selection_status: "candidate_selected",
      research_artifact_ids: ["art_research"],
    });
  };

  const result = await runTask(
    {
      runId: "run",
      taskId: "attempt",
      role: "hypothesis-generation",
      goal: "基于全部冻结 Research Artifact 生成可证伪假设",
      question: FROZEN_QUESTION,
      inputArtifactIds: ["art_research"],
      inputArtifacts: [research],
    },
    { execute },
  );

  assert.equal(result.corrections, 1);
  assert.equal((result.artifact as { question: string }).question, FROZEN_QUESTION);
  assert.deepEqual(
    result.drift.map((item) => item.field),
    ["question"],
  );
});

test("runs exactly one supplementary research round", async () => {
  const h = harness({ gapOnce: true });
  const runId = h.harness.createRun("q");
  await h.harness.execute(runId);

  assert.equal(h.store.snapshot(runId)!.status, "completed");
  assert.deepEqual(
    h.calls.map((c) => c.role),
    [
      "researcher",
      "hypothesis-generation",
      "evidence-review",
      "researcher",
      "hypothesis-generation",
      "evidence-review",
      "research-plan",
      "reviewer",
    ],
  );
  const secondHypothesis = h.calls.filter((call) => call.role === "hypothesis-generation")[1]!;
  const secondReview = h.calls.filter((call) => call.role === "evidence-review")[1]!;
  assert.equal(secondHypothesis.input.input_artifacts.filter((item: any) => item.type === "research").length, 2);
  assert.equal(secondReview.input.input_artifacts.filter((item: any) => item.type === "research").length, 2);
  h.store.close();
});

test("rejects a supplementary round that repeats every inherited search", async () => {
  const h = harness({ gapOnce: true, repeatsSupplementarySearch: true });
  const runId = h.harness.createRun("q");
  await h.harness.execute(runId);

  const snapshot = h.store.snapshot(runId)!;
  assert.equal(snapshot.status, "failed");
  assert.equal(snapshot.error_code, "invalid_output");
  assert.equal(snapshot.attempts.at(-1)!.role, "researcher");
  h.store.close();
});

test("reviewer reject terminates as review_rejected without replanning", async () => {
  const h = harness({ rejectReviews: 1 });
  const runId = h.harness.createRun("q");
  await h.harness.execute(runId);

  const snapshot = h.store.snapshot(runId)!;
  // review_rejected 是独立终态，不是 failed —— 合同内的正常终止
  assert.equal(snapshot.status, "review_rejected");
  assert.equal(snapshot.error_code, "review_rejected");
  assert.equal(snapshot.recent_events.at(-1)!.kind, "run.review_rejected");
  assert.equal(h.calls.filter((c) => c.role === "research-plan").length, 1);
  assert.equal(h.calls.filter((c) => c.role === "reviewer").length, 1);
  const feedback = snapshot.recent_events.filter((event: any) => event.kind === "feedback.received");
  assert.deepEqual(
    feedback.map((event: any) => [event.payload.source, event.payload.round, event.payload.action]),
    [["model_reviewer", 1, "stop"]],
  );
  assert.equal(
    snapshot.recent_events.some((event: any) => event.kind === "revision.applied"),
    false,
  );
  h.store.close();
});

test("queued researcher feedback terminates without rewriting the plan", async () => {
  let releaseReviewer!: () => void;
  const reviewerGate = new Promise<void>((resolve) => {
    releaseReviewer = resolve;
  });
  const h = harness({ beforeFirstReviewer: () => reviewerGate });
  const runId = h.harness.createRun("q");
  const execution = h.harness.execute(runId);
  for (let tick = 0; tick < 100 && h.store.snapshot(runId)!.current_role !== "reviewer"; tick += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  h.store.submitResearcherFeedback(runId, { id: "human-1", text: "补充失败结果对应的回退条件" });
  releaseReviewer();
  const outcome = await execution;

  assert.equal(outcome.status, "review_rejected");
  const planCalls = h.calls.filter((call) => call.role === "research-plan");
  assert.equal(planCalls.length, 1);
  assert.equal(h.calls.filter((call) => call.role === "reviewer").length, 1);
  assert.equal(
    h.store.eventsAfter(runId, 0).some((event) => event.kind === "revision.applied"),
    false,
  );
  const humanFeedback = h.store
    .eventsAfter(runId, 0)
    .find((event) => event.kind === "feedback.received" && event.payload.feedback_source === "human");
  assert.equal(humanFeedback?.payload.source, "researcher");
  h.store.close();
});

test("records a single-shot evaluation round without inventing human feedback", async () => {
  const h = harness({ rejectReviews: 1 });
  const runId = h.harness.createRun("q");
  await h.harness.execute(runId);

  const snapshot = h.store.snapshot(runId)!;
  const evaluations = snapshot.recent_events.filter((event: any) => event.kind === "evaluation.round");
  assert.equal(evaluations.length, 1);
  assert.deepEqual(
    evaluations.map((event: any) => [event.payload.round, event.payload.phase, event.payload.action]),
    [[1, "raw", "stop"]],
  );

  const first = evaluations[0]!.payload;
  assert.equal(first.evaluator, "model_reviewer");
  assert.equal(first.target, "research-plan");
  assert.equal(first.sample, "one run / one research plan");
  assert.equal(first.sample_size, 1);
  assert.equal(first.rubric_version, "review-v2");
  assert.match(first.scientific_rationale, /科学/);
  assert.equal(first.feedback_source, "auto");
  assert.equal(first.raw_plan_artifact_id, first.plan_artifact_id);
  assert.equal(first.raw_review_artifact_id, first.review_artifact_id);
  assert.equal(first.score_before_total, null);
  assert.equal(first.score_delta_total, null);
  assert.equal(first.cost_delta_tokens, null);
  assert.equal(first.rollback_reason, null);
  assert.equal(first.stop_reason, "reviewer_rejected");
  assert.equal(first.retry_reason, null);
  assert.equal(first.changed_fields, "");
  assert.equal(first.feedback_artifact_id, first.review_artifact_id);
  assert.equal(
    snapshot.recent_events.some((event: any) => event.kind === "feedback.received" && event.payload.source === "human"),
    false,
  );
  h.store.close();
});

test("reviewer accept still completes on the deterministic path", async () => {
  const h = harness();
  const runId = h.harness.createRun("q");
  const outcome = await h.harness.execute(runId);

  assert.equal(outcome.status, "completed");
  assert.equal(outcome.errorCode, null);
  assert.ok(outcome.finalArtifactId);
  assert.equal(h.calls.filter((c) => c.role === "research-plan").length, 1);
  assert.equal(h.calls.filter((c) => c.role === "reviewer").length, 1);

  const snapshot = h.store.snapshot(runId)!;
  assert.equal(snapshot.status, "completed");
  const evaluations = snapshot.recent_events.filter((event: any) => event.kind === "evaluation.round");
  assert.equal(evaluations.length, 1);
  assert.deepEqual(
    [evaluations[0]!.payload.round, evaluations[0]!.payload.phase, evaluations[0]!.payload.action],
    [1, "raw", "accept"],
  );
  assert.equal(evaluations[0]!.payload.stop_reason, "reviewer_accepted");
  assert.equal(
    snapshot.recent_events.some((event: any) => event.kind === "revision.applied"),
    false,
  );
  assert.equal(snapshot.recent_events.at(-1)!.kind, "run.completed");
  h.store.close();
});

test("evidence IDs use the full Attempt ID namespace", async () => {
  const h = harness();
  const runId = h.harness.createRun("q");
  await h.harness.execute(runId);

  const snapshot = h.store.snapshot(runId)!;
  for (const row of snapshot.tool_evidence) {
    assert.ok(row.id.includes(row.attempt_id), `${row.id} does not contain ${row.attempt_id}`);
  }
  h.store.close();
});

test("keeps a structural correction inside one business Attempt", async () => {
  const h = harness({ invalidPlanOnce: true });
  const runId = h.harness.createRun("q");
  await h.harness.execute(runId);

  const snapshot = h.store.snapshot(runId)!;
  assert.equal(snapshot.status, "completed");
  // 模型被调了两次，但只留下一个 Attempt，纠错次数记在它自己身上
  assert.equal(h.calls.filter((c) => c.role === "research-plan").length, 2);
  const planAttempts = snapshot.attempts.filter((a: any) => a.role === "research-plan");
  assert.equal(planAttempts.length, 1);
  assert.equal(planAttempts[0]!.corrections, 1);
  const planCalls = h.calls.filter((call) => call.role === "research-plan");
  assert.ok(planCalls[1]!.timeoutMs < planCalls[0]!.timeoutMs);
  // 纠错在事件流里也留痕
  const corrections = snapshot.recent_events.filter((e: any) => e.kind === "sdk.structured_correction");
  assert.equal(corrections.length, 1);
  h.store.close();
});

test("records an execution-layer failure without spending the correction", async () => {
  const h = harness({ stageFails: true });
  const runId = h.harness.createRun("q");
  await h.harness.execute(runId);

  const snapshot = h.store.snapshot(runId)!;
  assert.equal(snapshot.status, "failed");
  assert.equal(snapshot.error_code, "deadline_exceeded");
  // 超时换个提示词重发也不会消失，所以只调用一次
  assert.equal(h.calls.length, 1);
  h.store.close();
});

test("a null executor failure still lands a durable Attempt failure", async () => {
  const h = harness({ primitiveFailure: true });
  const runId = h.harness.createRun("q");
  await h.harness.execute(runId);

  const snapshot = h.store.snapshot(runId)!;
  assert.equal(snapshot.status, "failed");
  assert.equal(snapshot.attempts.length, 1);
  assert.equal(snapshot.attempts[0]!.status, "failed");
  assert.equal(snapshot.attempts[0]!.corrections, 0);
  h.store.close();
});

test("persists every search into tool_evidence as it happens", async () => {
  const h = harness();
  const runId = h.harness.createRun("q");
  await h.harness.execute(runId);

  const store = h.store;
  const snapshot = store.snapshot(runId)!;
  assert.equal(snapshot.status, "completed");
  assert.equal(snapshot.tool_evidence.length, 2);
  const researchAttempt = snapshot.artifacts.find((item: any) => item.type === "research")!.attempt_id;
  const evidence = snapshot.tool_evidence.find((item: any) => item.attempt_id === researchAttempt)!;
  assert.equal(evidence.tool_name, "arxiv_search");
  assert.equal(evidence.status, "succeeded");
  assert.equal(evidence.output.citations[0].locator, citation.locator);
  // 事件流里也留痕，且 result_count 是代码数出来的
  const recorded = snapshot.recent_events.filter((e: any) => e.kind === "tool.evidence_recorded");
  assert.equal(recorded.length, 2);
  assert.equal(recorded[0]!.payload.result_count, sources.length);
  store.close();
});

test("keeps the searches of a failed attempt", async () => {
  const h = harness({ claimsFailedSearch: true });
  const runId = h.harness.createRun("q");
  await h.harness.execute(runId);

  const store = h.store;
  const snapshot = store.snapshot(runId)!;
  assert.equal(snapshot.status, "failed");
  assert.deepEqual(snapshot.artifacts, []);
  // Attempt 失败了，但它查过的检索都还在 —— 那正是排查为什么失败的材料。
  // 4 条而不是 2 条：首轮 2 次，纠错轮又是一次全新调用、又查了 2 次，两轮都该留痕。
  assert.equal(snapshot.tool_evidence.length, 4);
  assert.deepEqual(
    snapshot.tool_evidence.map((e: any) => e.status),
    ["succeeded", "empty", "succeeded", "empty"],
  );
  // 纠错轮是独立的第二次调用，看不到首轮 tool conversation，必须显式交还已冻结检索。
  const correction = h.calls.filter((call) => call.role === "researcher")[1]!.input;
  assert.equal(correction.frozen_searches.length, 2);
  assert.equal(correction.frozen_searches[1].status, "empty");
  store.close();
});

test("records the deterministic reference verdict before completing", async () => {
  const h = harness();
  const runId = h.harness.createRun("q");
  await h.harness.execute(runId);

  const snapshot = h.store.snapshot(runId)!;
  assert.equal(snapshot.status, "completed");
  const verified = snapshot.recent_events.filter((e: any) => e.kind === "verification.references");
  assert.equal(verified.length, 1);
  assert.equal(verified[0]!.payload.ok, true);
  assert.equal(verified[0]!.payload.reference_count, sources.length);
  // 五条引用全部提得出 arXiv id，所以全部走了独立反查，没有只做归属检查的
  assert.equal(verified[0]!.payload.arxiv_checked, sources.length);
  assert.equal(verified[0]!.payload.doi_checked, 0);
  assert.equal(verified[0]!.payload.membership_only, 0);
  assert.equal(verified[0]!.payload.infra_error, false);
  // 验收发生在终态之前：run.completed 是最后一条
  assert.equal(snapshot.recent_events.at(-1)!.kind, "run.completed");
  h.store.close();
});

test("fails an accepted plan whose references are too few to verify", async () => {
  const h = harness({ thinReferences: true });
  const runId = h.harness.createRun("q");
  await h.harness.execute(runId);

  const snapshot = h.store.snapshot(runId)!;
  assert.equal(snapshot.status, "failed");
  assert.equal(snapshot.error_code, "verifier_refs");
  // Run 级的门，不是 Attempt 级的：五个角色都成功了，产物也都还在
  assert.equal(
    snapshot.attempts.every((a: any) => a.status === "completed"),
    true,
  );
  assert.equal(snapshot.artifacts.length, 5);
  assert.equal(snapshot.final_artifact_id, null);
  const verdict = snapshot.recent_events.find((e: any) => e.kind === "verification.references")!;
  assert.equal(verdict.payload.ok, false);
  assert.deepEqual(verdict.payload.failed, ["B3.count"]);
  h.store.close();
});

test("treats an arXiv outage as infra_error rather than fabricated citations", async () => {
  const h = harness({ lookupFails: true });
  const runId = h.harness.createRun("q");
  await h.harness.execute(runId);

  const snapshot = h.store.snapshot(runId)!;
  assert.equal(snapshot.status, "failed");
  assert.equal(snapshot.error_code, "infra_error");
  const verdict = snapshot.recent_events.find((e: any) => e.kind === "verification.references")!;
  assert.equal(verdict.payload.infra_error, true);
  assert.equal(verdict.payload.arxiv_checked, 0);
  // 反查不通只记一条「结论未取得」，不给每条引用扣一顶造假的帽子
  assert.deepEqual(verdict.payload.failed, ["B2.resolve"]);
  h.store.close();
});

test("keeps a quality failure ahead of an arXiv outage", async () => {
  const h = harness({ thinReferences: true, lookupFails: true });
  const runId = h.harness.createRun("q");
  await h.harness.execute(runId);

  const snapshot = h.store.snapshot(runId)!;
  // 网络好坏改变不了 B3 的结论，失败码必须记质量失败
  assert.equal(snapshot.error_code, "verifier_refs");
  h.store.close();
});

test("does not verify references when the Reviewer rejects the plan", async () => {
  const h = harness({ rejectReviews: 1 });
  const runId = h.harness.createRun("q");
  await h.harness.execute(runId);

  const snapshot = h.store.snapshot(runId)!;
  assert.equal(snapshot.status, "review_rejected");
  assert.deepEqual(
    snapshot.recent_events.filter((e: any) => e.kind === "verification.references"),
    [],
  );
  h.store.close();
});

test("rejects late evidence without mutating the ledger and records the drop", () => {
  const store = new SqliteStore(":memory:");
  const runId = store.createRun("q");
  const attemptId = store.startAttempt(runId, "researcher");
  store.failAttempt(runId, attemptId, { code: "deadline_exceeded", reason: "late" }, "StageError", 0);
  const before = store.snapshot(runId)!.recent_events.length;

  store.recordEvidence(runId, attemptId, {
    evidenceId: "ev_late",
    tool: "arxiv_search",
    sourceType: "arxiv",
    query: "late query",
    status: "succeeded",
    resultSummary: "late result",
    citations: [citation],
  });

  const snapshot = store.snapshot(runId)!;
  assert.deepEqual(snapshot.tool_evidence, []);
  assert.equal(snapshot.recent_events.length, before + 1);
  assert.deepEqual(snapshot.recent_events.at(-1), {
    id: snapshot.recent_events.at(-1)!.id,
    version: snapshot.recent_events.at(-1)!.version,
    kind: "tool.evidence_dropped",
    payload: {
      tool_name: "arxiv_search",
      status: "succeeded",
      reason: "attempt_not_running",
    },
    created_at: snapshot.recent_events.at(-1)!.created_at,
  });
  store.close();
});

for (const verifierFails of [false, true]) {
  test(`late verifier preserves the settled outcome and cannot inject success (fails=${verifierFails})`, async () => {
    const directory = mkdtempSync(join(tmpdir(), "luup-terminal-race-"));
    const store = new SqliteStore(":memory:");
    onTestFinished(() => {
      store.close();
      rmSync(directory, { recursive: true, force: true });
    });
    const fixture = fake();
    const memory = new CampaignMemory({ memoryDir: directory, locate: (id) => `test.db#${id}` });
    let enter!: () => void;
    let resume!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const release = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const verifier = createReferenceVerifier({ lookup: fixtureLookup });
    const runner = new Harness(store, fixture.execute, {
      memory,
      createLedger: (scope) => {
        const ledger = new EvidenceLedger({
          namespace: `${scope.attemptId}_`,
          onRecord: (record) => store.recordEvidence(scope.runId, scope.attemptId, record),
        });
        fixture.useLedger(ledger);
        return ledger;
      },
      verifyReferences: async (input) => {
        const result = await verifier(input);
        assert.equal(result.ok, true);
        enter();
        await release;
        if (verifierFails) throw new Error("late verifier failure");
        return result;
      },
    });
    const runId = store.createRun(FROZEN_QUESTION, { science125Id: 1 });
    const running = runner.execute(runId);
    await entered;
    assert.equal(store.settleAbandonedRun(runId, "infra_timeout", "BatchTimeout"), true);
    resume();
    const outcome = await running;
    assert.deepEqual(outcome, { status: "failed", finalArtifactId: null, errorCode: "infra_timeout" });
    assert.equal(store.snapshot(runId)!.status, "failed");
    assert.equal(store.snapshot(runId)!.error_code, "infra_timeout");
    assert.equal(store.snapshot(runId)!.final_artifact_id, null);
    const log = readFileSync(join(directory, "log.md"), "utf8");
    assert.match(log, /FAILED/);
    assert.match(log, /cls=infra_timeout/);
    assert.equal(existsSync(join(directory, "questions/q1.md")), false);
    assert.deepEqual(memory.readPriorAttempts(1).entries, []);
  });
}

test("executing a completed run returns durable facts without duplicating campaign success", async () => {
  const directory = mkdtempSync(join(tmpdir(), "luup-repeat-run-"));
  const store = new SqliteStore(":memory:");
  onTestFinished(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const fixture = fake();
  const memory = new CampaignMemory({ memoryDir: directory, locate: (id) => `test.db#${id}` });
  const runner = new Harness(store, fixture.execute, {
    memory,
    verifyReferences: createReferenceVerifier({ lookup: fixtureLookup }),
    createLedger: (scope) => {
      const ledger = new EvidenceLedger({
        namespace: `${scope.attemptId}_`,
        onRecord: (record) => store.recordEvidence(scope.runId, scope.attemptId, record),
      });
      fixture.useLedger(ledger);
      return ledger;
    },
  });
  const runId = store.createRun(FROZEN_QUESTION, { science125Id: 1 });
  const outcome = await runner.execute(runId);
  assert.equal(outcome.status, "completed");
  const snapshot = store.snapshot(runId);
  const log = readFileSync(join(directory, "log.md"), "utf8");
  const page = readFileSync(join(directory, "questions/q1.md"), "utf8");
  assert.match(page, /SUCCESS/);
  assert.deepEqual(await runner.execute(runId), outcome);
  assert.deepEqual(store.snapshot(runId), snapshot);
  assert.equal(readFileSync(join(directory, "log.md"), "utf8"), log);
  assert.equal(readFileSync(join(directory, "questions/q1.md"), "utf8"), page);
  assert.equal(memory.readPriorAttempts(1).entries.length, 1);
});

test("a model accept with a failed foundation terminates before verification or replanning", async () => {
  const h = harness({ blockingFoundation: true });
  const runId = h.harness.createRun("q");
  await h.harness.execute(runId);
  const snapshot = h.store.snapshot(runId)!;
  assert.equal(snapshot.status, "review_rejected");
  assert.equal(snapshot.final_artifact_id, null);
  assert.equal(h.calls.filter((call) => call.role === "research-plan").length, 1);
  assert.equal(h.calls.filter((call) => call.role === "reviewer").length, 1);
  const reviewerInput = h.calls.find((call) => call.role === "reviewer")!;
  assert.ok(reviewerInput.input.input_artifacts.some((item: { type: string }) => item.type === "research"));
  assert.equal(
    snapshot.recent_events.some((event: { kind: string }) => event.kind.startsWith("verification.")),
    false,
  );
  h.store.close();
});
