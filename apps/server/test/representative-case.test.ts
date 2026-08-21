import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onTestFinished, test } from "bun:test";

import {
  buildRepresentativeCase,
  exportRepresentativeCase,
  renderRepresentativeCaseMarkdown,
} from "../src/submission/representative-case.ts";
import { SqliteStore } from "../src/store/store.ts";

function testStore(): SqliteStore {
  const store = new SqliteStore(":memory:");
  onTestFinished(() => store.close());
  return store;
}

function artifact(store: SqliteStore, runId: string, role: Parameters<SqliteStore["startAttempt"]>[1]): string {
  const attemptId = store.startAttempt(runId, role);
  const type =
    role === "researcher"
      ? "research"
      : role === "hypothesis-generation"
        ? "hypothesis"
        : role === "reviewer"
          ? "review"
          : role;
  return store.publishArtifact(runId, attemptId, { artifact_type: type } as never, [], 0).id;
}

function publishPublicArtifact(
  store: SqliteStore,
  runId: string,
  role: Parameters<SqliteStore["startAttempt"]>[1],
  content: Record<string, unknown>,
): string {
  const attemptId = store.startAttempt(runId, role);
  return store.publishArtifact(runId, attemptId, content as never, [], 0).id;
}

function publicResearch() {
  return {
    artifact_type: "research",
    question: "如何降低无来源引用？",
    research_framing: {
      research_object: "证据归因机制",
      scope: "固定模型和问题集",
      variables: [{ name: "证据门", role: "independent", operationalization: "是否启用" }],
      known: ["冻结证据可被核验。"],
      controversies: ["提示词是否足够仍有争议。"],
      unknowns: ["跨题效果未知。"],
      knowledge_gap: "缺少配对比较。",
      constraints: ["候选不等于结论。"],
    },
    summary: "冻结证据支撑可核验的研究问题。",
    claims: [{ statement: "证据门可能降低无来源引用。", evidence_ids: ["evidence-1"] }],
    queries: [
      {
        evidence_id: "evidence-1",
        source_type: "arxiv",
        query: "evidence attribution",
        status: "succeeded",
        result_summary: "结果摘要",
      },
    ],
    citations: [
      { evidence_id: "evidence-1", source_type: "arxiv", title: "Frozen evidence", locator: "arXiv:1", url: null },
    ],
    limitations: ["当前只是候选问题。"],
    prompt: "prompt must not export",
    internal_rationale: "INTERNAL_RATIONALE must not export",
  };
}

function publicHypothesis(researchId: string) {
  const candidate = (id: string, claim: string) => ({
    candidate_id: id,
    claim_status: "candidate",
    core_claim: claim,
    basis: "冻结证据可核验。",
    supporting_evidence_ids: ["evidence-1"],
    opposing_evidence_ids: [],
    falsifiable_predictions: ["无来源引用率下降。"],
    alternative_explanations: ["提示词服从度差异。"],
    uncertainty: ["跨题效果未知。"],
    boundaries: ["仅限引用可靠性。"],
    validation_conditions: ["固定问题集和模型。"],
  });
  return {
    artifact_type: "hypothesis",
    question: "如何降低无来源引用？",
    candidates: [candidate("H1", "证据门降低无来源引用。"), candidate("H2", "仅提示词也能降低无来源引用。")],
    comparison: {
      criteria: [{ criterion: "可核验性", rationale: "INTERNAL_RATIONALE must not export" }],
      evaluations: [
        {
          candidate_id: "H1",
          rank: 1,
          strengths: ["可确定性验收。"],
          weaknesses: ["需要额外结构。"],
          evidence_ids: ["evidence-1"],
          rationale: "private",
        },
        {
          candidate_id: "H2",
          rank: 2,
          strengths: ["成本较低。"],
          weaknesses: ["不能持有证据。"],
          evidence_ids: ["evidence-1"],
          rationale: "private",
        },
      ],
      selected_candidate_id: "H1",
      selection_rationale: "INTERNAL_RATIONALE must not export",
    },
    selection_status: "candidate_selected",
    research_artifact_ids: [researchId],
    prompt: "prompt must not export",
  };
}

