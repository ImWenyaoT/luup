import { describe, expect, test } from "vitest";

import { preview } from "./trajectoryUtils";

describe("preview 双阈值截断", () => {
  test("短文本原样返回", () => {
    expect(preview("hello world")).toBe("hello world");
  });

  test("空白折叠成单空格再截断", () => {
    expect(preview("a\n\n  b\t\tc")).toBe("a b c");
  });

  test("超过预览长度补省略号，长度封顶", () => {
    const out = preview("x".repeat(1000), 240);
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBe(241);
  });

  test("粗切阈值 2048：更远处的内容永不进入预览", () => {
    const text = `${"a".repeat(2048)}TAIL-MARKER`;
    expect(preview(text, 5000)).not.toContain("TAIL-MARKER");
  });

  test("恰好等于预览长度不补省略号", () => {
    expect(preview("y".repeat(240), 240)).toBe("y".repeat(240));
  });
});

describe("buildSegments", () => {
  test("为五角色各建一段", async () => {
    const { buildSegments } = await import("./trajectoryUtils");
    const snapshot = {
      attempts: [
        {
          id: "a1",
          role: "researcher",
          ordinal: 1,
          status: "completed",
          corrections: 0,
          failure_code: null,
          started_at: "2025-01-01T00:00:00Z",
          finished_at: "2025-01-01T00:00:01Z",
        },
      ],
      tool_evidence: [
        {
          id: "e1",
          attempt_id: "a1",
          tool_name: "arxiv_search",
          query: "q",
          status: "completed",
          created_at: "2025-01-01T00:00:00Z",
          output: { result_summary: "ok", citations: [] },
        },
      ],
    } as const;
    const segments = buildSegments(snapshot as never);
    expect(segments).toHaveLength(5);
    expect(segments[0].evidence).toHaveLength(1);
    expect(segments[1].attempts).toHaveLength(0);
  });
});
