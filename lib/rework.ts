/**
 * **返工预算 —— 「这个节点还能不能再来一轮」的全系统唯一 owner。**
 *
 * 收编前，`lib/agents/master.md` 的三条硬规格（每节点 ≤3 轮 / 同节点连续 3 次 reject
 * 熔断 / 格式重试 ≤1 次且不占语义轮）**只存在于提示词里**：由 master 自己数轮次、自己
 * 判熔断。eval#1 的事故就是它数错了 —— 模型的算术不是防线。这个文件把判定下沉成代码，
 * 执行点在 `lib/agents/artifacts.ts` 的 `verdicts/` 写入路径：第 4 轮直接**拒写**。
 * fail-closed：模型数错也过不去。
 *
 * ## 计数器就是 verdicts/ 目录，没有第二份状态
 *
 * 一个节点用了几轮 = `verdicts/` 下属于它的 verdict 文件数；格式重试了几次 =
 * `<name>.json.rejected.json` 草稿数（`writeArtifact` 契约校验失败时留的）。因此本模块
 * 不需要任何计数文件、不需要进程内状态，崩溃重启后预算照样算得出来。
 *
 * 解析口径与 `lib/phase.ts` 的 `parseVerdicts` 是同一份（`verdictFact` / `isVerdictFile`
 * / `nodeFromFile` / `roundFromFile` 都在这里定义，phase 侧 import 使用）—— 两处各抄一份
 * 正则，就等于给「第几轮」造两个不会报错的答案。
 *
 * ## interface 就是 test surface（与 lib/runOutcome.ts 同构）
 *
 * `reworkBudget()` / `admitVerdict()` 是纯函数：入参只有一份 `ReworkEvidence`，不读盘、
 * 不读环境变量。读盘的是 `readVerdictEvidence(dir)` 这一个 adapter。
 *
 * ## governingCap：哪条上限在管事必须显式
 *
 * 拒写的返回里带 `governingCap`（`node.maxRounds` / `node.circuitBreaker`）与 `remaining`，
 * master 据此知道自己撞的是"轮数用完"还是"连续被拒到熔断"，而不是收到一句"不许写"。
 *
 * ## 为什么格式重试不参与拒写
 *
 * 格式重试的成因是 master 自己写坏了 verdict JSON，`writeArtifact` 已经拒写并留下
 * `.rejected.json` 草稿。再对它加一条"重试超限就永久拒写"，只会让该节点连一份合法
 * verdict 都落不下去 —— 证据链断在这里比多试一次贵得多。所以 `formatRetries` 只**报数**
 * （让 master 看见自己在原地打转），语义轮由文件数独立计数，两者天然不互相消耗。
 *
 * ## 已知洞（有意接受，别悄悄补）
 *
 * 覆写**同一个**已存在的 verdict 文件不算新一轮 —— 这是为了容忍瞬时失败重放（写成功了
 * 但调用方没看到返回，原样重写一次）。代价是：一个坚持把每轮都写成 `-r1.json` 的 master
 * 可以无限重试。它换来的是自己把前几轮证据覆盖掉，trace 上只剩一轮，得不偿失；而按文件名
 * 的轮次上界（`round > maxRounds` 直接拒）挡住了"文件数没到 3 但轮号已经 4"的那一半。
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { NODES } from "./nodes.ts";
import { readJsonFile } from "./runOutcome.ts";
import type { NodeKey } from "./types.ts";

/* ------------------------------------------------------------------ */
/* 上限                                                                 */
/* ------------------------------------------------------------------ */

/** master 会为之落 verdict 的节点：DAG 四节点（verify 是跑完之后的确定性验收，无返工可言）。 */
export type ReworkNode = Exclude<NodeKey, "verify">;

export const REWORK_NODES = NODES.filter((n) => n.key !== "verify").map((n) => n.key) as ReworkNode[];

/**
 * 硬上限。数值与 `lib/agents/master.md`「循环控制」一致，但**判定在这里**，
 * 提示词只负责告诉模型撞上之后该干什么。
 */
export const REWORK_CAPS = {
  /** 每节点最多 3 轮语义 verdict（第 1 次派工 + 至多 2 次返工）。 */
  maxRounds: 3,
  /** 同节点连续 3 次 reject → 熔断，不做第 4 次重试。 */
  consecutiveRejects: 3,
  /** 格式重试的告警线；**不参与拒写**（理由见文件头）。 */
  formatRetries: 1,
} as const;