function publicEvidenceReview(hypothesisId: string) {
  return {
    artifact_type: "evidence-review",
    hypothesis_artifact_id: hypothesisId,
    research_artifact_ids: ["research-artifact"],
    assessments: [
      { claim: "证据门降低无来源引用。", verdict: "uncertain", rationale: "private", evidence_ids: ["evidence-1"] },
    ],
    gaps: ["缺少配对基准。"],
    supported: false,
    internal_rationale: "INTERNAL_RATIONALE must not export",
  };
}

function publicPlan(phase: "raw" | "revised") {
  return {
    artifact_type: "research-plan",
    problem_statement: phase === "raw" ? "首轮问题定义。" : "修订后问题定义。",
    rationale: "内部说明 INTERNAL_RATIONALE 不得导出",
    technical_details: "固定模型和问题集。",
    datasets: ["预注册问题集"],
    source: "Frozen Artifacts",
    target: "降低无来源引用率。",
    execution_plan: {
      predictions: [{ candidate_id: "H1", prediction: "引用率下降。", falsification_criterion: "引用率不下降。" }],
      data_requirements: [{ source: "问题集", variables: ["引用率"], conditions: ["固定模型。"] }],
      steps: [
        { order: 1, action: "运行证据门组。", expected_output: "结构化产物。" },
        { order: 2, action: "核验引用。", expected_output: "逐题结果。" },
      ],
      analysis: [{ method: "配对比较", inputs: ["逐题结果"], decision_rule: "报告差值。" }],
      result_interpretations: [
        { observed_result: "引用率下降。", meaning: "支持预测。" },
        { observed_result: "引用率不变。", meaning: "否定预测。" },
      ],
      stop_conditions: ["证据不足时停止。"],
      rollback_conditions: ["引用无法核验时回退。"],
      supplement_evidence_conditions: ["冲突时补证。"],
    },
    paper_title: "证据门研究计划",
    paper_abstract: "待验证的计划摘要。",
    methods: "配对比较。",
    experiments: {
      baselines: [
        { name: "证据门组", evidence_id: "evidence-1" },
        { name: "对照组", evidence_id: "evidence-1" },
      ],
      metrics: [
        { name: "无来源引用率", evidence_id: "evidence-1" },
        { name: "完成率", evidence_id: "evidence-1" },
      ],
      design: "固定条件运行。",
    },
    results: {
      status: "pending_verification",
      validation_basis: "formula_derivation",
      feasibility_argument: "可以执行。",
      expected_outcomes: [{ metric: "引用率", statement: "待验证。" }],
    },
    references: ["Frozen Artifacts"],
    input_artifact_ids: ["research-artifact", "hypothesis-artifact", "evidence-review-artifact"],
    verification_evidence_ids: ["evidence-1"],
    prompt: "prompt must not export",
  };
}

function publicReview(accepted: boolean) {
  return {
    artifact_type: "review",
    research_plan_artifact_id: "plan-artifact",
    evidence_review_artifact_id: "evidence-review-artifact",
    independent_evidence_ids: ["evidence-1"],
    scores: { scientific_value: accepted ? 4 : 3, technical_depth: 4, application_potential: 4 },
    weaknesses: ["需要更多配对结果。"],
    feedback: [accepted ? "接受修订后的计划。" : "请补充可执行步骤。", "authorization=TOP_SECRET must not export"],
    suggested_successor_roles: ["research-plan"],
    accepted,
    prompt: "prompt must not export",
  };
}

