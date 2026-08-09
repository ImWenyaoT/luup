/**
 * 状态机的唯一输入是文件系统——没有数据库，也不该有。
 * 每个节点绑一个产出工件（绑定关系在 ./nodes.ts），工件存在即节点完成，mtime 差即耗时。
 *
 * **终态判定不在这里**：phase / terminal / deliverable / 起止时间的唯一 owner 是
 * `./runOutcome.ts`。本文件只负责两件本地的事：把 Scan 转成证据，以及把 phase 映射成
 * web 的五态 RunStatus（外加一个只有锁能给出的 running）。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { activeLock } from "./lock.ts";
import { parseTableRows } from "./mdTable.ts";
import { NODES, resolveArtifact } from "./nodes.ts";
import { runDir } from "./paths.ts";
import {
  RESULT_PREFIX,
  type RunEvidence,
  type RunOutcome,
  type RunPhase,
  exitEvidence,
  isAllPass,
  metaEvidence,
  runOutcome,
} from "./runOutcome.ts";
import type {
  NodeState,
  RunStatus,
  SpineNode,
  Verdict,
  VerdictCheck,
  VerifyCheck,
  VerifyReport,
} from "./types.ts";

/** run 目录快照：相对路径（posix 风格）→ mtimeMs。目录只下探 verdicts/ 与 memory/。 */
export type Scan = { id: string; dir: string; files: Map<string, number> };

const NESTED = new Set(["verdicts", "memory", "memory/papers"]);

/** 沙箱内的入口：id 先过 runDir() 的越界判定。 */
export function scanRun(id: string): Scan | null {
  return scanDir(runDir(id), id);
}

/** 任意目录版（selftest 拿临时 run 目录做断言时用；web 一律走 scanRun）。 */
export function scanDir(dir: string, id = basename(dir)): Scan | null {
  try {
    if (!statSync(dir).isDirectory()) return null;
  } catch {
    return null;
  }
  const files = new Map<string, number>();
  const walk = (rel: string) => {
    const abs = rel ? join(dir, rel) : dir;
    for (const ent of readdirSync(abs, { withFileTypes: true })) {
      const child = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) {
        if (NESTED.has(child)) walk(child);
        continue;
      }
      if (!ent.isFile()) continue;
      try {
        files.set(child, statSync(join(abs, ent.name)).mtimeMs);
      } catch {
        /* 文件在扫描中途消失：当不存在 */
      }
    }
  };
  walk("");
  return { id, dir, files };
}

export const readText = (scan: Scan, rel: string): string | null => {
  if (!scan.files.has(rel)) return null;
  try {
    return readFileSync(join(scan.dir, rel), "utf8");
  } catch {
    return null;
  }
};

