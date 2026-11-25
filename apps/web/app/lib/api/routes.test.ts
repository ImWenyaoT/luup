import { afterEach, describe, expect, test, vi } from "vitest";

import { createApiClient, ApiError } from "./client";
import { saveConfig, fetchConfig } from "./config";
import { getMillStatus, startMill, stopMill } from "./mill";
import { fetchSiwcStatus, logoutSiwc, startSiwc } from "./siwc";

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
    await saveConfig(client, { model_id: "qwen-x", provider: "deepseek", api_surface: "responses" });
    const init = (spy.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({
      model_id: "qwen-x",
      provider: "deepseek",
      api_surface: "responses",
    });
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

describe("siwc API", () => {
  test("start / status / logout 路径正确", async () => {
    const spy = vi.fn(async (url: string) => {
      if (String(url).endsWith("/start")) return respond(200, JSON.stringify({ authorize_url: "https://a" }));
      if (String(url).endsWith("/logout")) return respond(200, JSON.stringify({ signed_in: false }));
      return respond(200, JSON.stringify({ signed_in: true, email: "a@b.c" }));
    });
    const client = createApiClient({ fetchImpl: spy as unknown as typeof fetch, getToken: () => "t" });
    await startSiwc(client);
    await fetchSiwcStatus(client);
    await logoutSiwc(client);
    expect(spy.mock.calls.map((c) => String(c[0]))).toEqual([
      "/api/auth/siwc/start",
      "/api/auth/siwc/status",
      "/api/auth/siwc/logout",
    ]);
  });
});

describe("mill API", () => {
  test("getMillStatus / startMill / stopMill 路径正确", async () => {
    const spy = vi.fn(async (url: string) => {
      if (String(url).endsWith("/start")) return respond(202, JSON.stringify({ status: "running" }));
      if (String(url).endsWith("/stop")) return respond(200, JSON.stringify({ status: "stopped" }));
      return respond(200, JSON.stringify({ status: "idle" }));
    });
    const client = createApiClient({ fetchImpl: spy as unknown as typeof fetch, getToken: () => "t" });
    await getMillStatus(client);
    await startMill(client, {
      topic: "t",
      seedQuestions: ["q?"],
      targetPapers: 1,
      maxTickets: 2,
    });
    await stopMill(client);
    const urls = spy.mock.calls.map((c) => String(c[0]));
    expect(urls).toEqual(["/api/autoresearch/mill", "/api/autoresearch/mill/start", "/api/autoresearch/mill/stop"]);
  });

  test("startMill 错误路径", async () => {
    const spy = vi.fn(async () => respond(422, JSON.stringify({ detail: "empty_topic" })));
    const client = createApiClient({ fetchImpl: spy });
    const error = await startMill(client, {
      topic: "",
      seedQuestions: [],
      targetPapers: 1,
      maxTickets: 1,
    }).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(422);
  });
});
