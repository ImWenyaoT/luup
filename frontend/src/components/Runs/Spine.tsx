import { fmtDur, fmtTime, stateLabel } from "@/format"
import { cn } from "@/lib/utils"
import type { NodeState, SpineNode } from "@/types"

/**
 * 状态灯是实色点，不加光晕；每个灯旁边都有文字状态，颜色不单独承载信息。
 */
const DOT_CLASS: Record<NodeState, string> = {
  done: "bg-primary",
  active: "bg-primary animate-pulse motion-reduce:animate-none",
  pending: "border border-muted-foreground/45 bg-transparent",
}

const SEGMENT_CLASS: Record<NodeState, string> = {
  done: "bg-primary",
  active: "bg-primary/45",
  pending: "bg-border",
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
        "inline-block size-2 shrink-0 rounded-[1px]",
        DOT_CLASS[state],
        className,
      )}
    />
  )
}

/** 表格与列表里的压缩形态：一格一节点，读的是「走到哪一步」。 */
export function MiniSpine({ nodes }: { nodes: SpineNode[] }) {
  return (
    <span
      className="inline-flex items-center gap-0.5 align-middle"
      title={nodes
        .map((node) => `${node.label}: ${stateLabel[node.state]}`)
        .join(" → ")}
    >
      {nodes.map((node) => (
        <i
          key={node.key}
          className={cn("h-3 w-1.5 rounded-[1px]", SEGMENT_CLASS[node.state])}
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
  const last = nodes.length - 1
  return (
    <aside className={cn("flex flex-col gap-3", className)} data-testid="spine">
      <h3 className="text-[13px] font-medium text-muted-foreground">
        reasoning spine
      </h3>
      <ol className="flex flex-col">
        {nodes.map((node, index) => (
          <li
            key={node.key}
            className="grid grid-cols-[8px_minmax(0,1fr)] gap-x-3"
          >
            <div className="relative flex justify-center">
              {index > 0 ? (
                <span className="absolute top-0 left-1/2 h-2.5 w-px -translate-x-1/2 bg-muted-foreground/30" />
              ) : null}
              {index < last ? (
                <span className="absolute top-4 bottom-0 left-1/2 w-px -translate-x-1/2 bg-muted-foreground/30" />
              ) : null}
              <Dot state={node.state} className="relative mt-2" />
            </div>
            <button
              type="button"
              data-testid="spine-node"
              onClick={() => select(node)}
              className="-mx-2 flex flex-col gap-0.5 rounded-sm px-2 py-1.5 text-left transition-colors hover:bg-accent/60 active:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
            >
              <span className="flex items-baseline gap-2">
                <span className="font-mono text-xs text-muted-foreground">
                  {node.mark}
                </span>
                <span className="text-[13px] font-medium">{node.label}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {stateLabel[node.state]}
                </span>
              </span>
              <span className="font-mono text-xs leading-relaxed break-all text-muted-foreground">
                {node.artifact}
              </span>
              <span className="text-xs text-muted-foreground">
                <span className="font-mono">{fmtTime(node.at)}</span>
                {node.elapsedSec ? (
                  <span className="tabular-nums">
                    {" "}
                    · +{fmtDur(node.elapsedSec)}
                  </span>
                ) : null}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </aside>
  )
}