test("representative export preserves the two-round audit spine without artifact bodies", () => {
  const store = testStore();
  const runId = store.createRun("Science-125 #1: What makes prime numbers so special?", { science125Id: 1 });
  const researchId = artifact(store, runId, "researcher");
  const hypothesisId = artifact(store, runId, "hypothesis-generation");
  const evidenceReviewId = artifact(store, runId, "evidence-review");
  const rawPlanId = artifact(store, runId, "research-plan");
  const rawReviewId = artifact(store, runId, "reviewer");
  const revisedPlanId = artifact(store, runId, "research-plan");
  const revisedReviewId = artifact(store, runId, "reviewer");

  store.emit(runId, "evaluation.round", {
    round: 1,
    phase: "raw",
    action: "revise",
    feedback_source: "auto",
    raw_plan_artifact_id: rawPlanId,
    raw_review_artifact_id: rawReviewId,
    plan_artifact_id: rawPlanId,
    review_artifact_id: rawReviewId,
    score_before_total: null,
    score_after_total: 7,
    score_delta_total: null,
    round_cost_tokens: 20_000,
    cost_delta_tokens: null,
    limitations_before_count: null,
    limitations_after_count: 4,
    limitation_delta_count: null,
  });
  store.emit(runId, "feedback.received", {
    source: "model_reviewer",
    feedback_source: "auto",
    round: 1,
    action: "revise",
    feedback_count: 4,
    feedback_artifact_id: rawReviewId,
  });
  store.emit(runId, "revision.applied", {
    round: 2,
    source: "model_reviewer",
    feedback_source: "auto",
    from_artifact_id: rawPlanId,
    to_artifact_id: revisedPlanId,
    changed_fields: "methods,execution_plan",
  });
  store.emit(runId, "evaluation.round", {
    round: 2,
    phase: "revision",
    action: "accept",
    feedback_source: "auto",
    raw_plan_artifact_id: rawPlanId,
    raw_review_artifact_id: rawReviewId,
    plan_artifact_id: revisedPlanId,
    review_artifact_id: revisedReviewId,
    score_before_total: 7,
    score_after_total: 8,
    score_delta_total: 1,
    round_cost_tokens: 30_000,
    cost_delta_tokens: 10_000,
    limitations_before_count: 4,
    limitations_after_count: 3,
    limitation_delta_count: -1,
    stop_reason: "reviewer_accepted",
  });
  store.emit(runId, "verification.references", {
    ok: true,
    reference_count: 7,
    frozen_sources: 7,
    arxiv_checked: 5,
    doi_checked: 2,
    membership_only: 0,
    failed_count: 0,
    infra_error: false,
    checks: [{ id: "B3.count", pass: true, detail: "internal detail must not export" }],
    failed: [],
  });
  store.emit(runId, "sdk.trace.started", { trace_id: "trace-1", role: "researcher", model: "qwen" });
  store.emit(runId, "sdk.trace.ended", {
    trace_id: "trace-1",
    role: "researcher",
    outcome: "completed",
    usage_requests: 1,
    usage_input_tokens: 10,
    usage_output_tokens: 5,
    usage_total_tokens: 15,
    usage_tool_calls: 1,
    trace_events: 4,
    truncated: false,
  });
  store.emit(runId, "sdk.usage", { agent: "researcher", input_tokens: 10, output_tokens: 5, total_tokens: 15 });
  store.finishRun(runId, "completed", { finalArtifactId: revisedPlanId });

  const exported = buildRepresentativeCase(store, runId, "2026-08-22T00:00:00.000Z");

  assert.equal(exported.run.science125_id, 1);
  assert.equal(exported.run.status, "completed");
  assert.deepEqual(exported.rounds.round1.raw_artifact_ids, {
    plan: rawPlanId,
    review: rawReviewId,
  });
  assert.equal(exported.rounds.round1.feedback.feedback_source, "auto");
  assert.deepEqual(exported.rounds.round2.revision.changed_fields, ["execution_plan", "methods"]);
  assert.deepEqual(exported.rounds.round2.score, { before: 7, after: 8, delta: 1 });
  assert.deepEqual(exported.rounds.round2.cost_tokens, { round: 30_000, delta: 10_000 });
  assert.deepEqual(exported.rounds.round2.limitations, { before: 4, after: 3, delta: -1 });
  assert.deepEqual(exported.verification, {
    status: "passed",
    ok: true,
    reference_count: 7,
    frozen_sources: 7,
    arxiv_checked: 5,
    doi_checked: 2,
    membership_only: 0,
    failed_count: 0,
    infra_error: false,
    check_count: 1,
    passed_check_count: 1,
    failed_check_count: 0,
    unknown_reasons: [],
  });
  assert.equal(exported.trace.traces, 1);
  assert.deepEqual(exported.trace.models, ["qwen"]);
  assert.equal(exported.trace.completed, 1);
  assert.equal(exported.usage.total_tokens, 15);
  assert.equal(exported.artifacts.research[0], researchId);
  assert.equal(exported.artifacts.hypothesis[0], hypothesisId);
  assert.equal(exported.artifacts.evidence_review[0], evidenceReviewId);
  assert.equal(exported.artifacts.research_plan.length, 2);
  assert.equal(exported.artifacts.review.length, 2);
  assert.doesNotMatch(JSON.stringify(exported), /internal detail must not export/);
  assert.doesNotMatch(JSON.stringify(exported), /content_json|QWEN_API_KEY|sdk\.output_rejected/);

  const markdown = renderRepresentativeCaseMarkdown(exported);
  assert.match(markdown, /science125_id.*1/);
  assert.match(markdown, /score delta.*1/);
  assert.match(markdown, /execution_plan/);
  assert.doesNotMatch(markdown, /internal detail must not export|QWEN_API_KEY/);
});

