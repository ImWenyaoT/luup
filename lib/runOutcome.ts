/**
 * **run outcome —— 一次 run 的终态判定，全系统唯一 owner。**
 *
 * 领域词汇（CONTEXT.md）：run outcome = phase（进行到哪）+ terminal（是否终结）
 * + deliverable（是否可交付 = 通过独立验收）。
 *
 * 收编前这件事有六份互不引用的手写实现：web 的 deriveStatus、runs 索引的 SETTLED、
 * run-batch 的续跑扫描、retention 的终态凭据、rebuild-memory 的三态、run.ts 的退出码。
 * 它们对同一个目录会给出不同结论 —— 最典型的是「续跑要不要跳过这题」与「仪表台显不显示
 * passed」曾经是两套判据，同一个 run 可以既是 passed 又要被重跑。
 *
 * ## interface 就是 test surface
 *
 * `runOutcome()` 是纯函数：入参只有一份 `RunEvidence`，函数体里不读盘、不读锁、不读
 * 环境变量。「谁在跑」这类进程外事实必须由调用方作为显式入参带进来（web 的 running
 * 判定因此留在 deriveStatus 里，见 lib/phase.ts），否则一个终态判定就没法在测试里
 * 被完整摆出来。
 *
 * 证据有两个构造器 —— `readRunEvidence()`（目录，脚本侧）与 `evidenceFromScan()`
 * （lib/phase.ts，web 侧已经扫过一遍目录）。两者对同一个目录必须给出同一份证据，
 * 这条等价性由 scripts/selftest-outcome.ts 逐目录断言。
 *
 * ## 判定顺序（不要重排）
 *
 *   FAILED.md → failed        如实报了失败，压过一切（哪怕早轮已经渲染过 proposal）
 *   proposal.md → verified / rendered   报告 ALL PASS 且没有失败退出码才是 verified
 *   非零退出码 → failed
 *   否则 → unsettled          在跑，或中途死亡（web 显示 stale）
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { stampToMs } from "./runId.ts";

/* ------------------------------------------------------------------ */
/* 「通过」的判据：写出端与读入端同一份                                    */
/* ------------------------------------------------------------------ */

/**
 * verification-report.md 头部的结论行前缀。写出端（scripts/verify-proposal.ts）
 * 与所有读入端都从这里取。
 */
export const RESULT_PREFIX = "结果: ";
const ALL_PASS_TEXT = "ALL PASS";

/**
 * 只认头部那一行 `结果: ALL PASS`，不做全文 includes——说明列里嵌的是 LLM 写的
 * 标题/作者原文，全文匹配会把一份失败报告读成通过。
 */
const ALL_PASS = new RegExp(`${RESULT_PREFIX.trimEnd()}\\s*${ALL_PASS_TEXT}`);

/** 写出端：failed=0 才是 ALL PASS。 */
export function resultLine(failedCount: number, totalCount: number): string {
  return `${RESULT_PREFIX}${failedCount === 0 ? ALL_PASS_TEXT : `${failedCount}/${totalCount} FAILED`}`;
}

/** 读入端：一份报告原文是否判通过。报告缺失一律不算通过。 */
export function isAllPass(report: string | null | undefined): boolean {
  return typeof report === "string" && ALL_PASS.test(report);
}

/* ------------------------------------------------------------------ */
/* 证据                                                                 */
/* ------------------------------------------------------------------ */

/** meta.json（scripts/run.ts 写的断点续跑索引）里判定用得上的部分，时间已解析成 ms。 */
export type MetaEvidence = {
  questionId: number | null;
  startedMs: number | null;
  finishedMs: number | null;
  exitCode: number | null;
};

/** exit.json（web 侧 spawn 收尾写的退出凭据）。 */
export type ExitEvidence = { exitCode: number | null; endedMs: number | null };

/**
 * 一次 run 的全部判定输入。**只装事实，不装结论** —— 每一项都能从 run 目录一眼看出来。
 */
export type RunEvidence = {
  /** run id（目录名）。meta 缺失时它本身就是一条时间证据。 */
  id: string;
  /** FAILED.md 是否存在（master 或 run.ts 写的失败凭据）。 */
  failedMarker: boolean;
  /** proposal.md 是否存在（run.ts 收尾段确定性渲染出的交付正文）。 */
  proposal: boolean;
  /** verification-report.md 原文；不存在为 null（"存在但读不动" 也按不存在算）。 */
  report: string | null;
  meta: MetaEvidence | null;
  exit: ExitEvidence | null;
  /** question.md 的 mtime —— 开始时间的最后退路。 */
  questionMs: number | null;
  /**
   * run 目录**顶层**文件的最新 mtime —— 结束时间的兜底。
   * 不含 verdicts/ 与 memory/：那是节点中途的产物，不代表 run 结束。
   */
  newestMs: number | null;
};

/* ------------------------------------------------------------------ */
/* 判定                                                                 */
/* ------------------------------------------------------------------ */

export type RunPhase =
  /** 既没有失败凭据也没有 proposal 正文：还在跑，或中途死亡。 */
  | "unsettled"
  /** proposal 正文已渲染，但独立验收没过或没跑。 */
  | "rendered"
  /** proposal 正文已渲染 + 独立验收 ALL PASS + 没有失败退出码。 */
  | "verified"
  /** 如实报了失败（FAILED.md），或退出码非零。 */
  | "failed";

