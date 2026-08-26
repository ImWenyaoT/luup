import { ROLE_LABEL } from "../../lib/types/constants";
import type { Snapshot } from "../../lib/types/wire";

const STATUS_LABEL = {
  running: "进行中",
  completed: "已完成",
  failed: "失败",
} as const;

export function SubagentLineage({ snapshot }: { snapshot: Snapshot }) {
  return (
    <section className="space-y-2" aria-labelledby="subagent-lineage-title" data-testid="subagent-lineage">
      <h2 id="subagent-lineage-title" className="font-mono text-xs uppercase tracking-widest text-neutral-500">
        Subagents · {snapshot.subagents.length}
      </h2>
      <div className="border-l-2 border-l-neutral-300 pl-3">
        <div className="flex flex-wrap items-baseline gap-x-2 text-xs">
          <span className="font-medium">控制面</span>
          <span className="font-mono text-[11px] text-neutral-500">{snapshot.id}</span>
        </div>
        <ol className="mt-2 space-y-1">
          {snapshot.subagents.map((subagent) => (
            <li key={subagent.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 border-l pl-3 text-xs">
              <div className="min-w-0">
                <span className="font-medium">{ROLE_LABEL[subagent.role]}</span>
                <span className="ml-2 font-mono text-[11px] text-neutral-500">
                  {subagent.role} #{subagent.ordinal}
                </span>
                <div className="truncate font-mono text-[11px] text-neutral-500" title={subagent.id}>
                  {subagent.id} · {subagent.mode}
                </div>
              </div>
              <div className="text-right">
                <div className={subagent.status === "failed" ? "text-red-600" : "text-neutral-500"}>
                  {STATUS_LABEL[subagent.status]}
                </div>
                {subagent.stop_reason !== null && (
                  <div className="font-mono text-[11px] text-neutral-500">{subagent.stop_reason}</div>
                )}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
