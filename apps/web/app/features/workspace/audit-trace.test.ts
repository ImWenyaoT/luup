import { describe, expect, test } from "vitest";

import { buildTraceGroups, display, statusLabel } from "./audit-trace";

describe("buildTraceGroups", () => {
  test("聚合 trace 生命周期事件", () => {
    const events = [
      {
        id: 1,
        version: 1,
        kind: "sdk.trace.started",
        payload: { trace_id: "t1:1", agent: "researcher", role: "researcher" },
        created_at: "2025-01-01T00:00:00Z",
      },
      {
        id: 2,
        version: 2,
        kind: "sdk.trace.tool_started",
        payload: { trace_id: "t1:1", tool: "search", ordinal: 1 },
        created_at: "2025-01-01T00:00:01Z",
      },
      {
        id: 3,
        version: 3,
        kind: "sdk.trace.tool_ended",
        payload: { trace_id: "t1:1", tool: "search", ordinal: 1, status: "completed", duration_ms: 42 },
        created_at: "2025-01-01T00:00:02Z",
      },
      {
        id: 4,
        version: 4,
        kind: "sdk.trace.ended",
        payload: { trace_id: "t1:1", outcome: "completed", usage_input_tokens: 10 },
        created_at: "2025-01-01T00:00:03Z",
      },
    ] as const;

    const groups = buildTraceGroups(events as never);
    expect(groups).toHaveLength(1);
    expect(groups[0].tools).toHaveLength(1);
    expect(groups[0].tools[0].ended).toBe(true);
    expect(groups[0].tools[0].durationMs).toBe(42);
  });

  test("display 与 statusLabel 未知分支", () => {
    expect(display(null)).toBe("未知");
    expect(statusLabel("weird")).toBe("未知");
    expect(statusLabel(null)).toBe("未知");
  });
});