test("representative export includes only public projected round outputs and candidate comparison", () => {
  const store = testStore();
  const runId = store.createRun("Science-125 #1", { science125Id: 1 });
  const researchId = publishPublicArtifact(store, runId, "researcher", publicResearch());
  const hypothesisId = publishPublicArtifact(store, runId, "hypothesis-generation", publicHypothesis(researchId));
  const evidenceReviewId = publishPublicArtifact(store, runId, "evidence-review", publicEvidenceReview(hypothesisId));
  const rawPlanId = publishPublicArtifact(store, runId, "research-plan", publicPlan("raw"));
  const rawReviewId = publishPublicArtifact(store, runId, "reviewer", publicReview(false));
  const revisedPlanId = publishPublicArtifact(store, runId, "research-plan", publicPlan("revised"));
  const revisedReviewId = publishPublicArtifact(store, runId, "reviewer", publicReview(true));

  store.emit(runId, "evaluation.round", {
    round: 1,
    phase: "raw",
    action: "revise",
    feedback_source: "auto",
    raw_plan_artifact_id: rawPlanId,
    raw_review_artifact_id: rawReviewId,
    plan_artifact_id: rawPlanId,
    review_artifact_id: rawReviewId,
    score_after_total: 7,
    limitations_after_count: 4,
  });
  store.emit(runId, "feedback.received", {
    round: 1,
    source: "model_reviewer",
    feedback_source: "auto",
    action: "revise",
    feedback_count: 2,
    feedback_artifact_id: rawReviewId,
  });
  store.emit(runId, "revision.applied", {
    round: 2,
    source: "model_reviewer",
    feedback_source: "auto",
    from_artifact_id: rawPlanId,
    to_artifact_id: revisedPlanId,
    changed_fields: "execution_plan,methods",
  });
  store.emit(runId, "evaluation.round", {
    round: 2,
    phase: "revision",
    action: "accept",
    feedback_source: "auto",
    raw_plan_artifact_id: rawPlanId,
    raw_review_artifact_id: rawReviewId,
    plan_artifact_id: revisedPlanId,
    review_artifact_id: revisedReviewId,
    score_before_total: 7,
    score_after_total: 8,
    score_delta_total: 1,
    limitations_before_count: 4,
    limitations_after_count: 3,
    limitation_delta_count: -1,
  });
  store.emit(runId, "verification.references", { ok: true, checks: [] });
  store.finishRun(runId, "completed", { finalArtifactId: revisedPlanId });

  const exported = buildRepresentativeCase(store, runId, "2026-08-22T00:00:00.000Z");

  assert.equal(exported.public_artifacts.hypothesis[0]?.id, hypothesisId);
  assert.equal(exported.public_artifacts.evidence_review[0]?.id, evidenceReviewId);
  assert.equal(exported.rounds.round1.public_outputs.plan?.id, rawPlanId);
  assert.equal(exported.rounds.round1.public_outputs.review?.id, rawReviewId);
  assert.equal(exported.rounds.round2.public_outputs.plan?.id, revisedPlanId);
  assert.equal(exported.rounds.round2.public_outputs.review?.id, revisedReviewId);
  assert.equal(exported.rounds.round2.public_outputs.plan?.content.artifact_type, "research-plan");
  assert.equal(exported.public_artifacts.hypothesis[0]?.content.artifact_type, "hypothesis");

  const json = JSON.stringify(exported);
  assert.doesNotMatch(json, /prompt|INTERNAL_RATIONALE|QWEN_API_KEY|tool_raw|error_detail/i);

  const markdown = renderRepresentativeCaseMarkdown(exported);
  assert.match(markdown, /候选假设与比较/);
  assert.match(markdown, /Round 1.*公开研究计划/s);
  assert.match(markdown, /Round 2.*公开评审反馈/s);
  assert.match(markdown, /H1/);
  assert.match(markdown, /execution_plan/);
  assert.match(markdown, /changed fields: execution_plan, methods/);
  assert.doesNotMatch(markdown, /QWEN_API_KEY|INTERNAL_RATIONALE|tool_raw|error_detail/i);
});

