import type { NodeState, RunNodes, RunStatus, SpineNode } from "./types"

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
  rejected: "未产出",
  pending: "待执行",
}
const LEGACY_NODES: Record<
  string,
  Omit<SpineNode, "state" | "at" | "elapsedSec" | "rejects">
> = {
  literature: {
    key: "literature",
    mark: "L",
    label: "文献",
    artifact: "evidence.md",
    tabId: "evidence",
  },
  hypothesis: {
    key: "hypothesis",
    mark: "H",
    label: "假设",
    artifact: "hypotheses.md",
    tabId: "hypotheses",
  },
  critique: {
    key: "critique",
    mark: "C",
    label: "批判",
    artifact: "critique.json",
    tabId: "critique",
  },
  proposal: {
    key: "proposal",
    mark: "W",
    label: "计划",
    artifact: "proposal.md",
    tabId: "proposal",
  },
  verify: {
    key: "verify",
    mark: "✓",
    label: "验收",
    artifact: "verification-report.md",
    tabId: "verification",
  },
}

const PRO_NODES: Record<
  string,
  Omit<SpineNode, "state" | "at" | "elapsedSec" | "rejects">
> = {
  scientist: {
    key: "scientist",
    mark: "S",
    label: "Scientist",
    artifact: "evidence.md · proposal.json",
    tabId: "evidence",
  },
  reviewer: {
    key: "reviewer",
    mark: "R",
    label: "Reviewer",
    artifact: "review.json",
    tabId: "review",
  },
  verify: {
    key: "verify",
    mark: "✓",
    label: "Verify",
    artifact: "verification.json",
    tabId: "verification",
  },
}

/**
 * 兼容边界只在这里：新 run 直接渲染 API 传来的有序数组；旧映射才回退 L/H/C/W。
 * 因此新 Harness 加节点时不需要先改前端类型或列表列名。
 */
export function displayNodes(nodes: RunNodes): SpineNode[] {
  if (Array.isArray(nodes)) return nodes
  const legacy = Object.keys(nodes).some((key) => key in LEGACY_NODES)
  const known = legacy ? LEGACY_NODES : PRO_NODES
  const order = legacy
    ? ["literature", "hypothesis", "critique", "proposal"]
    : ["scientist", "reviewer", "verify"]
  const keys = [
    ...order.filter((key) => key in nodes),
    ...Object.keys(nodes).filter((key) => !order.includes(key)),
  ]
  return keys.map((key) => {
    const base = known[key] ?? {
      key,
      mark: key.slice(0, 1).toUpperCase(),
      label: key,
      artifact: "—",
    }
    return {
      ...base,
      state: nodes[key],
      at: null,
      elapsedSec: null,
      rejects: 0,
    }
  })
}

/** Scientist / Reviewer / Verify 有稳定的工件阅读入口，旧节点仅作兼容映射。 */
export function tabForNode(node: SpineNode): string | undefined {
  if (node.tabId) return node.tabId
  return PRO_NODES[node.key]?.tabId ?? LEGACY_NODES[node.key]?.tabId
}
