import { fmtDur, fmtTime } from "@/lib/format";
import { NODE_BY_KEY } from "@/lib/nodes";
import type { NodeState, SpineNode } from "@/lib/types";

const STATE_TEXT: Record<NodeState, string> = {
  done: "已产出",
  active: "进行中",
  rejected: "被打回",
  pending: "待执行",
};

/**
 * reasoning spine 是详情页的主轴，不是装饰：它把「哪一步走完了、花了多久、被打回几次」
 * 这三件评审真正关心的事放在同一根轨道上。方块而非圆点——仪表感来自直角。
 */
export function Spine({ nodes }: { nodes: SpineNode[] }) {
  return (
    <ol className="relative">
      <div className="spine-rail absolute top-1 bottom-1 left-1" aria-hidden />
      {nodes.map((n) => (
        <li key={n.key} className="relative pb-4 pl-6">
          <div className="spine-dot absolute top-1.5 left-0" data-state={n.state} aria-hidden />
          <a
            href={`#tab-${NODE_BY_KEY[n.key].tabId}`}
            className="block hover:text-accent"
            aria-label={`跳到 ${n.label} 工件`}
          >
            <div className="flex items-baseline gap-2">
              <span className="text-accent">{n.mark}</span>
              <span className="text-[13px]">{n.label}</span>
              <span className="text-[11px] text-faint">{STATE_TEXT[n.state]}</span>
              {n.rejects > 0 ? <span className="text-[11px] text-danger">×{n.rejects} 打回</span> : null}
            </div>
            <div className="text-[11px] text-faint">{n.artifact}</div>
            <div className="text-[11px] text-muted">
              {fmtTime(n.at)}
              {n.elapsedSec !== null ? <span className="text-faint"> · +{fmtDur(n.elapsedSec)}</span> : null}
            </div>
          </a>
        </li>
      ))}
    </ol>
  );
}

/** 列表里的四格/五格缩略轨道，横向。 */
export function MiniSpine({ states, marks }: { states: NodeState[]; marks: string[] }) {
  return (
    <span className="inline-flex items-center gap-1" title={states.join(" → ")}>
      {states.map((s, i) => (
        <span key={i} className="spine-dot" data-state={s} title={`${marks[i]}: ${STATE_TEXT[s]}`} />
      ))}
    </span>
  );
}
