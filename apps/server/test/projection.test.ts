import assert from "node:assert/strict";
import { test } from "vitest";

import { projectArtifact, projectRunEvent, projectRunSnapshot, projectSseFrame } from "../src/api/projection.ts";
import { SqliteStore } from "../src/store/store.ts";

/** 逐字模仿 SqliteStore.snapshot() 的产出：含全部内部字段。 */
function internalSnapshot(): Record<string, unknown> {
  return {
    id: "run_1",
    question: "证据门能降低无来源引用吗？",
    status: "running",
    current_role: "researcher",
    version: 4,
    budget_json: '{"max_turns":16}',
    error_code: null,
    final_artifact_id: null,
    created_at: "2026-08-06T00:00:00.000Z",
    updated_at: "2026-08-06T00:00:01.000Z",
    attempts: [
      {
        id: "attempt_1",
        run_id: "run_1",
        role: "researcher",
        ordinal: 1,
        status: "running",
        corrections: 0,
        failure_code: null,
        error_type: "ValidationError",
        started_at: "2026-08-06T00:00:00.000Z",
        finished_at: null,
      },
    ],
    tool_evidence: [
      {
        id: "ev_1",
        attempt_id: "attempt_1",
        tool_name: "crossref_search",
        query: "evidence gate",
        output_json: '{"result_summary":"1 record"}',
        status: "succeeded",
        created_at: "2026-08-06T00:00:00.000Z",
        output: {
          result_summary: "arXiv returned 1 citable record(s)",
          execution: { exception_type: "TimeoutError", message: "internal diagnostic" },
          documents: [{ path: "/data/doc.pdf", sha256: "abc" }],
          citations: [
            {
              evidence_id: "ev_1",
              source_type: "arxiv",
              title: "Fixture",
              locator: "arxiv:2301.00001v1",
              url: "https://arxiv.org/abs/2301.00001v1",
              document_id: "doc_1",
            },
          ],
        },
      },
      {
        id: "ev_2",
        attempt_id: "attempt_1",
        tool_name: "internal_debug_dump",
        query: "secret",
        output_json: "{}",
        status: "succeeded",
        created_at: "2026-08-06T00:00:00.000Z",
        output: { result_summary: "internal" },
      },
    ],
    artifacts: [
      {
        id: "artifact_1",
        run_id: "run_1",
        attempt_id: "attempt_1",
        type: "research",
        content_json: '{"summary":"内部内容"}',
        content: { summary: "内部内容" },
        input_artifact_ids_json: "[]",
        input_artifact_ids: [],
        created_at: "2026-08-06T00:00:00.000Z",
      },
    ],
    recent_events: [
      {
        id: 1,
        version: 1,
        kind: "attempt.started",
        payload: { role: "researcher", ordinal: 1, goal: "检索文献" },
        created_at: "t",
      },
      { id: 2, version: 2, kind: "sdk.output_rejected", payload: { reason: "字段缺失" }, created_at: "t" },
    ],
  };
}

// `attempt_id` 曾在此清单里（外键一刀切进「内部」）。2026-08-16 裁决改放行：
// attempts[].id 本就全量出网，证据行挂到公开对象上不构成新泄露，而轨迹视图的
// 角色段分组依赖这条关联。见下「证据行携带 attempt_id」用例。
const INTERNAL_FIELD_NAMES = [
  "content_json",
  "output_json",
  "input_artifact_ids",
  "input_artifact_ids_json",
  "error_type",
  "budget_json",
  "updated_at",
  "output_artifact_id",
  "successor_of",
  "documents",
  "document_id",
];

test("公共投影不含任何内部字段", () => {
  const serialized = JSON.stringify(projectRunSnapshot(internalSnapshot()));
  for (const field of INTERNAL_FIELD_NAMES) {
    assert.ok(!serialized.includes(field), `internal field leaked: ${field}`);
  }
  assert.ok(!serialized.includes('"run_id":'), "internal run_id leaked");
  assert.ok(!serialized.includes("内部内容"), "artifact content leaked");
});

