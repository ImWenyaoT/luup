import { afterEach, describe, expect, test, vi } from "vitest";

import { ApiError, createApiClient, parseJson } from "./client";

function respond(status: number, body: string, ok = status < 400): Response {
  return {
    ok,
    status,
    statusText: `HTTP-${status}`,
    json: async () => JSON.parse(body) as unknown,
  } as unknown as Response;
}

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("ApiError", () => {
  test("保留 status 与 message", () => {
    const error = new ApiError(422, "question 必须是非空字符串。", { detail: "question 必须是非空字符串。" });
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ApiError");
    expect(error.status).toBe(422);
    expect(error.message).toBe("question 必须是非空字符串。");
  });

  test("toJSON 可序列化 status 与 body", () => {
    const error = new ApiError(503, "临时不可用", { detail: "临时不可用", code: "stream_error" });
    expect(error.toJSON()).toEqual({
      name: "ApiError",
      status: 503,
      message: "临时不可用",
      body: { detail: "临时不可用", code: "stream_error" },
    });
  });
});

describe("parseJson", () => {
  test("非 2xx 且带 detail：抛 ApiError", async () => {
    await expect(parseJson(respond(422, JSON.stringify({ detail: "bad" })))).rejects.toMatchObject({
      status: 422,
      message: "bad",
    });
  });

  test("非 2xx 且响应体不是 JSON：回落到 statusText", async () => {
    const response = {
      ok: false,
      status: 502,
      statusText: "HTTP-502",
      json: async () => {
        throw new SyntaxError("invalid json");
      },
    } as unknown as Response;
    const error = await parseJson(response).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).toBe("HTTP-502");
  });

  test("非 2xx 的 JSON 里没有 detail：回落到 HTTP <status>", async () => {
    await expect(parseJson(respond(500, JSON.stringify({ oops: true })))).rejects.toMatchObject({
      message: "HTTP-500",
    });
  });
});

describe("createApiClient", () => {
  test("get 拼接 baseUrl", async () => {
    const spy = vi.fn(async () => respond(200, JSON.stringify({ ok: true })));
    const client = createApiClient({ baseUrl: "https://example.test", fetchImpl: spy });
    await client.get("/api/config");
    expect((spy.mock.calls[0] as unknown as [string])[0]).toBe("https://example.test/api/config");
  });
});
