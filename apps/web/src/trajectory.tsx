import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ROLE_LABEL, ROLE_ORDER, type Attempt, type Evidence, type Role, type Snapshot } from "./types";

/**
 * 执行轨迹：五角色段（默认展开）+ 证据配对行。
 *
 * 呈现语言取自 deepseek-harness 的 ui-trajectory（工具调用配对单行、角色 rail、
 * 折叠=降采样、双阈值截断、每种「没有」有专属文案），数据面零新增——全部字段
 * 来自既有公共投影。折叠是主动降采样：摘要行保留计数，不是信息消失。
 */

/** 双阈值截断：先粗切压空白，再截到预览长度；详情（title 属性）永远给全量。 */
export function preview(text: string, limit = 240): string {
  const collapsed = text.slice(0, 2048).replace(/\s+/g, " ").trim();
  return collapsed.length <= limit ? collapsed : `${collapsed.slice(0, limit)}…`;
}

function attemptSeconds(attempt: Attempt): number | null {
  if (attempt.finished_at === null) return null;
  const ms = Date.parse(attempt.finished_at) - Date.parse(attempt.started_at);
  return Number.isFinite(ms) && ms >= 0 ? ms / 1000 : null;
}

/** 段级墙钟：有在跑的尝试就不给数——进行中不编造时长。 */
function segmentDuration(attempts: Attempt[]): string | null {
  if (attempts.length === 0) return null;
  let total = 0;
  for (const attempt of attempts) {
    const value = attemptSeconds(attempt);
    if (value === null) return null;
    total += value;
  }
  return `${total.toFixed(1)}s`;
}

/** 检索失败的五种状态直接把状态码当结果展示；partial 保留摘要但带上状态。 */
const EVIDENCE_FAILURE: ReadonlySet<string> = new Set([
  "failed", "timeout", "rate_limited", "source_unavailable", "refused",
]);

type Segment = {
  role: Role;
  attempts: Attempt[];
  evidence: Evidence[];
};

function buildSegments(snapshot: Snapshot): Segment[] {
  return ROLE_ORDER.map((role) => {
    const attempts = snapshot.attempts.filter((item) => item.role === role);
    const ids = new Set(attempts.map((item) => item.id));
    return { role, attempts, evidence: snapshot.tool_evidence.filter((item) => ids.has(item.attempt_id)) };
  });
}

function railTone(segment: Segment, currentRole: Role | null): string {
  const last = segment.attempts.at(-1);
  if (last?.status === "failed") return "border-l-destructive";
  if (last?.status === "running" || segment.role === currentRole) return "border-l-teal-600 dark:border-l-teal-400";
  if (last?.status === "completed") return "border-l-foreground/25";
  return "border-l-transparent";
}

export function Trajectory({ snapshot }: { snapshot: Snapshot }) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<Role>>(new Set());
  const segments = buildSegments(snapshot);
  const searches = snapshot.tool_evidence.length;
  const allCollapsed = segments.every((segment) => collapsed.has(segment.role));

  function toggle(role: Role) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(role)) next.delete(role);
      else next.add(role);
      return next;
    });
  }

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          执行轨迹 · {searches} 次检索
        </h2>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs text-muted-foreground"
          onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(segments.map((s) => s.role)))}
        >
          {allCollapsed ? "全部展开" : "全部折叠"}
        </Button>
      </div>
      <ol className="space-y-1">
        {segments.map((segment) => (
          <SegmentRow
            key={segment.role}
            segment={segment}
            currentRole={snapshot.current_role}
            collapsed={collapsed.has(segment.role)}
            onToggle={() => toggle(segment.role)}
          />
        ))}
      </ol>
    </section>
  );
}

