import { useState } from "react";

import { ROLE_LABEL } from "../../lib/types/constants";
import type { Evidence, Role, Snapshot } from "../../lib/types/wire";
import { buildSegments, EVIDENCE_FAILURE, preview, railTone, segmentDuration } from "./trajectoryUtils";

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
    <section className="space-y-2" data-testid="trajectory">
      <div className="flex items-center justify-between">
        <h2 className="font-mono text-xs uppercase tracking-widest text-neutral-500">执行轨迹 · {searches} 次检索</h2>
        <button
          type="button"
          className="h-7 rounded px-2 text-xs text-neutral-500 hover:bg-neutral-100"
          onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(segments.map((s) => s.role)))}
        >
          {allCollapsed ? "全部展开" : "全部折叠"}
        </button>
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

function SegmentRow({
  segment,
  currentRole,
  collapsed,
  onToggle,
}: {
  segment: ReturnType<typeof buildSegments>[number];
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
        className="flex min-h-10 w-full flex-wrap items-center gap-x-2 gap-y-0.5 rounded-sm px-1 text-left hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-neutral-400 disabled:cursor-default disabled:hover:bg-transparent"
      >
        <span className="text-xs font-medium">{ROLE_LABEL[role]}</span>
        <span className="font-mono text-[11px] text-neutral-500">{role}</span>
        {pending && <span className="text-[11px] text-neutral-500">待执行</span>}
        {attempts.length > 1 && <span className="font-mono text-[11px] text-neutral-500">×{attempts.length}</span>}
        {corrections > 0 && (
          <span
            className="rounded-sm border px-1 font-mono text-[11px] text-neutral-500"
            title={`${corrections} 次纠错`}
          >
            ↻{corrections}
          </span>
        )}
        {last?.failure_code != null && <span className="font-mono text-[11px] text-red-600">{last.failure_code}</span>}
        <span className="ml-auto font-mono text-[11px] tabular-nums text-neutral-500">
          {running ? "进行中" : (duration ?? "")}
        </span>
      </button>

      {!pending && collapsed && (
        <div className="pb-1 pl-1 text-[11px] text-neutral-500">
          … {evidence.length > 0 ? `${evidence.length} 次检索 · ${citations} 条引用` : `${attempts.length} 次尝试`}
          {corrections > 0 && ` · ↻${corrections} 纠错`}
        </div>
      )}

      {!pending && !collapsed && evidence.length > 0 && (
        <div className="space-y-1 pb-1 pl-1">
          {evidence.map((item) => (
            <EvidenceRow key={item.id} evidence={item} />
          ))}
        </div>
      )}
    </li>
  );
}

function EvidenceRow({ evidence }: { evidence: Evidence }) {
  const failed = EVIDENCE_FAILURE.has(evidence.status);
  const summary = evidence.output.result_summary;
  const full = `${evidence.tool_name} ${evidence.query} → ${failed ? evidence.status : (summary ?? "无输出")}`;

  return (
    <div className="text-xs">
      <div
        className="grid min-h-10 grid-cols-[minmax(140px,0.38fr)_auto_minmax(0,1fr)] items-center gap-x-2"
        title={full}
      >
        <span className="truncate font-mono text-[11px]">
          <span>{evidence.tool_name}</span> <span className="text-neutral-500">{evidence.query}</span>
        </span>
        <span className="text-[11px] text-neutral-500">→</span>
        {failed ? (
          <span className="truncate font-mono text-[11px] text-red-600">{evidence.status}</span>
        ) : summary !== null && summary !== "" ? (
          <span className="truncate text-neutral-500">
            {evidence.status === "partial" && <span className="font-mono text-[11px]">partial · </span>}
            {preview(summary)}
          </span>
        ) : (
          <span className="text-[11px] text-neutral-500/80">{evidence.status === "empty" ? "空结果" : "无输出"}</span>
        )}
      </div>
      {evidence.output.citations.length > 0 && (
        <div className="space-y-0.5 border-l pl-3">
          {evidence.output.citations.map((citation) => (
            <div key={citation.locator}>
              <span className="font-mono text-[11px] text-neutral-500">{citation.locator}</span>
              {" · "}
              {citation.url === null ? (
                citation.title
              ) : (
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
