import { describe, expect, test } from "bun:test";

import { preview } from "./trajectory";

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