export type RunOutcome = {
  phase: RunPhase;
  /**
   * 这次 run 不会再变了。凭据任一即可：FAILED.md / verification-report.md /
   * proposal.md / meta 或 exit 里落了退出码或结束时间 —— 它们全都只可能在
   * eve 退出之后写下。retention 的「可以删这个 run 的重放数据了吗」读它。
   */
  terminal: boolean;
  /**
   * 可交付：通过了独立验收。**续跑判据与 web `passed` 的共同上游** ——
   * run-batch 只额外要求 meta.questionId 命中（报告本身不带题号）。
   */
  deliverable: boolean;
  startedMs: number | null;
  /** 未终结的 run 没有结束时间（不拿最后一次写盘冒充）。 */
  finishedMs: number | null;
};

const failingCode = (code: number | null | undefined): boolean => typeof code === "number" && code !== 0;

export function runOutcome(e: RunEvidence): RunOutcome {
  const failedExit = failingCode(e.meta?.exitCode) || failingCode(e.exit?.exitCode);

  const phase: RunPhase = e.failedMarker
    ? "failed"
    : e.proposal
      ? isAllPass(e.report) && !failedExit
        ? "verified"
        : "rendered"
      : failedExit
        ? "failed"
        : "unsettled";

  const settledMeta = e.meta !== null && (e.meta.finishedMs !== null || e.meta.exitCode !== null);
  const settledExit = e.exit !== null && (e.exit.endedMs !== null || e.exit.exitCode !== null);
  const terminal = e.failedMarker || e.report !== null || e.proposal || settledMeta || settledExit;

  return {
    phase,
    terminal,
    deliverable: phase === "verified",
    startedMs: e.meta?.startedMs ?? stampToMs(e.id) ?? e.questionMs,
    finishedMs: terminal ? (e.meta?.finishedMs ?? e.exit?.endedMs ?? e.newestMs) : null,
  };
}

/**
 * 流水线是否走到了终点（proposal 正文已渲染，且没有被 FAILED.md 或退出码否掉）。
 * scripts/run.ts 的退出码判定读它 —— 「跑完了」与「验收过了」是两件事，后者是 deliverable。
 */
export function reachedProposal(o: RunOutcome): boolean {
  return o.phase === "rendered" || o.phase === "verified";
}

/**
 * 续跑认领：这个 run 目录算不算「某一题已交付」。返回题号或 null。
 * scripts/run-batch.ts 的唯一判据 —— 报告不带题号，所以 deliverable 之外还要 meta 的 questionId。
 */
export function deliveredQuestionId(e: RunEvidence): number | null {
  return runOutcome(e).deliverable ? e.meta?.questionId ?? null : null;
}

/* ------------------------------------------------------------------ */
/* 证据构造：目录                                                        */
/* ------------------------------------------------------------------ */

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** ISO 时间串 → ms。落盘时间的解析口径只有这一份（retention 也用它）。 */
export const parseMs = (v: unknown): number | null => {
  if (typeof v !== "string") return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
};

/** meta.json 原文 → 证据。两个构造器共用，否则「解析口径」自己就会分叉。 */
export function metaEvidence(raw: unknown): MetaEvidence | null {
  if (typeof raw !== "object" || raw === null) return null;
  const m = raw as Record<string, unknown>;
  return {
    questionId: num(m.questionId),
    startedMs: parseMs(m.startedAt),
    finishedMs: parseMs(m.finishedAt),
    exitCode: num(m.exitCode),
  };
}

export function exitEvidence(raw: unknown): ExitEvidence | null {
  if (typeof raw !== "object" || raw === null) return null;
  const x = raw as Record<string, unknown>;
  return { exitCode: num(x.exitCode), endedMs: parseMs(x.endedAt) };
}

/** JSON 读盘：不存在 / 写坏 / 混进了 eve 的 stdout 噪声 —— 一律当没有。 */
export function readJsonFile<T = unknown>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

function readTextFile(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/**
 * 从 run 目录直接取证（脚本侧：run-batch / rebuild-memory / retention / run.ts）。
 * 一次 readdir + 顶层文件 stat，再按需读那三份文件 —— 判定要的东西一次拿全。
 */
export function readRunEvidence(dir: string, id = basename(dir)): RunEvidence {
  let names: string[];
  try {
    names = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name);
  } catch {
    names = []; // 目录不存在：证据为空，判定会给出 unsettled
  }
  const present = new Set(names);
  const mtime = (name: string): number | null => {
    if (!present.has(name)) return null;
    try {
      return statSync(join(dir, name)).mtimeMs;
    } catch {
      return null; // 文件在取证中途消失：当不存在
    }
  };

  // 一遍循环拿两件事：最新 mtime，以及 question.md 自己的 mtime（别为它再 stat 一次）
  let newestMs: number | null = null;
  let questionMs: number | null = null;
  for (const name of names) {
    const t = mtime(name);
    if (t === null) continue;
    if (name === "question.md") questionMs = t;
    if (newestMs === null || t > newestMs) newestMs = t;
  }

  return {
    id,
    failedMarker: present.has("FAILED.md"),
    proposal: present.has("proposal.md"),
    report: present.has("verification-report.md") ? readTextFile(join(dir, "verification-report.md")) : null,
    meta: present.has("meta.json") ? metaEvidence(readJsonFile(join(dir, "meta.json"))) : null,
    exit: present.has("exit.json") ? exitEvidence(readJsonFile(join(dir, "exit.json"))) : null,
    questionMs,
    newestMs,
  };
}
