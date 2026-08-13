import type { NodeState, RunStatus, SpineNode } from "./types"

const p2 = (n: number) => String(n).padStart(2, "0")
export const fmtTime = (value: string | null) => {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime()) || date.getTime() === 0) return "—"
  return `${p2(date.getUTCMonth() + 1)}-${p2(date.getUTCDate())} ${p2(date.getUTCHours())}:${p2(date.getUTCMinutes())}:${p2(date.getUTCSeconds())}Z`
}
export const fmtDur = (seconds: number | null) => {
  if (seconds === null || seconds <= 0) return "—"
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return minutes < 60
    ? `${minutes}m ${p2(seconds % 60)}s`
    : `${Math.floor(minutes / 60)}h ${p2(minutes % 60)}m`
}
export const statusLabel: Record<RunStatus, string> = {
  working: "运行中",
  passed: "通过验收",
  failed: "失败",
}
export const stateLabel: Record<NodeState, string> = {
  done: "已产出",
  active: "进行中",
  pending: "待执行",
}

/**
 * 节点 key → 工件阅读入口。这是前端对拓扑仅有的一份知识，且只是「点哪一格看哪一页」；
 * 顺序、mark、label、工件名全部随 API 的有序数组下发——前端各存一份只会过期
 * （历史上旧表存过 proposal.md 而后端主名是 proposal.json）。
 */
const NODE_TABS = new Map([
  ["scientist", "evidence"],
  ["reviewer", "review"],
  ["verify", "verification"],
])

/**
 * API 显式给的 tabId 优先；否则按 key 查表，未知节点不给 tab。
 * 查表用 Map 而不是普通对象：`{}["constructor"]` 会命中 Object.prototype 的继承属性，
 * 把一个函数当成 tab 名返回出去。
 */
export function tabForNode(node: SpineNode): string | undefined {
  if (node.tabId) return node.tabId
  return NODE_TABS.get(node.key)
}
