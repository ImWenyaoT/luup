import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

const { subscribeRunEventsMock } = vi.hoisted(() => ({
  subscribeRunEventsMock: vi.fn(
    (
      _runId: string,
      _afterVersion: number,
      _onTick: () => void,
      _options?: { onOpen?: () => void; onError?: (error: Error) => void },
    ) => ({ close: vi.fn(), runId: "r1", afterVersion: 1 }),
  ),
}));

vi.mock("../lib/sse/subscribe", () => ({
  subscribeRunEvents: subscribeRunEventsMock,
}));

import { useRunEvents } from "./useRunEvents";
import type { Snapshot } from "../lib/types/wire";

const runningSnapshot: Snapshot = {
  id: "r1",
  question: "q",
  status: "running",
  current_role: "researcher",
  version: 5,
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

afterEach(() => {
  subscribeRunEventsMock.mockClear();
});

describe("useRunEvents", () => {
  test("running snapshot 订阅并在 unmount 时 close", () => {
    const close = vi.fn();
    subscribeRunEventsMock.mockReturnValue({ close, runId: "r1", afterVersion: 5 });
    const onTick = vi.fn();

    const { unmount, result } = renderHook(({ runId, snapshot }) => useRunEvents(runId, snapshot, onTick), {
      initialProps: { runId: "r1", snapshot: runningSnapshot },
    });

    expect(result.current.connected).toBe(false);
    expect(subscribeRunEventsMock).toHaveBeenCalledWith(
      "r1",
      5,
      expect.any(Function),
      expect.objectContaining({ onOpen: expect.any(Function), onError: expect.any(Function) }),
    );
    const options = subscribeRunEventsMock.mock.calls[0]?.[3] as { onOpen: () => void };
    act(() => options.onOpen());
    expect(result.current.connected).toBe(true);
    unmount();
    expect(close).toHaveBeenCalledTimes(1);
  });

  test("终态 snapshot 不订阅", () => {
    const onTick = vi.fn();
    renderHook(() => useRunEvents("r1", { ...runningSnapshot, status: "completed" }, onTick));
    expect(subscribeRunEventsMock).not.toHaveBeenCalled();
  });

  test("runId 为 null 时不订阅", () => {
    const onTick = vi.fn();
    const { result } = renderHook(() => useRunEvents(null, runningSnapshot, onTick));
    expect(result.current.connected).toBe(false);
    expect(subscribeRunEventsMock).not.toHaveBeenCalled();
  });
});