test("representative export keeps failed and unknown facts explicit without leaking error text", () => {
  const store = testStore();
  const failedRunId = store.createRun("failed case", { science125Id: 9 });
  store.emit(failedRunId, "sdk.output_rejected", { reason: "QWEN_API_KEY=do-not-export" });
  store.emit(failedRunId, "sdk.usage", { agent: "researcher", input_tokens: "bad" });
  store.emit(failedRunId, "verification.references", { ok: false, failed: [{ detail: "secret" }] });
  store.finishRun(failedRunId, "failed", { errorCode: "verifier_refs" });

  const failed = buildRepresentativeCase(store, failedRunId, "2026-08-22T00:00:00.000Z");
  assert.equal(failed.run.status, "failed");
  assert.equal(failed.run.error_code, "verifier_refs");
  assert.equal(failed.verification.status, "failed");
  assert.equal(failed.usage.status, "partial");
  assert.ok(failed.unknown_reasons.includes("round1_evaluation_missing"));
  assert.doesNotMatch(JSON.stringify(failed), /QWEN_API_KEY|do-not-export|secret/);

  const unknown = buildRepresentativeCase(store, "missing-run", "2026-08-22T00:00:00.000Z");
  assert.equal(unknown.run.status, "unknown");
  assert.equal(unknown.run.science125_id, null);
  assert.ok(unknown.unknown_reasons.includes("run_not_found"));
  assert.doesNotMatch(JSON.stringify(unknown), /undefined/);
});

test("representative export writes JSON and Markdown side by side", () => {
  const store = testStore();
  const runId = store.createRun("case", { science125Id: 2 });
  const dir = mkdtempSync(join(tmpdir(), "luup-representative-case-"));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  const jsonPath = join(dir, "case.json");
  const markdownPath = join(dir, "case.md");

  const result = exportRepresentativeCase({
    dbPath: ":memory:",
    runId,
    jsonPath,
    markdownPath,
    generatedAt: "2026-08-22T00:00:00.000Z",
    store,
  });

  assert.equal(JSON.parse(readFileSync(jsonPath, "utf8")).run.status, "running");
  assert.equal(readFileSync(markdownPath, "utf8"), renderRepresentativeCaseMarkdown(result));
});

