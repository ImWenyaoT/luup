import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test } from "vitest";

import { RUN_WORKING_SET_KEY, useRunWorkingSet } from "./useRunWorkingSet";

let stored = new Map<string, string>();

beforeEach(() => {
  stored = new Map();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
      removeItem: (key: string) => stored.delete(key),
      clear: () => stored.clear(),
    },
  });
});

describe("useRunWorkingSet", () => {
  test("添加、更新并持久化本机已打开的 Run", async () => {
    const { result } = renderHook(() => useRunWorkingSet());
    act(() => result.current.openRun({ id: "run-1", label: "问题一" }));
    act(() => result.current.openRun({ id: "run-2", label: "问题二" }));
    act(() => result.current.openRun({ id: "run-1", label: "问题一（更新）" }));

    expect(result.current.tabs).toEqual([
      { id: "run-1", label: "问题一（更新）" },
      { id: "run-2", label: "问题二" },
    ]);
    await waitFor(() => expect(JSON.parse(stored.get(RUN_WORKING_SET_KEY) ?? "[]")).toEqual(result.current.tabs));
  });

  test("从 localStorage 恢复并在关闭 active tab 时选择相邻项", () => {
    stored.set(
      RUN_WORKING_SET_KEY,
      JSON.stringify([
        { id: "run-1", label: "问题一" },
        { id: "run-2", label: "问题二" },
        { id: "run-3", label: "问题三" },
      ]),
    );
    const { result } = renderHook(() => useRunWorkingSet());
    expect(result.current.tabs).toHaveLength(3);
    let next: string | null = null;
    act(() => {
      next = result.current.closeRun("run-2", "run-2");
    });
    expect(next).toBe("run-3");
    expect(result.current.tabs.map((tab) => tab.id)).toEqual(["run-1", "run-3"]);
    act(() => {
      next = result.current.closeRun("run-3", "run-3");
    });
    expect(next).toBe("run-1");
  });

  test("恢复时拒绝损坏和空 id，并按首次位置合并重复项", () => {
    stored.set(
      RUN_WORKING_SET_KEY,
      JSON.stringify([
        null,
        { id: "", label: "空" },
        { id: "   ", label: "空白" },
        { id: "run-1", label: "问题一" },
        { id: 2, label: "错误 id" },
        { id: "run-2", label: "问题二" },
        { id: "run-1", label: "问题一（新标签）" },
        { id: "run-3", label: 3 },
      ]),
    );
    const { result } = renderHook(() => useRunWorkingSet());
    expect(result.current.tabs).toEqual([
      { id: "run-1", label: "问题一（新标签）" },
      { id: "run-2", label: "问题二" },
    ]);

    act(() => result.current.openRun({ id: "  ", label: "不应加入" }));
    expect(result.current.tabs).toHaveLength(2);
  });

  test("损坏的本地存储不会被静默当成空工作集", () => {
    stored.set(RUN_WORKING_SET_KEY, "{not-json");
    const { result } = renderHook(() => useRunWorkingSet());
    expect(result.current.tabs).toEqual([]);
    expect(result.current.persistenceError).toMatch(/无法恢复运行标签/);
    act(() => result.current.clearPersistenceError());
    expect(result.current.persistenceError).toBeNull();
  });

  test("持久化失败保留内存状态并暴露错误", async () => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: () => null,
        setItem: () => {
          throw new DOMException("quota exceeded", "QuotaExceededError");
        },
      },
    });
    const { result } = renderHook(() => useRunWorkingSet());
    act(() => result.current.openRun({ id: "run-1", label: "问题一" }));
    expect(result.current.tabs).toEqual([{ id: "run-1", label: "问题一" }]);
    await waitFor(() => expect(result.current.persistenceError).toMatch(/仅保存在当前页面/));
  });
});
