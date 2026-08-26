import type { Snapshot } from "../../lib/types/wire";
import { RunStatusBadge } from "../workspace/RunStatusBadge";

export type RunHeaderProps = {
  snapshot: Snapshot;
  sseConnected?: boolean;
};

export function RunHeader({ snapshot, sseConnected }: RunHeaderProps) {
  return (
    <header
      className="flex flex-wrap items-center gap-3 rounded-lg border border-neutral-200 bg-white px-3.5 py-2.5 shadow-sm"
      data-testid="run-header"
    >
      <span data-testid="run-status-badge">
        <RunStatusBadge status={snapshot.status} />
      </span>
      {snapshot.error_code !== null && (
        <span className="font-mono text-xs font-semibold text-red-600">{snapshot.error_code}</span>
      )}
      <span className="flex-1 text-xs font-medium leading-relaxed">{snapshot.question}</span>
      {sseConnected && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">SSE</span>}
      <details className="text-xs text-neutral-500">
        <summary className="cursor-pointer font-medium hover:text-neutral-900">技术详情</summary>
        <div className="mt-1 space-y-0.5 rounded bg-neutral-50 p-2 font-mono text-[11px]">
          <div>run_id: {snapshot.id}</div>
          <div>version: {snapshot.version}</div>
        </div>
      </details>
    </header>
  );
}
