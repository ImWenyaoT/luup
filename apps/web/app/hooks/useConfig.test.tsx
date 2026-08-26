import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { ApiError, createApiClient } from "../lib/api/client";
import type { ConfigStatus } from "../lib/types/wire";
import { createTestWrapper } from "../test-utils";
import { useConfig } from "./useConfig";

const mockConfig: ConfigStatus = {
  runtime: "live",
  credential: "environment",
  model_id: "qwen-test",
  base_url: "https://api.example.com/v1",
};

function respond(status: number, body: unknown, ok = status < 400): Response {
  return {
    ok,
    status,
    statusText: `HTTP-${status}`,
    json: async () => body,
  } as unknown as Response;
}

describe("useConfig", () => {
  test("挂载时加载 config", async () => {
    const fetchImpl = vi.fn(async () => respond(200, mockConfig));
    const client = createApiClient({ fetchImpl });
    const { result } = renderHook(() => useConfig({ client }), {
      wrapper: createTestWrapper({ client }),
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.config).toEqual(mockConfig);
  });

  test("save 成功更新 config", async () => {
    const updated: ConfigStatus = { ...mockConfig, model_id: "qwen-new", credential: "override" };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(respond(200, mockConfig))
      .mockResolvedValueOnce(respond(200, updated));
    const client = createApiClient({ fetchImpl });
    const { result } = renderHook(() => useConfig({ client }), {
      wrapper: createTestWrapper({ client }),
    });

    await waitFor(() => expect(result.current.config).toEqual(mockConfig));

    await act(async () => {
      await result.current.save({ model_id: "qwen-new" });
    });

    expect(result.current.saving).toBe(false);
    expect(result.current.config?.model_id).toBe("qwen-new");
  });

  test("save 失败设置 error 并抛出 ApiError", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(respond(200, mockConfig))
      .mockResolvedValueOnce(respond(422, { detail: "无效 model_id" }));
    const client = createApiClient({ fetchImpl });
    const { result } = renderHook(() => useConfig({ client }), {
      wrapper: createTestWrapper({ client }),
    });

    await waitFor(() => expect(result.current.config).toEqual(mockConfig));

    let thrown: unknown;
    await act(async () => {
      try {
        await result.current.save({ model_id: "bad" });
      } catch (cause) {
        thrown = cause;
      }
    });

    expect(thrown).toBeInstanceOf(ApiError);

    expect(result.current.error?.status).toBe(422);
  });

  test("reload 重新拉取", async () => {
    const fetchImpl = vi.fn(async () => respond(200, mockConfig));
    const client = createApiClient({ fetchImpl });
    const { result } = renderHook(() => useConfig({ client }), {
      wrapper: createTestWrapper({ client }),
    });

    await waitFor(() => expect(result.current.config).toEqual(mockConfig));
    await act(async () => {
      await result.current.reload();
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
