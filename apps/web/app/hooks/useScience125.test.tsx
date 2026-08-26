import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { createApiClient } from "../lib/api/client";
import type { Science125Data } from "../lib/types/wire";
import { createTestWrapper } from "../test-utils";
import { useScience125 } from "./useScience125";

const mockData: Science125Data = {
  source: "fixture",
  retrievedAt: "2025-01-01T00:00:00Z",
  total: 4,
  domains: [
    {
      domain: "Physics",
      count: 2,
      questions: [
        { id: 1, domain: "Physics", question: "暗物质是什么？" },
        { id: 2, domain: "Physics", question: "量子引力如何统一？" },
      ],
    },
    {
      domain: "Biology",
      count: 2,
      questions: [
        { id: 10, domain: "Biology", question: "意识如何产生？" },
        { id: 13, domain: "Biology", question: "衰老能否逆转？" },
      ],
    },
  ],
};

function respond(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => body,
  } as unknown as Response;
}

describe("useScience125", () => {
  test("加载成功返回 data", async () => {
    const fetchImpl = vi.fn(async () => respond(mockData));
    const client = createApiClient({ fetchImpl });
    const { result } = renderHook(() => useScience125({ client }), {
      wrapper: createTestWrapper({ client }),
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual(mockData);
    expect(result.current.error).toBeNull();
  });

  test("加载失败返回 error", async () => {
    const fetchImpl = vi.fn(
      async () =>
        ({
          ok: false,
          status: 500,
          statusText: "Error",
          json: async () => ({ detail: "server error" }),
        }) as unknown as Response,
    ) as typeof fetch;
    const client = createApiClient({ fetchImpl });
    const { result } = renderHook(() => useScience125({ client }), {
      wrapper: createTestWrapper({ client }),
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBeNull();
    expect(result.current.error?.status).toBe(500);
  });

  test("getById 按 id 查找题目", async () => {
    const fetchImpl = vi.fn(async () => respond(mockData));
    const client = createApiClient({ fetchImpl });
    const { result } = renderHook(() => useScience125({ client }), {
      wrapper: createTestWrapper({ client }),
    });

    await waitFor(() => expect(result.current.data).not.toBeNull());
    expect(result.current.getById(10)?.question).toBe("意识如何产生？");
    expect(result.current.getById(999)).toBeUndefined();
  });

  test("pickRandom 从题库返回一题", async () => {
    const fetchImpl = vi.fn(async () => respond(mockData));
    const client = createApiClient({ fetchImpl });
    const { result } = renderHook(() => useScience125({ client }), {
      wrapper: createTestWrapper({ client }),
    });

    await waitFor(() => expect(result.current.data).not.toBeNull());
    const picked = result.current.pickRandom();
    expect(picked).not.toBeNull();
    expect(mockData.domains.flatMap((d) => d.questions)).toContainEqual(picked);
  });
});
