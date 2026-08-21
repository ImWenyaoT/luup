import { describe, expect, test } from "bun:test";

import { resolveCanaryDatabase } from "../src/canary.ts";

describe("canary evidence storage", () => {
  test("defaults to a durable repository-relative database", () => {
    expect(resolveCanaryDatabase({})).toBe("outputs/runtime/canary.db");
  });

  test("keeps an explicit database override", () => {
    expect(resolveCanaryDatabase({ LUUP_DATABASE: ":memory:" })).toBe(":memory:");
    expect(resolveCanaryDatabase({ LUUP_DATABASE: "/private/tmp/canary.db" })).toBe("/private/tmp/canary.db");
  });
});
