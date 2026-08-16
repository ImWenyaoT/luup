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
  "run_id",
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
        claim: "证据门降低无来源引用。",
        verdict: "supports",
      },
    ],
    gaps: [],
  });
});

test("Hypothesis 详情不把 rationale 发给浏览器", () => {
  const projected = projectArtifact({
    id: "artifact_hypothesis",
    type: "hypothesis",
    content: {
      artifact_type: "hypothesis",
      question: "q",
      hypothesis: "h",
      rationale: "内部推理",
      falsifiable_predictions: ["p"],
      boundaries: ["b"],
    },
  });
  assert.ok(!JSON.stringify(projected).includes("rationale"));
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

test("Crossref 证据公开，内部工具证据被过滤", () => {
  const projected = projectRunSnapshot(internalSnapshot());
  assert.deepEqual(
    projected.tool_evidence.map((row) => row.id),
    ["ev_1"],
  );
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

test("白名单外的 kind 得到空 payload，事件本身仍然出去", () => {
  const event = projectRunEvent({
    id: 4,
    version: 4,
    kind: "sdk.output_rejected",
    payload: { reason: "内部原因" },
    created_at: "t",
  });
  assert.deepEqual(event, { id: 4, version: 4, kind: "sdk.output_rejected", payload: {}, created_at: "t" });
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
    kind: "task.created",
    payload: { role: { name: "researcher" } },
    created_at: "t",
  });
  assert.deepEqual(nested.payload, {});
  const array = projectRunEvent({
    id: 6,
    version: 6,
    kind: "task.created",
    payload: { role: ["researcher"] },
    created_at: "t",
  });
  assert.deepEqual(array.payload, {});
  // payload 本身是数组时不能按下标取字段
  const listPayload = projectRunEvent({
    id: 7,
    version: 7,
    kind: "task.created",
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
    "tool_evidence",
    "artifacts",
    "recent_events",
  ]);
  assert.equal(projected.current_role, "researcher");
  assert.ok(projected.recent_events.length > 0);
  const serialized = JSON.stringify(projected);
  for (const field of INTERNAL_FIELD_NAMES) {
    assert.ok(!serialized.includes(field), `internal field leaked: ${field}`);
  }
  store.close();
});
