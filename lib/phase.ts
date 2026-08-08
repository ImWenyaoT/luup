import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { activeLock } from "./lock.ts";
import { runDir } from "./paths.ts";
import type {
  NodeKey,
  NodeState,
  RunStatus,
  SpineNode,
  Verdict,
  VerdictCheck,
  VerifyCheck,
  VerifyReport,
} from "./types.ts";

/**
 * 状态机的唯一输入是文件系统——没有数据库，也不该有。
 * 每个节点绑一个产出工件，工件存在即节点完成，mtime 差即耗时。
 */
export const NODES: { key: NodeKey; mark: string; label: string; artifact: string }[] = [
  { key: "literature", mark: "L", label: "文献", artifact: "evidence.md" },
  { key: "hypothesis", mark: "H", label: "假设", artifact: "hypotheses.md" },
  { key: "critique", mark: "C", label: "批判", artifact: "critique.json" },
  { key: "proposal", mark: "W", label: "计划", artifact: "proposal.json" },
  { key: "verify", mark: "✓", label: "验收", artifact: "verification-report.md" },
];

/** run 目录快照：相对路径（posix 风格）→ mtimeMs。目录只下探 verdicts/ 与 memory/。 */
export type Scan = { id: string; dir: string; files: Map<string, number> };

const NESTED = new Set(["verdicts", "memory", "memory/papers"]);

export function scanRun(id: string): Scan | null {
  const dir = runDir(id);
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
/* 状态                                                                 */
/* ------------------------------------------------------------------ */

export const ALL_PASS = /结果:\s*ALL PASS/;

export function deriveStatus(scan: Scan): RunStatus {
  const lock = activeLock();
  if (lock?.runId === scan.id) return "running";
  if (scan.files.has("FAILED.md")) return "failed";
  const report = readText(scan, "verification-report.md");
  if (scan.files.has("proposal.md")) return report && ALL_PASS.test(report) ? "passed" : "completed";
  const exit = readJson<{ exitCode?: unknown }>(scan, "exit.json");
  if (typeof exit?.exitCode === "number" && exit.exitCode !== 0) return "failed";
  const meta = readJson<{ exitCode?: unknown }>(scan, "meta.json");
  if (typeof meta?.exitCode === "number" && meta.exitCode !== 0) return "failed";
  return "stale";
}

export function deriveNodes(scan: Scan, status: RunStatus, verdicts: Verdict[]): SpineNode[] {
  const rejects = new Map<string, number>();
  for (const v of verdicts) {
    const n = (rejects.get(v.node) ?? 0) + (v.verdict === "pass" ? 0 : 1) + (v.rejectedRaw ? 1 : 0);
    rejects.set(v.node, n);
  }
  let prev = startedAtMs(scan);
  let activeTaken = status !== "running";
  return NODES.map(({ key, mark, label, artifact }) => {
    const mtime = scan.files.get(artifact) ?? null;
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

type Meta = { questionId?: unknown; startedAt?: unknown; finishedAt?: unknown; exitCode?: unknown };

export function readMeta(scan: Scan): Meta | null {
  return readJson<Meta>(scan, "meta.json");
}

export function startedAtMs(scan: Scan): number | null {
  const meta = readMeta(scan);
  if (typeof meta?.startedAt === "string") {
    const t = Date.parse(meta.startedAt);
    if (!Number.isNaN(t)) return t;
  }
  // 退路：run id 本身就是 UTC 时间戳 20260808-062829
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/.exec(scan.id);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  return scan.files.get("question.md") ?? null;
}

export function finishedAtMs(scan: Scan, status: RunStatus): number | null {
  if (status === "running") return null;
  const meta = readMeta(scan);
  if (typeof meta?.finishedAt === "string") {
    const t = Date.parse(meta.finishedAt);
    if (!Number.isNaN(t)) return t;
  }
  const exit = readJson<{ endedAt?: unknown }>(scan, "exit.json");
  if (typeof exit?.endedAt === "string") {
    const t = Date.parse(exit.endedAt);
    if (!Number.isNaN(t)) return t;
  }
  const times = [...scan.files.values()];
  return times.length ? Math.max(...times) : null;
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
  const result = /结果:\s*(.+)/.exec(text)?.[1]?.trim() ?? "UNKNOWN";
  const checks: VerifyCheck[] = [];
  for (const line of text.split("\n")) {
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length < 3) continue;
    if (cells[0] === "检查项" || /^-+$/.test(cells[0])) continue;
    const pass = cells[1].includes("✅");
    if (!pass && !cells[1].includes("❌")) continue;
    checks.push({ id: cells[0], group: cells[0].split(".")[0], pass, detail: cells[2] });
  }
  return { result, pass: ALL_PASS.test(text), checks };
}

/* ------------------------------------------------------------------ */
/* 问题原文                                                             */
/* ------------------------------------------------------------------ */

const SOURCE_LINE = /第\s*(\d+)\s*题[，,]\s*([^。\n]+)。/;

/** question.md 由 run.ts/run-batch.ts 按固定模板写，来源行里带题号与学科。 */
export function parseQuestion(text: string | null): {
  full: string;
  short: string;
  domain: string | null;
  science125Id: number | null;
} {
  const full = (text ?? "").trim();
  const m = SOURCE_LINE.exec(full);
  const asked = /问题[:：]\s*(.+)/.exec(full)?.[1]?.trim();
  const firstBody = full
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0 && !l.startsWith("#") && !l.startsWith("来源"));
  const short = (asked ?? firstBody ?? "(无问题原文)").slice(0, 160);
  return {
    full,
    short,
    domain: m?.[2]?.trim() ?? null,
    science125Id: m ? Number(m[1]) : null,
  };
}

export function tailLines(text: string | null, n: number): string[] {
  if (!text) return [];
  const lines = text.replace(/\s+$/, "").split("\n");
  return lines.slice(Math.max(0, lines.length - n));
}
