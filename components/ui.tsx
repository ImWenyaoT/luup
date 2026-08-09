import type { ReactNode } from "react";

type Tone = "accent" | "danger" | "muted" | "line";

const TONE_CLASS: Record<Tone, string> = {
  accent: "border-accent/60 text-accent bg-accent-soft",
  danger: "border-danger/60 text-danger bg-danger-soft",
  muted: "border-line text-muted",
  line: "border-line-strong text-fg",
};

export function Pill({
  children,
  tone = "muted",
  title,
}: {
  children: ReactNode;
  tone?: Tone;
  title?: string;
}) {
  return (
    <span
      title={title}
      // 徽章折行会把「通过验收」断成「通过验／收」——状态标签宁可撑宽一列也不许换行
      className={`inline-flex items-center gap-1 rounded-xs border px-1.5 py-px text-[11px] leading-5 whitespace-nowrap ${TONE_CLASS[tone]}`}
    >
      {children}
    </span>
  );
}

/** 单信号色的条形计量。图表库为这点事引进来是不划算的。 */
export function Meter({ value, total, label }: { value: number; total: number; label: string }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="min-w-32 flex-1">
      <div className="flex items-baseline justify-between text-[11px] text-muted">
        <span>{label}</span>
        <span className="text-fg">
          {value}
          <span className="text-faint">/{total}</span>
        </span>
      </div>
      <div className="mt-1 h-1 w-full bg-line" role="presentation">
        <div className="h-1 bg-accent" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: ReactNode }) {
  return (
    <div className="border border-dashed border-line px-4 py-8 text-center">
      <div className="text-muted">{title}</div>
      {hint ? <div className="mt-1 text-[11px] text-faint">{hint}</div> : null}
    </div>
  );
}

export function ErrorNote({ children, onRetry }: { children: ReactNode; onRetry?: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 border border-danger/50 bg-danger-soft px-3 py-1.5 text-[12px] text-danger">
      <span>{children}</span>
      {onRetry ? (
        <button type="button" onClick={onRetry} className="border border-danger/50 px-2 py-px hover:bg-danger/10">
          重试
        </button>
      ) : null}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] tracking-wide text-muted uppercase">{label}</span>
      {children}
    </label>
  );
}

export function Panel({
  title,
  right,
  children,
  className = "",
}: {
  title?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`border border-line bg-panel ${className}`}>
      {title ? (
        <header className="flex items-center justify-between gap-3 border-b border-line px-3 py-1.5 text-[11px] tracking-wide text-muted uppercase">
          <span>{title}</span>
          {right}
        </header>
      ) : null}
      <div className="p-3">{children}</div>
    </section>
  );
}

export function Kv({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="text-faint">{k}</span>
      <span>{v}</span>
    </div>
  );
}
