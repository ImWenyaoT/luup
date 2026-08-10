/** 后端拓扑由 Harness 决定；旧 L/H/C/W 仅是历史 run 的一种形状。 */
export type NodeKey = string
export type NodeState = "done" | "active" | "rejected" | "pending"
export type RunStatus = "working" | "passed" | "failed"

export type SpineNode = {
  key: NodeKey
  mark: string
  label: string
  artifact: string
  state: NodeState
  at: string | null
  elapsedSec: number | null
  rejects: number
  /** API 可选提供；前端不从节点名猜 tab。 */
  tabId?: string
}

/** 新 API 返回按 Harness 顺序的数组；旧 API 是 key → state 映射。 */
export type RunNodes = SpineNode[] | Record<string, NodeState>

export type VerdictCheck = { criterion: string; reason: string; pass?: boolean }
export type Verdict = {
  file: string
  node: string
  round: number
  verdict: "pass" | "reject"
  checks: VerdictCheck[]
  rework: string | null
  rejectedRaw: string | null
}
export type VerifyCheck = {
  id: string
  group: string
  pass: boolean
  detail: string
}
export type VerifyReport = {
  result: string
  pass: boolean
  checks: VerifyCheck[]
}
export type Paper = {
  arxivId: string
  year: string
  title: string
  oneline: string
  file: string
}
export type Reference = { arxivId: string }
export type Proposal = { paperTitle: string; references: Reference[] }

export type RunSummary = {
  id: string
  startedAt: string
  finishedAt: string | null
  status: RunStatus
  question: string
  domain: string | null
  science125Id: number | null
  refs: number | null
  verify: "pass" | "fail" | null
  durationSec: number | null
  nodes: RunNodes
}

export type RunStatusView = {
  id: string
  status: RunStatus
  updatedAt: string
  nodes: SpineNode[]
  verdicts: Verdict[]
  logTail: string[]
}
export type RunDetail = RunStatusView & {
  questionText: string
  domain: string | null
  science125Id: number | null
  startedAt: string
  finishedAt: string | null
  durationSec: number | null
  proposal: Proposal | null
  proposalRejected: string | null
  verify: VerifyReport | null
  papers: Paper[]
  failedText: string | null
  artifactNames: string[]
}

export type Science125Question = { id: number; question: string }
export type Science125Domain = {
  domain: string
  count: number
  questions: Science125Question[]
}
export type Science125 = {
  source: string
  retrievedAt: string
  total: number
  domains: Science125Domain[]
}
export type ApiError = {
  error: string
  code: string
  activeRunId?: string | null
}
