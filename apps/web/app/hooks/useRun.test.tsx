import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { ApiError, createApiClient } from "../lib/api/client";
import type { Snapshot } from "../lib/types/wire";
import { createTestWrapper } from "../test-utils";
import { useRun } from "./useRun";

const snapshot: Snapshot = {
  id: "run-abc",
  question: "什么是暗物质？",
  status: "running",
  current_role: "researcher",
  version: 1,
  error_code: null,
  final_artifact_id: null,
  attempts: [],
  subagents: [],
  tool_evidence: [],
  omitted_evidence_count: 0,
  omitted_evidence_tools: [],
  artifacts: [],
  recent_events: [],
};

function respond(status: number, body: unknown, ok = status < 400): Response {
  return {
    ok,
    status,
    statusText: `HTTP-${status}`,
    json: async () => body,
  } as unknown as Response;
}

describe("useRun", () => {
  test("runId 为 null 时保持 idle", async () => {
    const fetchImpl = vi.fn();
    const client = createApiClient({ fetchImpl });
    const { result } = renderHook(() => useRun(null, { client }), {
      wrapper: createTestWrapper({ client }),
    });
    expect(result.current.state.status).toBe("idle");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("runId 变化时 fetch snapshot 并进入 ready", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === "/api/runs/run-abc") return respond(200, snapshot);
      return respond(404, { detail: "not found" });
    }) as typeof fetch;
    const client = createApiClient({ fetchImpl });
    const { result } = renderHook(({ runId }) => useRun(runId, { client }), {
      wrapper: createTestWrapper({ client }),
      initialProps: { runId: "run-abc" as string | null },
    });

    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    expect(result.current.state).toMatchObject({ status: "ready", snapshot });
  });

  test("createAndNavigate 创建 run 并返回 id", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === "/api/runs" && init?.method === "POST") {
        return respond(202, snapshot);
      }
      return respond(404, { detail: "not found" });
    }) as typeof fetch;
    const client = createApiClient({ fetchImpl });
    const { result } = renderHook(() => useRun(null, { client }), {
      wrapper: createTestWrapper({ client }),
    });

    let newId = "";
    await act(async () => {
      newId = await result.current.createAndNavigate("新问题");
    });

    expect(newId).toBe("run-abc");
    expect(result.current.state.status).toBe("ready");
  });

  test("refetch 失败时保留 lastSnapshot", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(respond(200, snapshot))
      .mockResolvedValueOnce(respond(503, { detail: "临时不可用" }))
      .mockResolvedValue(respond(503, { detail: "临时不可用" }));
    const client = createApiClient({ fetchImpl });
    const { result } = renderHook(() => useRun("run-abc", { client }), {
      wrapper: createTestWrapper({ client }),
    });

    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.state.status).toBe("error");
    if (result.current.state.status === "error") {
      expect(result.current.state.lastSnapshot).toEqual(snapshot);
      expect(result.current.state.error).toBeInstanceOf(ApiError);
    }
  });

  test("初始 fetch 失败进入 error", async () => {
    const fetchImpl = vi.fn(async () => respond(404, { detail: "run 不存在" }));
    const client = createApiClient({ fetchImpl });
    const { result } = renderHook(() => useRun("missing", { client }), {
      wrapper: createTestWrapper({ client }),
    });

    await waitFor(() => expect(result.current.state.status).toBe("error"));
    if (result.current.state.status === "error") {
      expect(result.current.state.error.status).toBe(404);
    }
  });
});
