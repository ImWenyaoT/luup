import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { AuditTrace } from "./audit-trace";
import type { Snapshot } from "./types";

function snapshotWithTraceEvents(events: Snapshot["recent_events"]): Snapshot {
  return {
    id: "run-audit-1",
    question: "如何检验候选假设？",
    status: "completed",
    current_role: null,
    version: events.length,
    error_code: null,
    final_artifact_id: null,
    attempts: [],
    subagents: [],
    tool_evidence: [],
    artifacts: [],
    recent_events: events,
  };
}

test("审计轨迹按 trace 展示模型、脱敏上下文、工具生命周期和用量", () => {
  const snapshot = snapshotWithTraceEvents([
    {
      id: 1,
      version: 1,
      kind: "sdk.trace.started",
      payload: {
        trace_id: "attempt-1:1",
        role: "researcher",
        agent: "Researcher",
        model: "qwen3.7-plus",
        task: "检索证据并整理知识缺口",
        input_encoding: "text",
        input_chars: 128,
        input_sha256: "abcdef1234567890",
        input_fields: "goal,input_artifacts,question",
        structured_constraint: "research",
        available_tools: "arxiv_search,crossref_search",
        prompt: "不应出现在浏览器",
        rationale: "不应出现在浏览器",
        raw_payload: "不应出现在浏览器",
      },
      created_at: "2026-08-22T00:00:00.000Z",
    },
    {
      id: 2,
      version: 2,
      kind: "sdk.trace.tool_started",
      payload: { trace_id: "attempt-1:1", agent: "Researcher", tool: "arxiv_search", ordinal: 1 },
      created_at: "2026-08-22T00:00:01.000Z",
    },
    {
      id: 3,
      version: 3,
      kind: "sdk.trace.tool_ended",
      payload: {
        trace_id: "attempt-1:1",
        agent: "Researcher",
        tool: "arxiv_search",
        ordinal: 1,
        status: "completed",
        duration_ms: 240,
      },
      created_at: "2026-08-22T00:00:02.000Z",
    },
    {
      id: 4,
      version: 4,
      kind: "sdk.trace.ended",
      payload: {
        trace_id: "attempt-1:1",
        role: "researcher",
        outcome: "completed",
        stop_reason: "final_output",
        usage_requests: 1,
        usage_input_tokens: 100,
        usage_output_tokens: 40,
        usage_total_tokens: 140,
        usage_tool_calls: 1,
        trace_events: 4,
        truncated: false,
      },
      created_at: "2026-08-22T00:00:03.000Z",
    },
    {
      id: 5,
      version: 5,
      kind: "sdk.usage",
      payload: { agent: "researcher", input_tokens: 100, output_tokens: 40, total_tokens: 140 },
      created_at: "2026-08-22T00:00:03.000Z",
    },
  ]);

  const html = renderToStaticMarkup(<AuditTrace snapshot={snapshot} />);

  expect(html).toContain("审计轨迹");
  expect(html).toContain("Researcher");
  expect(html).toContain("qwen3.7-plus");
  expect(html).toContain("检索证据并整理知识缺口");
  expect(html).toContain("goal,input_artifacts,question");
  expect(html).toContain("research");
  expect(html).toContain("arxiv_search");
  expect(html).toContain("#1");
  expect(html).toContain("240 ms");
  expect(html).toContain("已完成");
  expect(html).toContain("100");
  expect(html).toContain("140");
  expect(html).not.toContain("不应出现在浏览器");
  expect(html).not.toContain("raw_payload");
});

test("失败、缺失和 unknown/null 事实保持可见，不伪造成功或零值", () => {
  const snapshot = snapshotWithTraceEvents([
    {
      id: 1,
      version: 1,
      kind: "sdk.trace.started",
      payload: {
        trace_id: "attempt-unknown:1",
        role: "reviewer",
        agent: null,
        model: null,
        task: null,
        input_encoding: null,
        input_chars: null,
        input_sha256: null,
        input_fields: "",
        structured_constraint: null,
        available_tools: null,
      },
      created_at: "t",
    },
    {
      id: 2,
      version: 2,
      kind: "sdk.trace.tool_started",
      payload: { trace_id: "attempt-unknown:1", agent: null, tool: "unknown_tool", ordinal: 2 },
      created_at: "t",
    },
    {
      id: 3,
      version: 3,
      kind: "sdk.trace.ended",
      payload: {
        trace_id: "attempt-unknown:1",
        role: "reviewer",
        outcome: "failed",
        stop_reason: null,
        usage_requests: null,
        usage_input_tokens: null,
        usage_output_tokens: null,
        usage_total_tokens: null,
        usage_tool_calls: null,
        trace_events: null,
        truncated: null,
      },
      created_at: "t",
    },
    {
      id: 4,
      version: 4,
      kind: "sdk.trace.callback_error",
      payload: { trace_id: "attempt-unknown:1", role: "reviewer", callback: "onUsage", error_type: "Error" },
      created_at: "t",
    },
  ]);

  const html = renderToStaticMarkup(<AuditTrace snapshot={snapshot} />);

  expect(html).toContain("失败");
  expect(html).toContain("未知");
  expect(html).toContain("unknown_tool");
  expect(html).toContain("旁路失败");
  expect(html).toContain("用量未知");
  expect(html).not.toContain("0 tokens");
});

test("没有公开 trace 时明确显示 unknown，而不是把空白当成功", () => {
  const html = renderToStaticMarkup(<AuditTrace snapshot={snapshotWithTraceEvents([])} />);

  expect(html).toContain("审计轨迹");
  expect(html).toContain("暂无公开 trace");
  expect(html).toContain("未知");
});
