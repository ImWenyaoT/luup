import { displayNodes, fmtDur, fmtTime, stateLabel } from "@/format"
import { cn } from "@/lib/utils"
import type { NodeState, RunNodes, SpineNode } from "@/types"

const DOT_CLASS: Record<NodeState, string> = {
  done: "bg-primary",
  active:
    "border-[1.5px] border-primary animate-pulse motion-reduce:animate-none",
  pending: "border-[1.5px] border-muted-foreground/50",
  // 缺角方块：状态形状本身可读，不依赖颜色。
  rejected:
    "border-[1.5px] border-destructive [clip-path:polygon(0_0,62%_0,100%_38%,100%_100%,0_100%)]",
}

export function Dot({
  state,
  title,
  className,
}: {
  state: NodeState
  title?: string
  className?: string
}) {
  return (
    <i
      title={title}
      className={cn(
        "inline-block size-[9px] shrink-0",
        DOT_CLASS[state],
        className,
      )}
    />
  )
}

export function MiniSpine({ nodes }: { nodes: RunNodes }) {
  const visible = displayNodes(nodes)
  return (
    <span
      className="inline-flex gap-1"
      title={visible.map((node) => node.label).join(" → ")}
    >
      {visible.map((node) => (
        <Dot
          key={node.key}
          state={node.state}
          title={`${node.label}: ${stateLabel[node.state]}`}
        />
      ))}
    </span>
  )
}

export function Spine({
  nodes,
  select,
  className,
}: {
  nodes: SpineNode[]
  select: (node: SpineNode) => void
  className?: string
}) {
  return (
    <aside className={className}>
      <div className="mb-2 text-[11px] uppercase tracking-wider text-muted-foreground">
        reasoning spine
      </div>
      <ol className="border-l-2 border-primary">
        {nodes.map((node) => (
          <li key={node.key} className="relative pb-4 pl-5">
            <Dot
              state={node.state}
              className="absolute -left-[6px] top-1.5 ring-3 ring-background"
            />
            <button
              type="button"
              className="text-left"
              onClick={() => select(node)}
            >
              <b className="font-normal text-primary">{node.mark}</b>{" "}
              {node.label}{" "}
              <small className="block text-[11px] text-muted-foreground">
                {stateLabel[node.state]}
                {node.rejects ? ` · 打回 ${node.rejects} 次` : ""}
              </small>
              <small className="block text-[11px] text-muted-foreground">
                {node.artifact} · {fmtTime(node.at)}
                {node.elapsedSec ? ` · +${fmtDur(node.elapsedSec)}` : ""}
              </small>
            </button>
          </li>
        ))}
      </ol>
    </aside>
  )
}
