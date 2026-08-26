import { describe, expect, test } from "vitest";

import { readRunId, writeRunSearchParams } from "./url-run";

describe("url-run", () => {
  test("readRunId 读取 ?run= 参数", () => {
    expect(readRunId(new URLSearchParams("run=abc-123"))).toBe("abc-123");
    expect(readRunId(new URLSearchParams())).toBeNull();
  });

  test("writeRunSearchParams 生成 search params 对象", () => {
    expect(writeRunSearchParams("run-1")).toEqual({ run: "run-1" });
    expect(writeRunSearchParams(null)).toEqual({});
  });
});
