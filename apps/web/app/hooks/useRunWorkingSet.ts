import { useCallback, useEffect, useState } from "react";

export type RunTab = { id: string; label: string };

export const RUN_WORKING_SET_KEY = "luup.run-working-set.v1";

type StoredTabs = { tabs: RunTab[]; error: string | null };

function readStoredTabs(): StoredTabs {
  if (typeof window === "undefined") return { tabs: [], error: null };
  try {
    const storage = window.localStorage;
    if (!storage) return { tabs: [], error: null };
    const value: unknown = JSON.parse(storage.getItem(RUN_WORKING_SET_KEY) ?? "[]");
    if (!Array.isArray(value)) return { tabs: [], error: "无法恢复运行标签：本地存储格式无效。" };
    const tabs: RunTab[] = [];
    const positions = new Map<string, number>();
    for (const item of value) {
      if (typeof item !== "object" || item === null) continue;
      const { id, label } = item as Partial<RunTab>;
      if (typeof id !== "string" || typeof label !== "string") continue;
      const normalizedId = id.trim();
      if (!normalizedId) continue;
      const existing = positions.get(normalizedId);
      if (existing === undefined) {
        positions.set(normalizedId, tabs.length);
        tabs.push({ id: normalizedId, label });
      } else {
        tabs[existing] = { id: normalizedId, label };
      }
    }
    return { tabs, error: null };
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return { tabs: [], error: `无法恢复运行标签：${detail}` };
  }
}

export function useRunWorkingSet() {
  const [initial] = useState(readStoredTabs);
  const [tabs, setTabs] = useState<RunTab[]>(initial.tabs);
  const [persistenceError, setPersistenceError] = useState<string | null>(initial.error);

  useEffect(() => {
    try {
      window.localStorage?.setItem(RUN_WORKING_SET_KEY, JSON.stringify(tabs));
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      setPersistenceError(`运行标签仅保存在当前页面：${detail}`);
    }
  }, [tabs]);

  const openRun = useCallback((tab: RunTab) => {
    const id = tab.id.trim();
    if (!id) return;
    const normalized = { ...tab, id };
    setTabs((current) => {
      const existing = current.findIndex((item) => item.id === id);
      if (existing === -1) return [...current, normalized];
      if (current[existing].label === normalized.label) return current;
      return current.map((item) => (item.id === id ? normalized : item));
    });
  }, []);

  const closeRun = useCallback(
    (id: string, activeId: string | null): string | null => {
      const index = tabs.findIndex((tab) => tab.id === id);
      if (index === -1 || id !== activeId) {
        setTabs((current) => current.filter((tab) => tab.id !== id));
        return activeId;
      }
      const next = tabs[index + 1] ?? tabs[index - 1] ?? null;
      setTabs((current) => current.filter((tab) => tab.id !== id));
      return next?.id ?? null;
    },
    [tabs],
  );

  return { tabs, openRun, closeRun, persistenceError, clearPersistenceError: () => setPersistenceError(null) };
}