export const readJson = <T>(scan: Scan, rel: string): T | null => {
  const raw = readText(scan, rel);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

/* ------------------------------------------------------------------ */
/* verdicts                                                            */
/* ------------------------------------------------------------------ */

type RawCheck = {
  criterion?: unknown;
  pass?: unknown;
  result?: unknown;
  reason?: unknown;
  detail?: unknown;
};

/** master 的 verdict 与 schema 打回文件字段名不同（pass/reason vs result/detail），这里归一。 */
function normalizeChecks(raw: unknown): VerdictCheck[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((c: RawCheck) => {
    const pass =
      typeof c.pass === "boolean" ? c.pass : typeof c.result === "string" ? c.result === "pass" : null;
    return {
      criterion: typeof c.criterion === "string" ? c.criterion : "(未命名判据)",
      pass,
      reason: typeof c.reason === "string" ? c.reason : typeof c.detail === "string" ? c.detail : "",
    };
  });
}

export function parseVerdicts(scan: Scan): Verdict[] {
  const out: Verdict[] = [];
  for (const rel of [...scan.files.keys()].sort()) {
    if (!rel.startsWith("verdicts/") || !rel.endsWith(".json") || rel.endsWith(".rejected.json")) continue;
    const raw = readJson<Record<string, unknown>>(scan, rel);
    if (!raw) continue;
    const file = rel.slice("verdicts/".length);
    out.push({
      file,
      node: typeof raw.node === "string" ? raw.node : file.split("-")[0],
      round: typeof raw.round === "number" ? raw.round : Number(/-r(\d+)/.exec(file)?.[1] ?? 1),
      verdict: typeof raw.verdict === "string" ? raw.verdict : "unknown",
      checks: normalizeChecks(raw.checks),
      rework: typeof raw.rework === "string" ? raw.rework : null,
      rejectedRaw: readText(scan, `${rel}.rejected.json`),
    });
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

/* ------------------------------------------------------------------ */
/* 终态：判定在 lib/runOutcome.ts，这里只做 web 的表示层                    */
/* ------------------------------------------------------------------ */

/** 一次 Scan 是一次请求内的不变快照，证据也就不变——同一请求里会被问好几遍。 */
const EVIDENCE = new WeakMap<Scan, RunEvidence>();

/**
 * Scan → 证据。web 侧已经把目录扫过一遍了，不必再 readdir 一次。
 *
 * 与脚本侧的 `readRunEvidence(dir)` 必须给出同一份证据（selftest-outcome 逐目录断言）：
 * 时间兜底同样只看**顶层**文件 —— verdicts/ 与 memory/ 是节点中途的产物。
 */
export function evidenceFromScan(scan: Scan): RunEvidence {
  const cached = EVIDENCE.get(scan);
  if (cached) return cached;
  let newestMs: number | null = null;
  for (const [rel, t] of scan.files) {
    if (rel.includes("/")) continue;
    if (newestMs === null || t > newestMs) newestMs = t;
  }
  const e: RunEvidence = {
    id: scan.id,
    failedMarker: scan.files.has("FAILED.md"),
    proposal: scan.files.has("proposal.md"),
    report: readText(scan, "verification-report.md"),
    meta: scan.files.has("meta.json") ? metaEvidence(readJson<unknown>(scan, "meta.json")) : null,
    exit: scan.files.has("exit.json") ? exitEvidence(readJson<unknown>(scan, "exit.json")) : null,
    questionMs: scan.files.get("question.md") ?? null,
    newestMs,
  };
  EVIDENCE.set(scan, e);
  return e;
}

export const outcomeOf = (scan: Scan): RunOutcome => runOutcome(evidenceFromScan(scan));

/** 表示层：五态里的四态由 phase 决定，running 只能由锁决定（见 deriveStatus）。 */
const STATUS_BY_PHASE: Record<RunPhase, Exclude<RunStatus, "running">> = {
  failed: "failed",
  verified: "passed",
  rendered: "completed",
  unsettled: "stale",
};

/**
 * 「已定型」的状态集合 —— runs/index.json 缓存只对它们有意义（目录不会再变）。
 * 从 phase 表派生而不是手写：unsettled 之外的 phase 都蕴含 terminal，
 * 所以它们映射到的状态就是定型态；stale 永远现算。
 */
export const SETTLED_STATUSES: ReadonlySet<RunStatus> = new Set(
  (Object.keys(STATUS_BY_PHASE) as RunPhase[]).filter((p) => p !== "unsettled").map((p) => STATUS_BY_PHASE[p]),
);

/**
 * 锁的判定留在 runOutcome 之外：「谁在跑」是进程外事实，不在 run 目录里，
 * 把它读进纯函数就等于给终态判定塞了一个看不见的入参。
 */
export function deriveStatus(scan: Scan): RunStatus {
  const lock = activeLock();
  if (lock?.runId === scan.id) return "running";
  return STATUS_BY_PHASE[outcomeOf(scan).phase];
}

export function deriveNodes(scan: Scan, status: RunStatus, verdicts: Verdict[]): SpineNode[] {
  const rejects = new Map<string, number>();
  for (const v of verdicts) {
    const n = (rejects.get(v.node) ?? 0) + (v.verdict === "pass" ? 0 : 1) + (v.rejectedRaw ? 1 : 0);
    rejects.set(v.node, n);
  }
  let prev = startedAtMs(scan);
  let activeTaken = status !== "running";
  return NODES.map((spec) => {
    const { key, mark, label } = spec;
    // 认历史工件名：老 run 的 critique.md 也是「批判节点已产出」，不是 pending
    const found = resolveArtifact(spec, (f) => scan.files.has(f));
    const artifact = found?.file ?? spec.artifact;
    const mtime = found !== null ? (scan.files.get(found.file) ?? null) : null;
    let state: NodeState;
    if (mtime !== null) {
      state = "done";
    } else if (!activeTaken) {
      state = "active";
      activeTaken = true;
    } else {
      state = (rejects.get(key) ?? 0) > 0 ? "rejected" : "pending";
    }
    const elapsedSec = mtime !== null && prev !== null ? Math.max(0, Math.round((mtime - prev) / 1000)) : null;
    if (mtime !== null) prev = mtime;
    return {
      key,
      mark,
      label,
      artifact,
      state,
      at: mtime !== null ? new Date(mtime).toISOString() : null,
      elapsedSec,
      rejects: rejects.get(key) ?? 0,
    };
  });
}

/* ------------------------------------------------------------------ */
/* 时间                                                                 */
/* ------------------------------------------------------------------ */

/** meta.json 只有一个读点：证据。题号是它唯一被表示层直接用到的字段。 */
export const questionIdOf = (scan: Scan): number | null => evidenceFromScan(scan).meta?.questionId ?? null;

export const startedAtMs = (scan: Scan): number | null => outcomeOf(scan).startedMs;

/** 在跑的 run 不显示结束时间——这是表示层的选择，与「有没有结束时间」是两件事。 */
export function finishedAtMs(scan: Scan, status: RunStatus): number | null {
  return status === "running" ? null : outcomeOf(scan).finishedMs;
}


/* ------------------------------------------------------------------ */
/* 验收报告                                                             */
/* ------------------------------------------------------------------ */

/**
 * 解析 verification-report.md 的表格行，而不是把 markdown 整段丢给渲染器：
 * 验收结论要能分组、能折叠、能统计，那需要结构而不是文本。
 */
export function parseVerifyReport(text: string | null): VerifyReport | null {
  if (!text) return null;
  const result = new RegExp(`${RESULT_PREFIX.trimEnd()}\\s*(.+)`).exec(text)?.[1]?.trim() ?? "UNKNOWN";
  const checks: VerifyCheck[] = [];
  // 三列表；说明列里的 `|` 是转义写出的，必须走成对的反解式，否则整行读串位
  for (const cells of parseTableRows(text, 3)) {
    if (cells[0] === "检查项") continue;
    const pass = cells[1].includes("✅");
    if (!pass && !cells[1].includes("❌")) continue;
    checks.push({ id: cells[0], group: cells[0].split(".")[0], pass, detail: cells[2] });
  }
  return { result, pass: isAllPass(text), checks };
}

export function tailLines(text: string | null, n: number): string[] {
  if (!text) return [];
  const lines = text.replace(/\s+$/, "").split("\n");
  return lines.slice(Math.max(0, lines.length - n));
}