test("Artifact 只投影 id 与 type，正文不随快照出网", () => {
  const projected = projectRunSnapshot(internalSnapshot());
  assert.deepEqual(projected.artifacts, [{ id: "artifact_1", type: "research" }]);
});

test("Evidence Review 详情不泄露内部 evidence_ids 与 rationale", () => {
  const projected = projectArtifact({
    id: "artifact_review",
    type: "evidence-review",
    content: {
      artifact_type: "evidence-review",
      hypothesis_artifact_id: "hypothesis_internal",
      research_artifact_ids: ["research_internal"],
      assessments: [
        {
          candidate_id: "evidence-gate",
          claim: "证据门降低无来源引用。",
          verdict: "supports",
          rationale: "冻结证据支持该结论。",
          evidence_ids: ["ev_internal"],
        },
      ],
      gaps: [],
      supported: true,
    },
  });

  assert.deepEqual(projected.content, {
    artifact_type: "evidence-review",
    assessments: [
      {
        candidate_id: "evidence-gate",
        claim: "证据门降低无来源引用。",
        verdict: "supports",
      },
    ],
    gaps: [],
  });
});

test("Research framing 详情公开问题边界而不泄露检索台账", () => {
  const projected = projectArtifact({
    id: "artifact_research",
    type: "research",
    content: {
      artifact_type: "research",
      research_framing: {
        research_object: "证据归因机制",
        scope: "固定问题集",
        variables: [{ name: "引用率", role: "dependent", operationalization: "无来源引用数除以总数" }],
        known: ["冻结证据可被核验"],
        controversies: ["提示词是否足够"],
        unknowns: ["跨问题效果"],
        knowledge_gap: "缺少配对比较",
        constraints: ["不宣称已证实"],
      },
      summary: "冻结证据支撑一条可审计的论断。",
      claims: [{ statement: "证据门可核验。", evidence_ids: ["ev_internal"] }],
      limitations: ["fixture"],
      queries: [{ evidence_id: "ev_internal" }],
      citations: [{ evidence_id: "ev_internal", locator: "private", title: "private", url: null }],
    },
  });

  assert.deepEqual(projected.content, {
    artifact_type: "research",
    research_framing: {
      research_object: "证据归因机制",
      scope: "固定问题集",
      variables: [{ name: "引用率", role: "dependent", operationalization: "无来源引用数除以总数" }],
      known: ["冻结证据可被核验"],
      controversies: ["提示词是否足够"],
      unknowns: ["跨问题效果"],
      knowledge_gap: "缺少配对比较",
      constraints: ["不宣称已证实"],
    },
    summary: "冻结证据支撑一条可审计的论断。",
    claims: [{ statement: "证据门可核验。", evidence_ids: ["ev_internal"] }],
    limitations: ["fixture"],
  });
  assert.ok(!JSON.stringify(projected).includes("private"));
});

test("Hypothesis 详情公开候选证据与比较筛选记录，但不泄露上游 Artifact ID", () => {
  const projected = projectArtifact({
    id: "artifact_hypothesis",
    type: "hypothesis",
    content: {
      artifact_type: "hypothesis",
      question: "q",
      candidates: [
        {
          candidate_id: "c1",
          claim_status: "candidate",
          core_claim: "候选一",
          basis: "依据一",
          supporting_evidence_ids: ["ev_1"],
          opposing_evidence_ids: [],
          falsifiable_predictions: ["预测一"],
          alternative_explanations: ["替代一"],
          uncertainty: ["不确定一"],
          boundaries: ["边界一"],
          validation_conditions: ["条件一"],
        },
        {
          candidate_id: "c2",
          claim_status: "candidate",
          core_claim: "候选二",
          basis: "依据二",
          supporting_evidence_ids: [],
          opposing_evidence_ids: ["ev_2"],
          falsifiable_predictions: ["预测二"],
          alternative_explanations: ["替代二"],
          uncertainty: ["不确定二"],
          boundaries: ["边界二"],
          validation_conditions: ["条件二"],
        },
      ],
      comparison: {
        criteria: [{ criterion: "可证伪性", rationale: "可被实验推翻。" }],
        evaluations: [
          {
            candidate_id: "c1",
            rank: 1,
            strengths: ["预测明确。"],
            weaknesses: ["证据有限。"],
            evidence_ids: ["ev_1"],
            rationale: "优先验证。",
          },
          {
            candidate_id: "c2",
            rank: 2,
            strengths: ["保留反证。"],
            weaknesses: ["支持不足。"],
            evidence_ids: ["ev_2"],
            rationale: "作为替代。",
          },
        ],
        selected_candidate_id: "c1",
        selection_rationale: "候选一更可检验。",
      },
      selection_status: "candidate_selected",
      research_artifact_ids: ["research_internal"],
    },
  });
  assert.equal(projected.content.artifact_type, "hypothesis");
  assert.equal((projected.content as any).candidates.length, 2);
  assert.equal((projected.content as any).comparison.selected_candidate_id, "c1");
  assert.ok(!JSON.stringify(projected).includes("research_internal"));
});

