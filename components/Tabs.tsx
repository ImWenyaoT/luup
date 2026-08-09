"use client";

import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";

export type Tab = { id: string; label: string; disabled?: boolean; tone?: "danger"; content: ReactNode };

/**
 * 所有面板都渲染进 DOM，非活动的用 hidden 藏起来——不是偷懒：
 * 这样服务端首屏 HTML 里就有全部工件正文，无 JS 也读得到，爬虫/curl 也拿得到。
 * 缺失的工件 aria-disabled 灰显，不弹错误（§9）。
 *
 * 键盘按 WAI-ARIA 的 tabs 模式走：整条 tablist 只占一个 Tab 位（roving tabindex），
 * 左右/Home/End 在标签间移动并直接切换面板。这是自己实现而不是引 Radix 的那个点——
 * 见下面 20 行；换一个组件库要连带 forceMount 才能保住「面板全在 DOM 里」这条约束。
 */
export function Tabs({ tabs, initial }: { tabs: Tab[]; initial?: string }) {
  const enabled = tabs.filter((t) => !t.disabled);
  // 一个可用标签都没有（只落了 question.md 的中断 run）：仍选第一个，让它的「未产出」空态顶上，
  // 而不是端出一个空壳——灰着的标签本身就是「本该有这些工件」的信息。
  const fallback = initial && enabled.some((t) => t.id === initial) ? initial : (enabled[0]?.id ?? tabs[0]?.id);
  const [active, setActive] = useState(fallback);
  const listRef = useRef<HTMLDivElement | null>(null);

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

  /** step=±1 在可用标签间绕圈；Home/End 走两端。移动即选中（自动激活）。 */
  const move = (from: string, step: number | "first" | "last") => {
    if (enabled.length === 0) return;
    const at = enabled.findIndex((t) => t.id === from);
    const next =
      step === "first"
        ? enabled[0]
        : step === "last"
          ? enabled[enabled.length - 1]
          : enabled[(at + step + enabled.length) % enabled.length];
    select(next.id);
    listRef.current?.querySelector<HTMLButtonElement>(`#tab-${CSS.escape(next.id)}`)?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, id: string) => {
    const step = { ArrowRight: 1, ArrowLeft: -1, Home: "first", End: "last" }[e.key] as
      | number
      | "first"
      | "last"
      | undefined;
    if (step === undefined) return;
    e.preventDefault();
    move(id, step);
  };

  if (tabs.length === 0) return null;

  return (
    <div>
      <div ref={listRef} role="tablist" className="flex flex-wrap gap-px border-b border-line">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            id={`tab-${t.id}`}
            aria-controls={`panel-${t.id}`}
            aria-selected={active === t.id}
            aria-disabled={t.disabled || undefined}
            disabled={t.disabled}
            // roving tabindex：一条 tablist 只有一个可 Tab 到的落点
            tabIndex={active === t.id ? 0 : -1}
            onClick={() => select(t.id)}
            onKeyDown={(e) => onKeyDown(e, t.id)}
            className={`-mb-px border-x border-t px-2.5 py-1 text-[12px] ${
              t.disabled
                ? "cursor-not-allowed border-transparent text-faint/70"
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
          id={`panel-${t.id}`}
          role="tabpanel"
          aria-labelledby={`tab-${t.id}`}
          hidden={active !== t.id}
          // 面板本身可能是长正文/横向滚动区，键盘要能落进来滚动
          tabIndex={active === t.id ? 0 : undefined}
          className="border border-t-0 border-line bg-panel p-3"
        >
          {t.content}
        </div>
      ))}
    </div>
  );
}
