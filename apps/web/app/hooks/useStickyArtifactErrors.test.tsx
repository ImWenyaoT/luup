import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, test, vi } from "vitest";

import { createApiClient } from "../lib/api/client";
import type { Snapshot } from "../lib/types/wire";
import { createTestWrapper } from "../test-utils";
import { useStickyArtifactErrors } from "./useStickyArtifactErrors";

const runningSnapshot: Snapshot = {
  id: "run-1",
  question: "q",
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
  artifacts: [{ id: "art-1", type: "research-plan" }],
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

describe("useStickyArtifactErrors", () => {
  test("selectArtifact 失败时写入 stickyError，dismiss 后清空", async () => {
    const fetchImpl = vi.fn(async () => respond(500, { detail: "artifact boom" }));
    const client = createApiClient({ fetchImpl });
    const { result } = renderHook(() => useStickyArtifactErrors({ runId: "run-1", snapshot: runningSnapshot }), {
      wrapper: createTestWrapper({ client }),
    });

    await act(async () => {
      result.current.selectArtifact("art-1");
    });

    await waitFor(() => expect(result.current.stickyError).toBe("artifact boom"));
    expect(result.current.selectedArtifactId).toBe("art-1");

    act(() => {
      result.current.dismissStickyError();
    });
    expect(result.current.stickyError).toBeNull();
    expect(result.current.selectedArtifactId).toBeNull();
  });

  test("prepareBeforeNewRun 在已失败 query 上同步 sticky，clearAll 清选择与粘滞", async () => {
    const fetchImpl = vi.fn(async () => respond(500, { detail: "sticky fail" }));
    const client = createApiClient({ fetchImpl });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const { result } = renderHook(() => useStickyArtifactErrors({ runId: "run-1", snapshot: runningSnapshot }), {
      wrapper: createTestWrapper({ client, queryClient }),
    });

    await act(async () => {
      result.current.selectArtifact("art-1");
    });
    await waitFor(() => expect(result.current.stickyError).toMatch(/sticky fail/));

    await act(async () => {
      await result.current.prepareBeforeNewRun();
    });
    expect(result.current.stickyError).toMatch(/sticky fail/);

    act(() => {
      result.current.clearAll();
    });
    expect(result.current.selectedArtifactId).toBeNull();
    expect(result.current.stickyError).toBeNull();
  });

  test("新 run 进入终态后清除粘滞错误", async () => {
    const fetchImpl = vi.fn(async () => respond(500, { detail: "旧 Artifact 失败" }));
    const client = createApiClient({ fetchImpl });
    const { result, rerender } = renderHook(
      ({ runId, snapshot }: { runId: string | null; snapshot: Snapshot | undefined }) =>
        useStickyArtifactErrors({ runId, snapshot }),
      {
        wrapper: createTestWrapper({ client }),
        initialProps: { runId: "run-1", snapshot: runningSnapshot },
      },
    );

    await act(async () => {
      result.current.selectArtifact("art-1");
    });
    await waitFor(() => expect(result.current.stickyError).toBe("旧 Artifact 失败"));

    const completed: Snapshot = {
      ...runningSnapshot,
      id: "run-2",
      status: "completed",
    };
    rerender({ runId: "run-2", snapshot: completed });

    await waitFor(() => expect(result.current.stickyError).toBeNull());
  });

  test("clearSelection 只清选择，保留 sticky", async () => {
    const fetchImpl = vi.fn(async () => respond(500, { detail: "keep sticky" }));
    const client = createApiClient({ fetchImpl });
    const { result } = renderHook(() => useStickyArtifactErrors({ runId: "run-1", snapshot: runningSnapshot }), {
      wrapper: createTestWrapper({ client }),
    });

    await act(async () => {
      result.current.selectArtifact("art-1");
    });
    await waitFor(() => expect(result.current.stickyError).toBe("keep sticky"));

    act(() => {
      result.current.clearSelection();
    });
    expect(result.current.selectedArtifactId).toBeNull();
    expect(result.current.stickyError).toBe("keep sticky");
  });
});