test("ResearchPlan 详情投影完整覆盖产品 A1-A10 字段但不泄露追溯 ID", () => {
  const projected = projectArtifact({
    id: "artifact_plan",
    type: "research-plan",
    content: {
      artifact_type: "research-plan",
      problem_statement: "问题陈述",
      rationale: "研究理由",
      technical_details: "技术细节",
      datasets: ["数据集"],
      source: "来源",
      target: "研究目标",
      execution_plan: {
        predictions: [
          {
            candidate_id: "candidate-1",
            prediction: "证据门组更低",
            falsification_criterion: "若不下降则否定",
          },
        ],
        data_requirements: [{ source: "问题集", variables: ["引用率"], conditions: ["固定模型"] }],
        steps: [
          { order: 1, action: "冻结问题集", expected_output: "结构化产物" },
          { order: 2, action: "核验引用", expected_output: "指标表" },
        ],
        analysis: [{ method: "配对比较", inputs: ["逐题结果"], decision_rule: "报告区间" }],
        result_interpretations: [
          { observed_result: "引用率下降", meaning: "支持继续验证" },
          { observed_result: "引用率不降", meaning: "回退候选" },
        ],
        stop_conditions: ["样本完成"],
        rollback_conditions: ["数据损坏"],
        supplement_evidence_conditions: ["关键变量缺来源"],
      },
      paper_title: "论文标题",
      paper_abstract: "论文摘要",
      methods: "研究方法",
      experiments: {
        baselines: [
          { name: "基线一", evidence_id: "ev_1" },
          { name: "基线二", evidence_id: "ev_2" },
        ],
        metrics: [
          { name: "指标一", evidence_id: "ev_1" },
          { name: "指标二", evidence_id: "ev_2" },
        ],
        design: "实验设计",
      },
      results: {
        status: "pending_verification",
        validation_basis: "formula_derivation",
        feasibility_argument: "在固定指标和预设判断规则下，用指标关系推导实验设计可行。",
        expected_outcomes: [{ metric: "指标一", statement: "预期结果" }],
      },
      references: ["https://example.com/paper"],
      input_artifact_ids: ["a", "b", "c"],
      verification_evidence_ids: ["ev_1"],
    },
  });

  assert.deepEqual(projected.content, {
    artifact_type: "research-plan",
    problem_statement: "问题陈述",
    rationale: "研究理由",
    technical_details: "技术细节",
    datasets: ["数据集"],
    source: "来源",
    target: "研究目标",
    execution_plan: {
      predictions: [
        {
          candidate_id: "candidate-1",
          prediction: "证据门组更低",
          falsification_criterion: "若不下降则否定",
        },
      ],
      data_requirements: [{ source: "问题集", variables: ["引用率"], conditions: ["固定模型"] }],
      steps: [
        { order: 1, action: "冻结问题集", expected_output: "结构化产物" },
        { order: 2, action: "核验引用", expected_output: "指标表" },
      ],
      analysis: [{ method: "配对比较", inputs: ["逐题结果"], decision_rule: "报告区间" }],
      result_interpretations: [
        { observed_result: "引用率下降", meaning: "支持继续验证" },
        { observed_result: "引用率不降", meaning: "回退候选" },
      ],
      stop_conditions: ["样本完成"],
      rollback_conditions: ["数据损坏"],
      supplement_evidence_conditions: ["关键变量缺来源"],
    },
    paper_title: "论文标题",
    paper_abstract: "论文摘要",
    methods: "研究方法",
    experiments: {
      baselines: [
        { name: "基线一", evidence_id: "ev_1" },
        { name: "基线二", evidence_id: "ev_2" },
      ],
      metrics: [
        { name: "指标一", evidence_id: "ev_1" },
        { name: "指标二", evidence_id: "ev_2" },
      ],
      design: "实验设计",
    },
    results: {
      status: "pending_verification",
      validation_basis: "formula_derivation",
      feasibility_argument: "在固定指标和预设判断规则下，用指标关系推导实验设计可行。",
      expected_outcomes: [{ metric: "指标一", statement: "预期结果" }],
    },
    references: ["https://example.com/paper"],
  });
  const serialized = JSON.stringify(projected);
  assert.ok(!serialized.includes("input_artifact_ids"));
  assert.ok(!serialized.includes("verification_evidence_ids"));
});