function SegmentRow({ segment, currentRole, collapsed, onToggle }: {
  segment: Segment;
  currentRole: Role | null;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const { role, attempts, evidence } = segment;
  const last = attempts.at(-1);
  const corrections = attempts.reduce((sum, item) => sum + item.corrections, 0);
  const citations = evidence.reduce((sum, item) => sum + item.output.citations.length, 0);
  const duration = segmentDuration(attempts);
  const pending = attempts.length === 0;
  const running = last?.status === "running";

  return (
    <li className={`border-l-2 pl-3 ${railTone(segment, currentRole)} ${pending ? "opacity-55" : ""}`}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        disabled={pending}
        className="flex min-h-10 w-full flex-wrap items-center gap-x-2 gap-y-0.5 rounded-sm px-1 text-left hover:bg-accent/60 focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-default disabled:hover:bg-transparent"
      >
        <span className="text-xs font-medium">{ROLE_LABEL[role]}</span>
        <span className="font-mono text-[11px] text-muted-foreground">{role}</span>
        {pending && <span className="text-[11px] text-muted-foreground">待执行</span>}
        {attempts.length > 1 && (
          <span className="font-mono text-[11px] text-muted-foreground">×{attempts.length}</span>
        )}
        {corrections > 0 && (
          <span className="rounded-sm border px-1 font-mono text-[11px] text-muted-foreground" title={`${corrections} 次纠错`}>
            ↻{corrections}
          </span>
        )}
        {last?.failure_code != null && (
          <span className="font-mono text-[11px] text-destructive">{last.failure_code}</span>
        )}
        <span className="ml-auto font-mono text-[11px] tabular-nums text-muted-foreground">
          {running ? "进行中" : duration ?? ""}
        </span>
      </button>

      {!pending && collapsed && (
        <div className="pb-1 pl-1 text-[11px] text-muted-foreground">
          … {evidence.length > 0 ? `${evidence.length} 次检索 · ${citations} 条引用` : `${attempts.length} 次尝试`}
          {corrections > 0 && ` · ↻${corrections} 纠错`}
        </div>
      )}

      {!pending && !collapsed && evidence.length > 0 && (
        <div className="space-y-1 pb-1 pl-1">
          {evidence.map((item) => <EvidenceRow key={item.id} evidence={item} />)}
        </div>
      )}
    </li>
  );
}

function EvidenceRow({ evidence }: { evidence: Evidence }) {
  const failed = EVIDENCE_FAILURE.has(evidence.status);
  const summary = evidence.output.result_summary;
  const full = `${evidence.tool_name} ${evidence.query} → ${failed ? evidence.status : summary ?? "无输出"}`;

  return (
    <div className="text-xs">
      <div
        className="grid min-h-10 grid-cols-[minmax(140px,0.38fr)_auto_minmax(0,1fr)] items-center gap-x-2"
        title={full}
      >
        <span className="truncate font-mono text-[11px]">
          <span>{evidence.tool_name}</span>{" "}
          <span className="text-muted-foreground">{evidence.query}</span>
        </span>
        <span className="text-[11px] text-muted-foreground">→</span>
        {failed ? (
          <span className="truncate font-mono text-[11px] text-destructive">{evidence.status}</span>
        ) : summary !== null && summary !== "" ? (
          <span className="truncate text-muted-foreground">
            {evidence.status === "partial" && <span className="font-mono text-[11px]">partial · </span>}
            {preview(summary)}
          </span>
        ) : (
          <span className="text-[11px] text-muted-foreground/80">
            {evidence.status === "empty" ? "空结果" : "无输出"}
          </span>
        )}
      </div>
      {evidence.output.citations.length > 0 && (
        <div className="space-y-0.5 border-l pl-3">
          {evidence.output.citations.map((citation) => (
            <div key={citation.locator}>
              <span className="font-mono text-[11px] text-muted-foreground">{citation.locator}</span>
              {" · "}
              {citation.url === null
                ? citation.title
                : (
                  <a className="underline underline-offset-2" href={citation.url} target="_blank" rel="noreferrer">
                    {citation.title}
                  </a>
                )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
