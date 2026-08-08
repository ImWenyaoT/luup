"use client";

import { type ReactNode, useEffect, useState } from "react";

export type Tab = { id: string; label: string; disabled?: boolean; tone?: "danger"; content: ReactNode };

/**
 * 所有面板都渲染进 DOM，非活动的用 hidden 藏起来——不是偷懒：
 * 这样服务端首屏 HTML 里就有全部工件正文，无 JS 也读得到，爬虫/curl 也拿得到。
 * 缺失的工件 aria-disabled 灰显，不弹错误（§9）。
 */
export function Tabs({ tabs, initial }: { tabs: Tab[]; initial?: string }) {
  const enabled = tabs.filter((t) => !t.disabled);
  const fallback = initial && enabled.some((t) => t.id === initial) ? initial : (enabled[0]?.id ?? tabs[0]?.id);
  const [active, setActive] = useState(fallback);

  // spine 节点点击 → #tab-<id>，靠 hash 同步过来
  useEffect(() => {
    const sync = () => {
      const id = window.location.hash.replace(/^#tab-/, "");
      if (id && enabled.some((t) => t.id === id)) setActive(id);
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs.length]);

  const select = (id: string) => {
    setActive(id);
    history.replaceState(null, "", `#tab-${id}`);
  };

  return (
    <div>
      <div role="tablist" className="flex flex-wrap gap-px border-b border-line">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            id={`tab-${t.id}`}
            aria-selected={active === t.id}
            aria-disabled={t.disabled || undefined}
            disabled={t.disabled}
            onClick={() => select(t.id)}
            className={`-mb-px border-x border-t px-2.5 py-1 text-[12px] ${
              t.disabled
                ? "cursor-not-allowed border-transparent text-faint/60"
                : active === t.id
                  ? `border-line bg-panel ${t.tone === "danger" ? "text-danger" : "text-accent"}`
                  : "border-transparent text-muted hover:text-fg"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tabs.map((t) => (
        <div
          key={t.id}
          role="tabpanel"
          aria-labelledby={`tab-${t.id}`}
          hidden={active !== t.id}
          className="border border-t-0 border-line bg-panel p-3"
        >
          {t.content}
        </div>
      ))}
    </div>
  );
}
