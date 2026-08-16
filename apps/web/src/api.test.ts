import { afterEach, describe, expect, test, vi } from "vitest";

import { ApiError, createRun, fetchConfig, fetchRun, saveConfig } from "./api";

/** api 层的错误路径：这是切栈时丢掉的那类覆盖（#20 曾用它抓出 4 个真 bug）。 */

function respond(status: number, body: string, ok = status < 400): Response {
  return {
    ok,
    status,
    statusText: `HTTP-${status}`,
    // 非法 JSON 时 async 抛出 SyntaxError，与真 Response.json() 的拒绝语义一致。
    json: async () => JSON.parse(body) as unknown,
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("错误路径", () => {
  test("非 2xx 且带 detail：抛 ApiError，message 取后端的 detail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => respond(422, JSON.stringify({ detail: "question 必须是非空字符串。" }))),
    );
    const error = await createRun("").catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(422);
    expect((error as ApiError).message).toBe("question 必须是非空字符串。");
  });

  test("非 2xx 且响应体不是 JSON：回落到 statusText，不吞错也不崩", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => respond(502, "<html>bad gateway</html>")),
    );
    const error = await fetchRun("abc").catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).toBe("HTTP-502");
  });

  test("非 2xx 的 JSON 里没有 detail 字段：回落到 HTTP <status>", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => respond(500, JSON.stringify({ oops: true }))),
    );
    const error = await fetchConfig().catch((cause: unknown) => cause);
    expect((error as ApiError).message).toBe("HTTP 500");
  });

  test("run id 进 URL 前会被编码——路径注入进不来", async () => {
    const spy = vi.fn(async () => respond(200, JSON.stringify({ id: "x" })));
    vi.stubGlobal("fetch", spy);
    await fetchRun("../artifacts/steal");
    const url = (spy.mock.calls[0] as unknown[])[0] as string;
    expect(url).toBe("/api/runs/..%2Fartifacts%2Fsteal");
  });
});

describe("请求形状", () => {
  test("createRun 走 POST + application/json——与后端的 CORS 纪律配对", async () => {
    const spy = vi.fn(async () => respond(202, JSON.stringify({ id: "r1" })));
    vi.stubGlobal("fetch", spy);
    await createRun("问题");
    const init = (spy.mock.calls[0] as unknown[])[1] as RequestInit;
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({ question: "问题" });
  });

  test("saveConfig 走 PUT，且只发调用方给的字段——key 不会被顺手带上", async () => {
    const spy = vi.fn(async () => respond(200, JSON.stringify({ credential: "override" })));
    vi.stubGlobal("fetch", spy);
    await saveConfig({ model_id: "qwen-x" });
    const init = (spy.mock.calls[0] as unknown[])[1] as RequestInit;
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({ model_id: "qwen-x" });
  });
});
