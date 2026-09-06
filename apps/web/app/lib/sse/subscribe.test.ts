import { describe, expect, test, vi } from "vitest";

import { RUN_EVENT_KINDS, UI_SSE_EVENT_KINDS } from "./events";
import { parseSseMessage } from "./parse-sse-message";
import { subscribeRunEvents } from "./subscribe";

describe("RUN_EVENT_KINDS", () => {
  test("包含服务端公开 event kind 且不含 sdk.output_rejected", () => {
    expect(RUN_EVENT_KINDS).toContain("run.completed");
    expect(RUN_EVENT_KINDS).not.toContain("sdk.output_rejected");
    expect(UI_SSE_EVENT_KINDS).toContain("harness.stop_requested");
    expect(UI_SSE_EVENT_KINDS).toContain("sdk.trace.tool_started");
    for (const kind of UI_SSE_EVENT_KINDS) {
      expect(RUN_EVENT_KINDS).toContain(kind);
    }
  });
});

describe("parseSseMessage", () => {
  test("解析合法 SSE data", () => {
    const payload = {
      id: 1,
      version: 2,
      kind: "run.created",
      payload: { diagnostic: null },
      created_at: "2026-01-01T00:00:00Z",
    };
    expect(parseSseMessage(JSON.stringify(payload), "run.created")).toEqual(payload);
  });

  test("未知 event kind 显式报协议错误", () => {
    const payload = {
      id: 1,
      version: 2,
      kind: "sdk.output_rejected",
      payload: {},
      created_at: "2026-01-01T00:00:00Z",
    };
    expect(() => parseSseMessage(JSON.stringify(payload), "sdk.output_rejected")).toThrow(/未知 SSE event kind/);
  });

  test("非法 JSON 显式报协议错误", () => {
    expect(() => parseSseMessage("{not-json")).toThrow(/不是有效 JSON/);
  });

  test("非对象 / 缺字段 / kind 不一致 / payload 非法均报协议错误", () => {
    expect(() => parseSseMessage("null")).toThrow(/必须是对象/);
    expect(() => parseSseMessage(JSON.stringify({ id: 1, version: 2 }))).toThrow(/缺少 kind\/created_at/);
    expect(() =>
      parseSseMessage(
        JSON.stringify({
          id: 1,
          version: 2,
          kind: "run.created",
          payload: {},
          created_at: "2026-01-01T00:00:00Z",
        }),
        "run.completed",
      ),
    ).toThrow(/kind 不一致/);
    expect(() =>
      parseSseMessage(
        JSON.stringify({
          id: 1,
          version: 2,
          kind: "run.created",
          payload: [],
          created_at: "2026-01-01T00:00:00Z",
        }),
      ),
    ).toThrow(/payload 必须是对象/);
    expect(() =>
      parseSseMessage(
        JSON.stringify({
          id: "x",
          version: 2,
          kind: "run.created",
          payload: {},
          created_at: "2026-01-01T00:00:00Z",
        }),
      ),
    ).toThrow(/缺少数字 id\/version/);
  });
});
describe("subscribeRunEvents", () => {
  test("注册 UI 生命周期与进度事件并在终态 close", () => {
    const listeners = new Map<string, EventListener>();
    const source = {
      addEventListener(type: string, listener: EventListener) {
        listeners.set(type, listener);
      },
      close: vi.fn(),
    };
    const onTick = vi.fn();
    const subscription = subscribeRunEvents("run-1", 3, onTick, {
      eventSourceFactory: () => source as unknown as EventSource,
    });

    expect(subscription.runId).toBe("run-1");
    expect(subscription.afterVersion).toBe(3);
    expect(listeners.size).toBe(UI_SSE_EVENT_KINDS.length + 2);
    expect(listeners.has("open")).toBe(true);
    expect(listeners.has("error")).toBe(true);

    const payload = JSON.stringify({
      id: 9,
      version: 10,
      kind: "run.completed",
      payload: { final_artifact_id: "a1" },
      created_at: "2026-01-01T00:00:00Z",
    });
    listeners.get("run.completed")?.(new MessageEvent("run.completed", { data: payload }) as unknown as Event);
    expect(onTick).toHaveBeenCalledTimes(1);
    expect(source.close).toHaveBeenCalledTimes(1);

    subscription.close();
    expect(source.close).toHaveBeenCalledTimes(1);
  });

  test("非法 payload 不触发 onTick，并上报协议错误", () => {
    const listeners = new Map<string, EventListener>();
    const source = {
      addEventListener(type: string, listener: EventListener) {
        listeners.set(type, listener);
      },
      close: vi.fn(),
    };
    const onTick = vi.fn();
    const onError = vi.fn();
    subscribeRunEvents("run-1", 0, onTick, {
      eventSourceFactory: () => source as unknown as EventSource,
      onError,
    });

    listeners.get("run.created")?.(new MessageEvent("run.created", { data: "not-json" }) as unknown as Event);
    expect(onTick).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ name: "SseProtocolError" }));
  });
});