test("Review 详情公开独立检索 evidence IDs，但不重复公开 citations", () => {
  const projected = projectArtifact({
    id: "artifact_review",
    type: "review",
    content: {
      artifact_type: "review",
      research_plan_artifact_id: "plan_internal",
      evidence_review_artifact_id: "review_internal",
      independent_evidence_ids: ["ev_reviewer_01_arxiv"],
      scores: { scientific_value: 4, technical_depth: 4, application_potential: 4 },
      weaknesses: [],
      feedback: [],
      suggested_successor_roles: [],
      accepted: true,
    },
  });

  assert.deepEqual(projected.content, {
    artifact_type: "review",
    independent_evidence_ids: ["ev_reviewer_01_arxiv"],
    accepted: true,
    scores: { scientific_value: 4, technical_depth: 4, application_potential: 4 },
    weaknesses: [],
    feedback: [],
  });
  assert.ok(!JSON.stringify(projected).includes("citations"));
});

test("Attempt 只投影声明过的字段", () => {
  const projected = projectRunSnapshot(internalSnapshot());
  assert.deepEqual(Object.keys(projected.attempts[0]!), [
    "id",
    "role",
    "ordinal",
    "status",
    "corrections",
    "failure_code",
    "started_at",
    "finished_at",
  ]);
});

test("evaluation round projection keeps rubric, raw artifacts, deltas and explicit reasons", () => {
  const projected = projectRunEvent({
    id: 8,
    version: 8,
    kind: "evaluation.round",
    payload: {
      evaluator: "model_reviewer",
      target: "research-plan",
      sample: "one run / one research plan",
      sample_size: 1,
      rubric_version: "review-v1",
      scientific_rationale: "三项分数用于记录迭代诊断，不替代人工科学审查。",
      round: 2,
      phase: "revision",
      action: "stop",
      feedback_source: "auto",
      feedback_artifact_id: "review-2",
      feedback_count: 1,
      raw_plan_artifact_id: "plan-1",
      raw_review_artifact_id: "review-1",
      plan_artifact_id: "plan-2",
      review_artifact_id: "review-2",
      changed_fields: "methods",
      score_before_total: 10,
      score_after_total: 12,
      score_delta_total: 2,
      round_cost_tokens: null,
      cost_delta_tokens: null,
      limitations_before_count: 2,
      limitations_after_count: 1,
      limitation_delta_count: -1,
      stop_reason: "revision_budget_exhausted",
      retry_reason: null,
      rollback_reason: null,
      internal_raw_review: "must not leak",
    },
    created_at: "t",
  });

  assert.equal(projected.kind, "evaluation.round");
  assert.equal(projected.payload.raw_review_artifact_id, "review-1");
  assert.equal(projected.payload.score_delta_total, 2);
  assert.equal(projected.payload.cost_delta_tokens, null);
  assert.equal(projected.payload.stop_reason, "revision_budget_exhausted");
  assert.ok(!JSON.stringify(projected).includes("internal_raw_review"));
});

