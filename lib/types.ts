export type RunStatus = "running" | "passed" | "completed" | "failed" | "stale";
export type NodeKey = "literature" | "hypothesis" | "critique" | "proposal" | "verify";
export type NodeState = "done" | "active" | "rejected" | "pending";

export type SpineNode = {
  key: NodeKey;
  /** 单字母轨道标记：L H C W ✓ */
  mark: string;
  label: string;
  artifact: string;
  state: NodeState;
  /** 工件 mtime（ISO），未产出为 null */
  at: string | null;
  /** 相对上一节点的耗时（秒），首节点或缺失为 null */
  elapsedSec: number | null;
  /** 该节点被 master 打回的次数（verdict!=="pass" + schema 打回文件） */
  rejects: number;
};

export type VerdictCheck = { criterion: string; pass: boolean | null; reason: string };

export type Verdict = {
  /** verdicts/ 下的文件名，如 literature-r1.json */
  file: string;
  node: string;
  round: number;
  verdict: string;
  checks: VerdictCheck[];
  rework: string | null;
  /** 同名 .rejected.json 兄弟文件的原文（schema 打回） */
  rejectedRaw: string | null;
};

export type VerifyCheck = { id: string; group: string; pass: boolean; detail: string };
export type VerifyReport = { result: string; pass: boolean; checks: VerifyCheck[] };

export type Paper = { arxivId: string; year: string; title: string; oneline: string; file: string };

/**
 * 交付物契约不在这里定义 —— 它由 `agent/lib/contracts.ts` 的 zod schema 单点约束，
 * 前端只是它的读者。手抄一份等于给自己造一个不会报错的分叉：上一版这里就多出过一个
 * schema 里根本没有的 `risks?: string`，页面照着它渲染，永远渲染不出东西。
 * 纯类型转出（编译期擦除），前端不会因此把 zod 打进 bundle。
 */
import type { Proposal, Reference } from "#lib/contracts.ts";
export type { Proposal, Reference };

export type RunSummary = {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  status: RunStatus;
  /** 首行截断 160 */
  question: string;
  domain: string | null;
  science125Id: number | null;
  refs: number | null;
  verify: "pass" | "fail" | null;
  durationSec: number | null;
  nodes: Record<Exclude<NodeKey, "verify">, NodeState>;
};

export type RunStatusView = {
  id: string;
  status: RunStatus;
  updatedAt: string;
  nodes: SpineNode[];
  verdicts: Verdict[];
  /** console.log 末 40 行；console.log 不进 ?artifact= 白名单（可能含环境噪声） */
  logTail: string[];
};

export type RunDetail = RunStatusView & {
  questionText: string;
  domain: string | null;
  science125Id: number | null;
  startedAt: string;
  finishedAt: string | null;
  durationSec: number | null;
  proposal: Proposal | null;
  proposalRejected: string | null;
  verify: VerifyReport | null;
  papers: Paper[];
  failedText: string | null;
  /**
   * 可 ?artifact= 取用的工件全集（读盘算出，不是正则放行）。
   * 「某个工件在不在」也读它 —— 上一版另有一张同源的 artifacts 布尔表，两份一样的东西。
   */
  artifactNames: string[];
};

export type Science125Question = { id: number; question: string };
export type Science125Domain = { domain: string; count: number; questions: Science125Question[] };
export type Science125 = {
  source: string;
  retrievedAt: string;
  total: number;
  domains: Science125Domain[];
};

export type ApiError = { error: string; code: string };
