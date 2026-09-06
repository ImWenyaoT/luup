import { afterEach, describe, expect, test, vi } from "vitest";

import { createApiClient } from "./client";
import { saveConfig, fetchConfig } from "./config";
import { fetchArtifact } from "./artifacts";
import { fetchScience125, fetchScience125Question } from "./science125";
import { cancelRun, createRun, fetchRun, submitFeedback, submitInstruction } from "./runs";
import { ApiError } from "./client";

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

describe("runs API", () => {
  test("createRun 走 POST + JSON body + auth", async () => {
    const spy = vi.fn(async () => respond(202, JSON.stringify({ id: "r1", status: "running" })));
    const client = createApiClient({ fetchImpl: spy, getToken: () => "secret" });
    await createRun(client, "问题");
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/runs");
    expect(init.method).toBe("POST");
    expect(Object.fromEntries(new Headers(init.headers).entries())).toMatchObject({
      "content-type": "application/json",
      authorization: "Bearer secret",
    });
    expect(JSON.parse(init.body as string)).toEqual({ question: "问题" });
  });

  test("fetchRun 编码 run id", async () => {
    const spy = vi.fn(async () => respond(200, JSON.stringify({ id: "x" })));
    const client = createApiClient({ fetchImpl: spy });
    await fetchRun(client, "../artifacts/steal");
    expect((spy.mock.calls[0] as unknown as [string])[0]).toBe("/api/runs/..%2Fartifacts%2Fsteal");
  });

  test("createRun 空 question 的错误路径", async () => {
    const spy = vi.fn(async () => respond(422, JSON.stringify({ detail: "question 必须是非空字符串。" })));
    const client = createApiClient({ fetchImpl: spy });
    const error = await createRun(client, "").catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(422);
  });

  test("submitFeedback 带 authorization", async () => {
    const spy = vi.fn(async () => respond(202, JSON.stringify({ status: "queued", feedback_id: "f1", round: 1 })));
    const client = createApiClient({ fetchImpl: spy, getToken: () => "secret" });
    await submitFeedback(client, "r1", { feedback_id: "f1", feedback: "补充停止条件" });
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/runs/r1/feedback");
    expect(init.method).toBe("POST");
    expect(Object.fromEntries(new Headers(init.headers).entries())).toEqual({
      "content-type": "application/json",
      authorization: "Bearer secret",
    });
  });
});

describe("config API", () => {
  test("fetchConfig GET /api/config", async () => {
    const mockStatus = {
      runtime: "live",
      credential: "environment",
      model_id: "qwen-x",
      base_url: "https://example.test/v1",
    };
    const spy = vi.fn(async () => respond(200, JSON.stringify(mockStatus)));
    const client = createApiClient({ fetchImpl: spy });
    const data = await fetchConfig(client);
    expect(data).toEqual(mockStatus);
    expect((spy.mock.calls[0] as unknown as [string])[0]).toBe("/api/config");
  });

  test("saveConfig PUT 只发调用方给的字段", async () => {
    const spy = vi.fn(async () =>
      respond(200, JSON.stringify({ runtime: "live", credential: "override", model_id: "qwen-x", base_url: "u" })),
    );
    const client = createApiClient({ fetchImpl: spy });
    await saveConfig(client, { model_id: "qwen-x" });
    const init = (spy.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({ model_id: "qwen-x" });
  });

  test("saveConfig 在 getToken 存在时带 authorization", async () => {
    const spy = vi.fn(async () =>
      respond(200, JSON.stringify({ runtime: "live", credential: "override", model_id: "m", base_url: "u" })),
    );
    const client = createApiClient({ fetchImpl: spy, getToken: () => "live-token" });
    await saveConfig(client, { model_id: "qwen-x" });
    const headers = Object.fromEntries(
      new Headers((spy.mock.calls[0] as unknown as [string, RequestInit])[1].headers).entries(),
    );
    expect(headers.authorization).toBe("Bearer live-token");
  });

  test("saveConfig 无 token 时不带 authorization", async () => {
    const spy = vi.fn(async () =>
      respond(200, JSON.stringify({ runtime: "deterministic", credential: "absent", model_id: "m", base_url: "u" })),
    );
    const client = createApiClient({ fetchImpl: spy, getToken: () => undefined });
    await saveConfig(client, { model_id: "qwen-x" });
    const headers = Object.fromEntries(
      new Headers((spy.mock.calls[0] as unknown as [string, RequestInit])[1].headers).entries(),
    );
    expect(headers.authorization).toBeUndefined();
  });
});

describe("science125 API", () => {
  test("fetchScience125", async () => {
    const mockData = { source: "src", retrievedAt: "2026-08-08", total: 125, domains: [] };
    const spy = vi.fn(async () => respond(200, JSON.stringify(mockData)));
    const client = createApiClient({ fetchImpl: spy });
    const data = await fetchScience125(client);
    expect(data).toEqual(mockData);
    expect((spy.mock.calls[0] as unknown as [string])[0]).toBe("/api/science125");
  });

  test("fetchScience125Question 编码 id", async () => {
    const mockQ = { question: { id: 61, domain: "Physics", question: "Dark matter" }, formattedText: "text" };
    const spy = vi.fn(async () => respond(200, JSON.stringify(mockQ)));
    const client = createApiClient({ fetchImpl: spy });
    const data = await fetchScience125Question(client, 61);
    expect(data).toEqual(mockQ);
    expect((spy.mock.calls[0] as unknown as [string])[0]).toBe("/api/science125/61");
  });
});

describe("artifacts API", () => {
  test("fetchArtifact 编码 artifact id", async () => {
    const spy = vi.fn(async () => respond(200, JSON.stringify({ id: "a1", type: "research", content: {} })));
    const client = createApiClient({ fetchImpl: spy });
    await fetchArtifact(client, "art/1");
    expect((spy.mock.calls[0] as unknown as [string])[0]).toBe("/api/artifacts/art%2F1");
  });
});

test("运行控制POST保留身份、编码run ID并发送原始幂等ID", async () => {
  const fetchImpl = vi.fn(async () => respond(202, JSON.stringify({ status: "queued" })));
  const client = createApiClient({ fetchImpl, getToken: () => "secret" });
  await cancelRun(client, "run/1");
  const instruction = { instruction_id: "same-id", role: "research-plan" as const, instruction: "增加对照" };
  await submitInstruction(client, "run/1", instruction);
  await submitInstruction(client, "run/1", instruction);
  const calls = fetchImpl.mock.calls as unknown as Array<[string, RequestInit]>;
  expect(calls.map(([url]) => url)).toEqual([
    "/api/runs/run%2F1/cancel",
    "/api/runs/run%2F1/instructions",
    "/api/runs/run%2F1/instructions",
  ]);
  expect(
    calls.map(([, init]) => {
      if (typeof init.body !== "string") throw new Error("Expected JSON request body");
      return JSON.parse(init.body);
    }),
  ).toEqual([{}, instruction, instruction]);
  for (const [, init] of calls) {
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer secret");
  }
});
