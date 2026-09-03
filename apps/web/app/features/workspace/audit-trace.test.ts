import { describe, expect, test } from "vitest";

import {
  buildTraceGroups,
  display,
  getReferenceVerification,
  listDisplay,
  numberValue,
  referenceVerificationLabel,
  runStatusLabel,
  statusLabel,
} from "./audit-trace";

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

  test("无 matching start 的 tool_ended、callback_error、无 trace_id 仍可分组", () => {
    const events = [
      {
        id: 10,
        version: 10,
        kind: "sdk.trace.tool_ended",
        payload: { tool: "orphan", ordinal: 9, status: "failed", duration_ms: 3 },
        created_at: "2025-01-01T00:00:10Z",
      },
      {
        id: 11,
        version: 11,
        kind: "sdk.trace.callback_error",
        payload: { message: "boom" },
        created_at: "2025-01-01T00:00:11Z",
      },
      {
        id: 12,
        version: 12,
        kind: "sdk.trace.started",
        payload: { trace_id: "later:1" },
        created_at: "2025-01-01T00:00:12Z",
      },
      {
        id: 1,
        version: 1,
        kind: "other.noise",
        payload: {},
        created_at: "2025-01-01T00:00:00Z",
      },
    ] as const;

    const groups = buildTraceGroups(events as never);
    expect(groups).toHaveLength(3);
    const orphan = groups.find((group) => group.tools.some((tool) => tool.tool === "orphan"));
    const callbackOnly = groups.find((group) => group.callbackErrors.length > 0 && group.tools.length === 0);
    const later = groups.find((group) => group.traceId === "later:1");
    expect(orphan?.tools[0]).toMatchObject({ tool: "orphan", ended: true, status: "failed", durationMs: 3 });
    expect(callbackOnly?.callbackErrors).toHaveLength(1);
    expect(later?.started).not.toBeNull();
  });
});

describe("audit-trace helpers", () => {
  test("display / listDisplay / statusLabel / runStatusLabel 分支", () => {
    expect(display(null)).toBe("未知");
    expect(display("")).toBe("未知");
    expect(display("ok")).toBe("ok");
    expect(listDisplay(null)).toBe("未知");
    expect(listDisplay("")).toBe("无");
    expect(listDisplay("a,b")).toBe("a,b");
    expect(statusLabel("completed")).toBe("已完成 / completed");
    expect(statusLabel("failed")).toBe("失败 / failed");
    expect(statusLabel("unknown")).toBe("未知 / unknown");
    expect(statusLabel(null)).toBe("未知");
    expect(statusLabel("weird")).toBe("未知");
    expect(runStatusLabel("running")).toBe("进行中");
    expect(runStatusLabel("completed")).toBe("已完成");
    expect(runStatusLabel("review_rejected")).toBe("评审拒绝");
    expect(runStatusLabel("failed")).toBe("失败");
    expect(runStatusLabel("queued" as never)).toBe("未知");
  });

  test("numberValue 忽略非有限数；getReferenceVerification 取最后一条", () => {
    const event = {
      id: 1,
      version: 1,
      kind: "verification.references",
      created_at: "2025-01-01T00:00:00Z",
      payload: { ok: true, reference_count: Number.NaN, failed_count: "x" },
    };
    expect(numberValue(null, "x")).toBeNull();
    expect(numberValue(event as never, "reference_count")).toBeNull();
    expect(getReferenceVerification([])).toBeNull();
    expect(
      getReferenceVerification([
        {
          id: 1,
          version: 1,
          kind: "verification.references",
          created_at: "a",
          payload: { ok: false, failed_count: 2 },
        },
        {
          id: 2,
          version: 2,
          kind: "verification.references",
          created_at: "b",
          payload: {
            ok: true,
            reference_count: 5,
            frozen_sources: 5,
            arxiv_checked: 2,
            doi_checked: 3,
            failed_count: 0,
            infra_error: false,
            membership_only: true,
          },
        },
      ] as never),
    ).toEqual({
      ok: true,
      referenceCount: 5,
      frozenSources: 5,
      arxivChecked: 2,
      doiChecked: 3,
      failedCount: 0,
      infraError: false,
      membershipOnly: true,
    });
  });

  test("referenceVerificationLabel 覆盖通过/失败/基础设施/未知", () => {
    expect(referenceVerificationLabel(null)).toBe("未知");
    expect(
      referenceVerificationLabel({
        ok: null,
        referenceCount: null,
        frozenSources: null,
        arxivChecked: null,
        doiChecked: null,
        failedCount: null,
        infraError: true,
        membershipOnly: null,
      }),
    ).toBe("基础设施异常");
    expect(
      referenceVerificationLabel({
        ok: true,
        referenceCount: null,
        frozenSources: null,
        arxivChecked: null,
        doiChecked: null,
        failedCount: null,
        infraError: false,
        membershipOnly: null,
      }),
    ).toBe("通过");
    expect(
      referenceVerificationLabel({
        ok: true,
        referenceCount: 3,
        frozenSources: null,
        arxivChecked: null,
        doiChecked: null,
        failedCount: null,
        infraError: false,
        membershipOnly: null,
      }),
    ).toBe("通过 · 3 条");
    expect(
      referenceVerificationLabel({
        ok: false,
        referenceCount: null,
        frozenSources: null,
        arxivChecked: null,
        doiChecked: null,
        failedCount: null,
        infraError: false,
        membershipOnly: null,
      }),
    ).toBe("未通过");
    expect(
      referenceVerificationLabel({
        ok: false,
        referenceCount: null,
        frozenSources: null,
        arxivChecked: null,
        doiChecked: null,
        failedCount: 2,
        infraError: false,
        membershipOnly: null,
      }),
    ).toBe("未通过 · 2 条失败");
    expect(
      referenceVerificationLabel({
        ok: null,
        referenceCount: null,
        frozenSources: null,
        arxivChecked: null,
        doiChecked: null,
        failedCount: null,
        infraError: false,
        membershipOnly: null,
      }),
    ).toBe("未知");
  });
});