test("strict representative export requires the frozen question and auditable two-round facts", () => {
  const store = testStore();
  const runId = store.createRun("Science-125 #1", { science125Id: 1 });
  const attemptId = store.startAttempt(runId, "research-plan");
  const planId = store.publishArtifact(runId, attemptId, { artifact_type: "research-plan" } as never, [], 0).id;
  store.emit(runId, "evaluation.round", {
    round: 1,
    phase: "raw",
    action: "revise",
    plan_artifact_id: planId,
    review_artifact_id: planId,
    raw_plan_artifact_id: planId,
    raw_review_artifact_id: planId,
  });
  store.emit(runId, "feedback.received", {
    round: 1,
    source: "model_reviewer",
    feedback_source: "auto",
    action: "revise",
    feedback_count: 1,
    feedback_artifact_id: planId,
  });
  store.emit(runId, "revision.applied", {
    round: 2,
    from_artifact_id: planId,
    to_artifact_id: planId,
    changed_fields: "execution_plan",
  });
  store.emit(runId, "evaluation.round", {
    round: 2,
    phase: "revision",
    action: "accept",
    plan_artifact_id: planId,
    review_artifact_id: planId,
    raw_plan_artifact_id: planId,
    raw_review_artifact_id: planId,
  });
  store.emit(runId, "verification.references", {
    ok: true,
    checks: [
      { id: "B1.paper", pass: true },
      { id: "B2.paper", pass: true },
      { id: "B3.count", pass: true },
      { id: "B4.paper", pass: true },
    ],
  });
  store.emit(runId, "sdk.usage", {
    agent: "researcher",
    input_tokens: 10,
    output_tokens: 5,
    total_tokens: 15,
  });
  store.finishRun(runId, "completed", { finalArtifactId: planId });

  const dir = mkdtempSync(join(tmpdir(), "luup-representative-case-strict-"));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  const result = exportRepresentativeCase({
    dbPath: ":memory:",
    runId,
    jsonPath: join(dir, "case.json"),
    markdownPath: join(dir, "case.md"),
    strict: true,
    store,
    generatedAt: "2026-08-22T00:00:00.000Z",
  });

  assert.equal(result.strict?.passed, true);
  assert.deepEqual(result.strict?.reasons, []);
  assert.equal(JSON.parse(readFileSync(join(dir, "case.json"), "utf8")).strict.passed, true);
});

test("strict representative export reports every missing readiness fact", () => {
  const store = testStore();
  const runId = store.createRun("not a frozen question", { science125Id: 999 });
  const dir = mkdtempSync(join(tmpdir(), "luup-representative-case-strict-fail-"));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));

  const result = exportRepresentativeCase({
    dbPath: ":memory:",
    runId,
    jsonPath: join(dir, "case.json"),
    strict: true,
    store,
    generatedAt: "2026-08-22T00:00:00.000Z",
  });

  assert.equal(result.strict?.passed, false);
  assert.ok(result.strict?.reasons.includes("science125_id_not_in_frozen_catalog"));
  assert.ok(result.strict?.reasons.includes("run_not_completed"));
  assert.ok(result.strict?.reasons.includes("round1_missing"));
  assert.ok(result.strict?.reasons.includes("round2_missing"));
  assert.ok(result.strict?.reasons.includes("feedback_missing"));
  assert.ok(result.strict?.reasons.includes("revision_missing"));
  assert.ok(result.strict?.reasons.includes("verification_b1_missing"));
  assert.ok(result.strict?.reasons.includes("usage_missing_or_unknown"));
});