/** 哪条上限在管事。拒写时原样回给模型。 */
export type ReworkCap = "node.maxRounds" | "node.circuitBreaker";

/* ------------------------------------------------------------------ */
/* 解析：verdicts/ 目录的文件名与内容（phase.ts 复用同一份）                */
/* ------------------------------------------------------------------ */

/** schema 打回草稿：`<name>.json.rejected.json`（`lib/agents/artifacts.ts` 拒写时留的证据）。 */
export const isRejectedDraft = (name: string): boolean => name.endsWith(".rejected.json");

/** 已落盘的 verdict 文件（打回草稿不算）。 */
export const isVerdictFile = (name: string): boolean => name.endsWith(".json") && !isRejectedDraft(name);

/** `<node>-r<round>.json` → 节点名；解析不出就退回整个基名（与 phase 的旧行为一致）。 */
export const nodeFromFile = (file: string): string => file.split("-")[0] ?? file;

/** `<node>-r<round>.json` → 轮次；文件名里没有 `-r<n>` 时为 null。 */
export function roundFromFile(file: string): number | null {
  const m = /-r(\d+)/.exec(file);
  return m?.[1] === undefined ? null : Number(m[1]);
}

/** 计数只需要四个字段：谁的、第几轮、判成什么、落在哪个文件。 */
export type VerdictFact = { file: string; node: string; round: number; verdict: string };

/**
 * 一份 verdict 原文 → 计数事实。内容里的 `node`/`round` 优先，缺了才退回文件名。
 * `lib/phase.ts` 的 `parseVerdicts` 也走它 —— 两处的「第几轮」永远是同一个答案。
 */
export function verdictFact(file: string, raw: Record<string, unknown> | null): VerdictFact {
  return {
    file,
    node: typeof raw?.node === "string" ? raw.node : nodeFromFile(file),
    round: typeof raw?.round === "number" ? raw.round : (roundFromFile(file) ?? 1),
    verdict: typeof raw?.verdict === "string" ? raw.verdict : "unknown",
  };
}

/* ------------------------------------------------------------------ */
/* 证据                                                                 */
/* ------------------------------------------------------------------ */

/**
 * 一次 run 的返工计数输入。**只装事实，不装结论**（与 `RunEvidence` 同款）。
 *
 * `verdicts` 每条 = 一个已落盘的 verdict 文件；`drafts` 是 `.rejected.json` 草稿名
 * （它们没有可信内容，只能按文件名归属节点）。
 */
export type ReworkEvidence = { verdicts: VerdictFact[]; drafts: string[] };

/** 从 `runs/<ts>/verdicts/` 取证。目录不存在 = 预算全满，不是错误。 */
export function readVerdictEvidence(verdictsDir: string): ReworkEvidence {
  let names: string[];
  try {
    names = readdirSync(verdictsDir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name);
  } catch {
    return { verdicts: [], drafts: [] };
  }
  const verdicts: VerdictFact[] = [];
  const drafts: string[] = [];
  for (const name of names.sort()) {
    if (isRejectedDraft(name)) drafts.push(name);
    else if (isVerdictFile(name)) verdicts.push(verdictFact(name, readJsonFile(join(verdictsDir, name))));
  }
  return { verdicts, drafts };
}

/* ------------------------------------------------------------------ */
/* 判定                                                                 */
/* ------------------------------------------------------------------ */

type BudgetCore = {
  node: ReworkNode;
  /** 已落盘的语义轮数 = 该节点的 verdict 文件数。 */
  semanticRounds: number;
  /** 该节点的 schema 打回草稿数。**不消耗语义轮**，只是「在原地打转」的告警。 */
  formatRetries: number;
  /** 还能再开几轮（`maxRounds - semanticRounds`，不为负）。 */
  remaining: number;
  /** 末尾连续多少轮不是 pass（熔断判据）。 */
  consecutiveRejects: number;
};

/** 一个节点的预算。`exhausted` 必带 `governingCap` —— 撞了哪条上限不许含糊。 */
export type NodeBudget =
  | (BudgetCore & { verdict: "allow" })
  | (BudgetCore & { verdict: "exhausted"; governingCap: ReworkCap; error: string });

export type ReworkBudget = Record<ReworkNode, NodeBudget>;