test("Run 快照把每次角色执行投影成可核验的 one-shot subagent", () => {
  const projected = projectRunSnapshot(internalSnapshot());
  assert.deepEqual(projected.subagents, [
    {
      id: "attempt_1",
      parent_run_id: "run_1",
      role: "researcher",
      ordinal: 1,
      mode: "one-shot",
      status: "running",
      stop_reason: null,
      started_at: "2026-08-06T00:00:00.000Z",
      finished_at: null,
    },
  ]);
});

test("Crossref 证据公开，内部工具证据被过滤", () => {
  const projected = projectRunSnapshot(internalSnapshot());
  assert.deepEqual(
    projected.tool_evidence.map((row) => row.id),
    ["ev_1"],
  );
  assert.equal(projected.omitted_evidence_count, 1);
  assert.deepEqual(projected.omitted_evidence_tools, ["internal_debug_dump"]);
});

test("证据行携带 attempt_id，且指向公开的 attempt", () => {
  const projected = projectRunSnapshot(internalSnapshot());
  const [evidence] = projected.tool_evidence;
  assert.equal(evidence!.attempt_id, "attempt_1");
  assert.ok(
    projected.attempts.some((attempt) => attempt.id === evidence!.attempt_id),
    "attempt_id 必须能在公开 attempts 里找到——它是两个公开对象间的结构关联，不是内部字段",
  );
});

test("证据输出只放行摘要和引文白名单字段", () => {
  const [evidence] = projectRunSnapshot(internalSnapshot()).tool_evidence;
  assert.deepEqual(Object.keys(evidence!.output), ["result_summary", "citations"]);
  assert.deepEqual(evidence!.output.citations, [
    {
      title: "Fixture",
      locator: "arxiv:2301.00001v1",
      url: "https://arxiv.org/abs/2301.00001v1",
    },
  ]);
});

test("缺 output 的证据行不打断整个快照", () => {
  const snapshot = internalSnapshot();
  const rows = snapshot.tool_evidence as Record<string, unknown>[];
  delete rows[0]!.output;
  const [evidence] = projectRunSnapshot(snapshot).tool_evidence;
  assert.deepEqual(evidence!.output, { result_summary: null, citations: [] });
});

test("sdk.output_rejected 事件被丢弃", () => {
  const projected = projectRunSnapshot(internalSnapshot());
  assert.deepEqual(
    projected.recent_events.map((event) => event.kind),
    ["attempt.started"],
  );
  assert.equal(
    projectSseFrame({ id: 2, version: 2, kind: "sdk.output_rejected", payload: { reason: "x" }, created_at: "t" }),
    null,
  );
});

test("payload 只保留该 kind 白名单里的字段", () => {
  const event = projectRunEvent({
    id: 3,
    version: 3,
    kind: "tool.evidence_recorded",
    created_at: "t",
    payload: { tool_name: "arxiv_search", status: "succeeded", result_count: 2, query: "内部检索词" },
  });
  assert.deepEqual(event.payload, { tool_name: "arxiv_search", status: "succeeded", result_count: 2 });
});

test("subagent 生命周期事件公开身份、父 Run 与明确终态", () => {
  const started = projectRunEvent({
    id: 4,
    version: 4,
    kind: "subagent.started",
    created_at: "t",
    payload: { subagent_id: "attempt_1", parent_run_id: "run_1", role: "researcher", ordinal: 1 },
  });
  assert.deepEqual(started.payload, {
    subagent_id: "attempt_1",
    parent_run_id: "run_1",
    role: "researcher",
    ordinal: 1,
  });

  const ended = projectRunEvent({
    id: 5,
    version: 5,
    kind: "subagent.ended",
    created_at: "t",
    payload: { subagent_id: "attempt_1", role: "researcher", status: "failed", failure_code: "infra_timeout" },
  });
  assert.deepEqual(ended.payload, {
    subagent_id: "attempt_1",
    role: "researcher",
    status: "failed",
    failure_code: "infra_timeout",
  });
});

test("verification.references 公共投影放行 doi_checked 这个标量", () => {
  const event = projectRunEvent({
    id: 12,
    version: 14,
    kind: "verification.references",
    created_at: "t",
    payload: { doi_checked: 5, checks: [{ id: "private" }] },
  });
  assert.deepEqual(event.payload, { doi_checked: 5 });
});

