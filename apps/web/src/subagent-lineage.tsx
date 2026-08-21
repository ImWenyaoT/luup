import { ROLE_LABEL, type Snapshot } from "./types";

const STATUS_LABEL = {
  running: "进行中",
  completed: "已完成",
  failed: "失败",
} as const;

export function SubagentLineage({ snapshot }: { snapshot: Snapshot }) {
  return (
    <section className="space-y-2" aria-labelledby="subagent-lineage-title">
      <h2 id="subagent-lineage-title" className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
        Subagents · {snapshot.subagents.length}
      </h2>
      <div className="border-l-2 border-l-foreground/20 pl-3">
        <div className="flex flex-wrap items-baseline gap-x-2 text-xs">
          <span className="font-medium">控制面</span>
          <span className="font-mono text-[11px] text-muted-foreground">{snapshot.id}</span>
        </div>
        <ol className="mt-2 space-y-1">
          {snapshot.subagents.map((subagent) => (
            <li key={subagent.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 border-l pl-3 text-xs">
              <div className="min-w-0">
                <span className="font-medium">{ROLE_LABEL[subagent.role]}</span>
                <span className="ml-2 font-mono text-[11px] text-muted-foreground">
                  {subagent.role} #{subagent.ordinal}
                </span>
                <div className="truncate font-mono text-[11px] text-muted-foreground" title={subagent.id}>
                  {subagent.id} · {subagent.mode}
                </div>
              </div>
              <div className="text-right">
                <div className={subagent.status === "failed" ? "text-destructive" : "text-muted-foreground"}>
                  {STATUS_LABEL[subagent.status]}
                </div>
                {subagent.stop_reason !== null && (
                  <div className="font-mono text-[11px] text-muted-foreground">{subagent.stop_reason}</div>
                )}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
