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
/**
 * 映射形态下前端还需要自己知道的：顺序、mark、label、tabId。
 * 工件名不在其中——那是 Harness 的知识，由 API 随有序数组下发；前端存一份只会过期
 * （历史上旧表存过 proposal.md 而后端主名是 proposal.json，
 * 新表存过 verification.json 而后端主名是 verification-report.md）。
 */
type NodeIdentity = Omit<
  SpineNode,
  "state" | "at" | "elapsedSec" | "rejects" | "artifact"
>

/** 旧拓扑的顺序；同时是「判新旧」的判据——只有这四个是旧表独有的。 */
const LEGACY_ORDER = ["literature", "hypothesis", "critique", "proposal"]
const PRO_ORDER = ["scientist", "reviewer", "verify"]

const LEGACY_NODES: Record<string, NodeIdentity> = {
  literature: {
    key: "literature",
    mark: "L",
    label: "文献",
    tabId: "evidence",
  },
  hypothesis: {
    key: "hypothesis",
    mark: "H",
    label: "假设",
    tabId: "hypotheses",
  },
  critique: { key: "critique", mark: "C", label: "批判", tabId: "critique" },
  proposal: { key: "proposal", mark: "W", label: "计划", tabId: "proposal" },
  verify: { key: "verify", mark: "✓", label: "验收", tabId: "verification" },
}

const PRO_NODES: Record<string, NodeIdentity> = {
  scientist: {
    key: "scientist",
    mark: "S",
    label: "Scientist",
    tabId: "evidence",
  },
  reviewer: { key: "reviewer", mark: "R", label: "Reviewer", tabId: "review" },
  verify: { key: "verify", mark: "✓", label: "Verify", tabId: "verification" },
}

/**
 * 兼容边界只在这里：新 run 直接渲染 API 传来的有序数组；旧映射才回退 L/H/C/W。
 * 因此新 Harness 加节点时不需要先改前端类型或列表列名。
 *
 * 判新旧只能看 LEGACY_ORDER 里那四个旧表独有的 key：`verify` 两张表都有，
 * 拿「命中任一旧表 key」去判，任何含 verify 的 Pro 映射都会被翻成旧拓扑。
 */
export function displayNodes(nodes: RunNodes): SpineNode[] {
  if (Array.isArray(nodes)) return nodes
  const legacy = Object.keys(nodes).some((key) => LEGACY_ORDER.includes(key))
  const known = legacy ? LEGACY_NODES : PRO_NODES
  const order = legacy ? LEGACY_ORDER : PRO_ORDER
  const keys = [
    ...order.filter((key) => key in nodes),
    ...Object.keys(nodes).filter((key) => !order.includes(key)),
  ]
  return keys.map((key) => {
    // 查表可能落空（Harness 新增的节点），所以按 Partial 读。占位字段写在展开之前
    // 而不是之后，落空时降级形态就自动留住，不需要再写一遍 fallback 对象。
    const identity: Partial<NodeIdentity> = known[key] ?? {}
    return {
      key,
      mark: key.slice(0, 1).toUpperCase(),
      label: key,
      artifact: "—",
      ...identity,
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