test("未知 kind 不再得到空 payload，而是显式标记为不支持", () => {
  const event = projectRunEvent({
    id: 4,
    version: 4,
    kind: "future.event",
    payload: { internal_reason: "内部原因" },
    created_at: "t",
  });
  assert.deepEqual(event, {
    id: 4,
    version: 4,
    kind: "future.event",
    payload: { diagnostic: "unsupported_event", unsupported: true },
    created_at: "t",
  });
});

test("漂移事件放行字段名，模型写的原文留在库内", () => {
  const event = projectRunEvent({
    id: 11,
    version: 11,
    kind: "artifact.field_overwritten",
    created_at: "t",
    payload: {
      artifact_type: "research",
      field: "question",
      before: "模型写的那份原文",
      after: "冻结的那份原文",
    },
  });
  assert.deepEqual(event.payload, { artifact_type: "research", field: "question" });
});

test("嵌套对象与数组即使字段名在白名单里也被丢弃", () => {
  const nested = projectRunEvent({
    id: 5,
    version: 5,
    kind: "attempt.started",
    payload: { role: { name: "researcher" } },
    created_at: "t",
  });
  assert.deepEqual(nested.payload, {});
  const array = projectRunEvent({
    id: 6,
    version: 6,
    kind: "attempt.started",
    payload: { role: ["researcher"] },
    created_at: "t",
  });
  assert.deepEqual(array.payload, {});
  // payload 本身是数组时不能按下标取字段
  const listPayload = projectRunEvent({
    id: 7,
    version: 7,
    kind: "attempt.started",
    payload: ["researcher"],
    created_at: "t",
  });
  assert.deepEqual(listPayload.payload, {});
});

test("null 和 false 是合法的展示标量，不能被当成缺失丢掉", () => {
  const event = projectRunEvent({
    id: 8,
    version: 8,
    kind: "attempt.failed",
    payload: { failure_code: null },
    created_at: "t",
  });
  assert.deepEqual(event.payload, { failure_code: null });
});

test("SSE 帧逐字正确且中文不被转义", () => {
  const frame = projectSseFrame({
    id: 9,
    version: 12,
    kind: "attempt.started",
    payload: { role: "researcher", ordinal: 1, goal: "检索文献" },
    created_at: "2026-08-06T00:00:00.000Z",
  });
  assert.equal(
    frame,
    "id: 12\nevent: attempt.started\n" +
      'data: {"id":9,"version":12,"kind":"attempt.started","payload":{"role":"researcher","ordinal":1},' +
      '"created_at":"2026-08-06T00:00:00.000Z"}\n\n',
  );
  const chinese = projectSseFrame({
    id: 10,
    version: 13,
    kind: "attempt.started",
    payload: { role: "研究员", ordinal: 1 },
    created_at: "t",
  });
  assert.ok(chinese!.includes('"role":"研究员"'), "中文被转义成了 \\uXXXX");
});

test("真实 store 的快照能原样进投影，且内部字段不出网", () => {
  const store = new SqliteStore(":memory:");
  const runId = store.createRun("证据门能降低无来源引用吗？");
  store.startAttempt(runId, "researcher");
  const projected = projectRunSnapshot(store.snapshot(runId)!);

  assert.deepEqual(Object.keys(projected), [
    "id",
    "question",
    "status",
    "current_role",
    "version",
    "error_code",
    "final_artifact_id",
    "attempts",
    "subagents",
    "tool_evidence",
    "omitted_evidence_count",
    "omitted_evidence_tools",
    "artifacts",
    "recent_events",
  ]);
  assert.equal(projected.current_role, "researcher");
  assert.ok(projected.recent_events.length > 0);
  const serialized = JSON.stringify(projected);
  for (const field of INTERNAL_FIELD_NAMES) {
    assert.ok(!serialized.includes(field), `internal field leaked: ${field}`);
  }
  assert.ok(!serialized.includes('"run_id":'), "internal run_id leaked");
  store.close();
});