const circuitError = (node: string, n: number) =>
  `${node} 已连续 ${n} 次 reject（熔断线 ${REWORK_CAPS.consecutiveRejects}）：不做第 ${n + 1} 次重试。` +
  `该节点到此为止 —— 如实写 FAILED.md（差哪几项判据、每项证据、最近一版产物路径），禁止降标准放行。`;

const roundsError = (node: string, used: number) =>
  `${node} 的轮数预算已用尽（已落盘 ${used}/${REWORK_CAPS.maxRounds} 轮，remaining=0）：不许开第 ${used + 1} 轮。` +
  `该节点到此为止 —— 如实写 FAILED.md（差哪几项判据、每项证据、最近一版产物路径），禁止降标准放行。`;

/** 一份证据 → 四个节点各自的预算。没落过 verdict 的节点也在表里（余额满）。 */
export function reworkBudget(e: ReworkEvidence): ReworkBudget {
  const byNode = new Map<string, VerdictFact[]>();
  for (const v of e.verdicts) {
    const list = byNode.get(v.node);
    if (list) list.push(v);
    else byNode.set(v.node, [v]);
  }
  const draftsByNode = new Map<string, number>();
  for (const d of e.drafts) {
    const node = nodeFromFile(d);
    draftsByNode.set(node, (draftsByNode.get(node) ?? 0) + 1);
  }

  const out = {} as ReworkBudget;
  for (const node of REWORK_NODES) {
    const own = [...(byNode.get(node) ?? [])].sort((a, b) => a.round - b.round || a.file.localeCompare(b.file));
    let consecutiveRejects = 0;
    for (let i = own.length - 1; i >= 0; i--) {
      if (own[i]?.verdict === "pass") break;
      consecutiveRejects++;
    }
    const core: BudgetCore = {
      node,
      semanticRounds: own.length,
      formatRetries: draftsByNode.get(node) ?? 0,
      remaining: Math.max(0, REWORK_CAPS.maxRounds - own.length),
      consecutiveRejects,
    };
    out[node] =
      consecutiveRejects >= REWORK_CAPS.consecutiveRejects
        ? { ...core, verdict: "exhausted", governingCap: "node.circuitBreaker", error: circuitError(node, consecutiveRejects) }
        : core.remaining === 0
          ? { ...core, verdict: "exhausted", governingCap: "node.maxRounds", error: roundsError(node, core.semanticRounds) }
          : { ...core, verdict: "allow" };
  }
  return out;
}

/** 一次 verdict 写入的准入判定。`ok:false` = `writeArtifact` 必须拒写。 */
export type ReworkAdmission =
  | { ok: true; budget: NodeBudget; reason: "new-round" | "same-round-rewrite" }
  | { ok: false; budget: NodeBudget; governingCap: ReworkCap; error: string };

/**
 * 准入：这份 verdict 还能不能落盘。
 *
 * 放行只有两条路：
 *  1. 该文件已经在盘上 → 覆写同一轮，不新增轮次（瞬时失败重放的容忍面，见文件头「已知洞」）。
 *  2. 节点预算 allow，且文件名里的轮号没有超过 `maxRounds`（后者挡住"文件数还没到 3、
 *     轮号已经 r4"的改名绕行）。
 * 其余一律拒，且必须说清是哪条上限在管事。
 */
export function admitVerdict(e: ReworkEvidence, input: { node: ReworkNode; file: string }): ReworkAdmission {
  const budget = reworkBudget(e)[input.node];
  const round = roundFromFile(input.file);
  const overNamedRound = round !== null && round > REWORK_CAPS.maxRounds;

  if (!overNamedRound && e.verdicts.some((v) => v.file === input.file)) {
    return { ok: true, budget, reason: "same-round-rewrite" };
  }
  if (!overNamedRound && budget.verdict === "allow") {
    return { ok: true, budget, reason: "new-round" };
  }
  // 拒。管事的上限以**节点自己的状态**为准（连续被拒到熔断比"轮号写大了"更该被听见）；
  // 只有节点其实还有余额、纯粹是轮号越界（改名绕行）时才由 maxRounds 出面。
  return budget.verdict === "exhausted"
    ? { ok: false, budget, governingCap: budget.governingCap, error: budget.error }
    : {
        ok: false,
        budget,
        governingCap: "node.maxRounds",
        error: `${input.file}：轮号 r${round} 超出每节点 ${REWORK_CAPS.maxRounds} 轮的上限。${roundsError(input.node, budget.semanticRounds)}`,
      };
}
