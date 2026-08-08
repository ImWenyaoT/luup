/**
 * .eve/.workflow-data 的**保留策略引擎**：类型 + 判定，没有任何 CLI 与打印。
 *
 * CLI 壳在 `scripts/prune-eve-state.ts`，批跑入口在 `scripts/run-batch.ts`。
 * 判定住在 lib 里而不是脚本里，是因为它有两个非交互调用方（批跑、自测），
 * 而「能不能删掉一个 run 的重放数据」这种判断不该从一个脚本里 import 出来。
 *
 * ## 为什么只删 streams/chunks
 *
 * eve 的 workflow 状态盘里，四块数据的量级差三个数量级：
 *
 *   streams/chunks  1.1G / 6.2 万文件   ← 每个流 delta 一个 .bin，且每个 .bin 嵌全文快照，O(n²)
 *   events            36M
 *   steps             22M
 *   hooks            4.9M
 *
 * chunks 是**纯重放工件**：run 跑完、工件已落到 runs/<ts>/ 之后没有任何消费者。
 * events/steps/hooks 轻量且 `eve workflow inspect` 要读，一律保留。
 * eve 自带的自动清理不覆盖 chunks —— 不删就是每跑 ~50 题涨 1G，125 全量跑会打爆磁盘。
 *
 * ## 安全判据（三条全满足才删，任一不满足就留）
 *
 * ① **终态 run**：该流所属的 workflow 能映射到 runs/<ts>/，且该目录已有终态凭据
 *    （verification-report.md 或 FAILED.md）。
 * ② **写入早于 run 结束**：流目录最新 mtime 早于该 run 的 finishedAt（+SLACK）。
 * ③ **不在活跃窗口**：流目录最新 mtime 早于 now - graceMin（默认 60 分钟），
 *    且所属 workflow 的 status 已是终态（completed/cancelled/failed）。
 *
 * 映射不到 run 的流（子 workflow、孤儿流）退回「② + ③」，即任务书里的
 * 「mtime 早于最老活跃阈值」保守策略 —— 仍然要求 workflow 自身已终态。
 *
 * ## 为什么不能只靠一条
 *
 * CLI 批跑（run-batch.ts）**不持 runs/.active.json 锁**（锁只有 web API 走），
 * 所以「有没有 run 在跑」没有单一权威信号。三条判据各自独立地把在跑的 run 挡住：
 * 它的 workflow 还是 running、它的 run 目录还没有终态凭据、它的 chunks 还在被写。
 * 任何一条失效，另外两条仍然成立。
 */
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { basename, join, resolve, sep } from "node:path";
import { REPO_ROOT, RUNS_DIR, RUN_ID_RE } from "./paths.ts";

/* ------------------------------------------------------------------ */
/* 常量                                                                 */
/* ------------------------------------------------------------------ */

/** eve workflow-core 实测出现过的 status 全集：completed / cancelled / failed / running。 */
const TERMINAL_WORKFLOW_STATUS = new Set(["completed", "cancelled", "canceled", "failed", "aborted"]);

/** run 目录里任一存在即视为终态（跑完并出了结论，或如实报了失败）。 */
const TERMINAL_RUN_MARKERS = ["verification-report.md", "FAILED.md"];

/** 判据②的容差：meta.finishedAt 由 run.ts 在 eve 退出后写，晚于最后一次 chunk 落盘。 */
const FINISH_SLACK_MS = 5 * 60 * 1000;

const DEFAULT_GRACE_MIN = 60;

/* ------------------------------------------------------------------ */
/* 类型                                                                 */
/* ------------------------------------------------------------------ */

export type PruneOptions = {
  /** .eve/.workflow-data，默认从仓库根推出。 */
  stateDir?: string;
  /** runs/，默认从仓库根推出。 */
  runsDir?: string;
  graceMs?: number;
  /** false（默认）= dry-run，只报告不删。 */
  apply?: boolean;
  now?: number;
};

/** keep 的理由是判据的镜像：每一个 keep 都能追到是哪一条判据挡下来的。 */
export type KeepReason =
  | "active-window" // ③ mtime 落在 now - grace 之内
  | "workflow-not-terminal" // ③ workflow status 还不是终态
  | "workflow-completed-recently" // ③ workflow 刚终态，还在活跃窗口内
  | "run-not-terminal" // ① 映射到的 run 目录还没有终态凭据
  | "stream-newer-than-run"; // ② 流写入晚于 run 结束

export type StreamPlan = {
  id: string;
  dir: string;
  bytes: number;
  files: number;
  /** 目录与目录内所有文件的最新 mtime。 */
  newestMs: number;
  wrunId: string | null;
  workflowStatus: string | null;
  runId: string | null;
  decision: "delete" | "keep";
  reason: KeepReason | "prunable";
};

export type PruneResult = {
  stateDir: string;
  applied: boolean;
  graceMs: number;
  /** 活跃下限：mtime >= 此刻的流一律保留。 */
  floorMs: number;
  scanned: number;
  plans: StreamPlan[];
  prunable: StreamPlan[];
  kept: StreamPlan[];
  /** 实际删掉的流 id（dry-run 下为空）。 */
  deleted: string[];
  prunableBytes: number;
  prunableFiles: number;
  freedBytes: number;
  freedFiles: number;
  totalBytes: number;
  keepReasons: Record<string, number>;
};

/* ------------------------------------------------------------------ */
/* 工具                                                                 */
/* ------------------------------------------------------------------ */

function readJsonFile<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null; // 不存在 / 写坏 / 混进了 eve 的 stdout 噪声 —— 一律当没有
  }
}

function listDirNames(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

function listFileNames(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name);
  } catch {
    return [];
  }
}

/** 走一遍目录，同时拿到体量与最新 mtime —— 判据②③要 mtime，报告要体量，一次遍历都拿全。 */
function measureDir(dir: string): { bytes: number; files: number; newestMs: number } {
  let bytes = 0;
  let files = 0;
  let newestMs: number;
  try {
    newestMs = statSync(dir).mtimeMs;
  } catch {
    return { bytes: 0, files: 0, newestMs: 0 };
  }
  const stack = [dir];
  while (stack.length > 0) {
    const cur = stack.pop() as string;
    let entries;
    try {
      entries = readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const p = join(cur, ent.name);
      if (ent.isDirectory()) {
        stack.push(p);
        continue;
      }
      if (!ent.isFile()) continue;
      try {
        const st = statSync(p);
        bytes += st.size;
        files += 1;
        if (st.mtimeMs > newestMs) newestMs = st.mtimeMs;
      } catch {
        /* 文件在遍历中途消失：当不存在 */
      }
    }
  }
  return { bytes, files, newestMs };
}

export function formatBytes(n: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/* ------------------------------------------------------------------ */
/* run 目录索引                                                         */
/* ------------------------------------------------------------------ */

type RunInfo = {
  id: string;
  dir: string;
  terminal: boolean;
  startedMs: number | null;
  finishedMs: number | null;
  /** invoke-result.json 里的 root workflow id（能解析出来才有）。 */
  sessionId: string | null;
};

/** run id 本身就是 UTC 时间戳 20260808-062829 —— meta.json 缺失时的退路。 */
function stampToMs(id: string): number | null {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/.exec(id);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null;
}

function parseMs(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

function newestFileMs(dir: string): number | null {
  let newest: number | null = null;
  for (const name of listFileNames(dir)) {
    try {
      const t = statSync(join(dir, name)).mtimeMs;
      if (newest === null || t > newest) newest = t;
    } catch {
      /* ignore */
    }
  }
  return newest;
}

function indexRuns(runsDir: string): RunInfo[] {
  const out: RunInfo[] = [];
  for (const id of listDirNames(runsDir)) {
    if (!RUN_ID_RE.test(id)) continue;
    const dir = join(runsDir, id);
    const terminal = TERMINAL_RUN_MARKERS.some((m) => existsSync(join(dir, m)));
    const meta = readJsonFile<{ startedAt?: unknown; finishedAt?: unknown }>(join(dir, "meta.json"));
    const startedMs = parseMs(meta?.startedAt) ?? stampToMs(id);
    const finishedMs = parseMs(meta?.finishedAt) ?? (terminal ? newestFileMs(dir) : null);

    // invoke-result.json 常被 eve 的 stdout 噪声污染 → readJsonFile 返回 null，退到时间窗映射
    const invoke = readJsonFile<{ resume?: { session?: { sessionId?: unknown } } }>(
      join(dir, "invoke-result.json"),
    );
    const sid = invoke?.resume?.session?.sessionId;

    out.push({
      id,
      dir,
      terminal,
      startedMs,
      finishedMs,
      sessionId: typeof sid === "string" ? sid : null,
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

type RunWindow = RunInfo & { windowEndMs: number };

/**
 * 给每个 run 算一个**闭合**的时间窗。
 *
 * 上界不能只取 meta.finishedAt：中途被 Ctrl-C / OOM 打断的 run 根本没写 finishedAt，
 * 窗口一路开到无穷，排在最前的那个残缺 run 会把后面所有 workflow 都吸进去，
 * 于是「run-not-terminal」把整盘数据永久锁死（实测：49 个流里 44 个被这样误留）。
 *
 * pipeline 是串行的（百炼并发过载阈值低，run-batch.ts 串行 + runs/.active.json 单并发锁），
 * 所以**下一个 run 的 startedAt 就是上一个 run 的硬上界** —— 这是布局给的事实，不是估计。
 */
function withWindows(runs: RunInfo[]): RunWindow[] {
  return runs.map((r, i) => {
    const own = r.finishedMs !== null ? r.finishedMs + FINISH_SLACK_MS : Number.POSITIVE_INFINITY;
    const nextStart = runs[i + 1]?.startedMs ?? Number.POSITIVE_INFINITY;
    return { ...r, windowEndMs: Math.min(own, nextStart) };
  });
}

/**
 * workflow → run 目录。两条路，先直连后时间窗：
 *
 * 1. **直连**：runs/<ts>/invoke-result.json 的 resume.session.sessionId 就是 root workflow id。
 * 2. **时间窗**：子 workflow 不出现在任何 run 目录里，但串行执行让
 *    「startedAt 落在某个 run 的窗口内」成为唯一映射，不是猜。
 *
 * 串行前提一旦被打破（并发跑多题），时间窗会把子 workflow 归到相邻 run —— 但被归到的 run
 * 也必须是终态才会删，误归只会更保守，不会削弱安全性。
 */
function mapWorkflowToRun(wrunStartedMs: number | null, sessionId: string, runs: RunWindow[]): RunWindow | null {
  const direct = runs.find((r) => r.sessionId === sessionId);
  if (direct) return direct;
  if (wrunStartedMs === null) return null;
  for (const r of runs) {
    if (r.startedMs === null) continue;
    if (wrunStartedMs >= r.startedMs && wrunStartedMs < r.windowEndMs) return r;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* 主判定                                                               */
/* ------------------------------------------------------------------ */

type WorkflowMeta = { status: string; startedMs: number | null; completedMs: number | null };

function readWorkflowRuns(stateDir: string): Map<string, WorkflowMeta> {
  const dir = join(stateDir, "runs");
  const out = new Map<string, WorkflowMeta>();
  for (const name of listFileNames(dir)) {
    if (!name.endsWith(".json")) continue;
    const j = readJsonFile<{ runId?: unknown; status?: unknown; startedAt?: unknown; completedAt?: unknown }>(
      join(dir, name),
    );
    if (!j || typeof j.status !== "string") continue;
    const id = typeof j.runId === "string" ? j.runId : name.replace(/\.json$/, "");
    out.set(id, { status: j.status, startedMs: parseMs(j.startedAt), completedMs: parseMs(j.completedAt) });
  }
  return out;
}

/** streams/runs/<wrunId>.json = { streams: [streamId] } —— 流的归属只有这一个来源。 */
function readStreamOwners(stateDir: string): Map<string, string> {
  const dir = join(stateDir, "streams", "runs");
  const out = new Map<string, string>();
  for (const name of listFileNames(dir)) {
    if (!name.endsWith(".json")) continue;
    const j = readJsonFile<{ streams?: unknown }>(join(dir, name));
    if (!j || !Array.isArray(j.streams)) continue;
    const wrunId = name.replace(/\.json$/, "");
    for (const s of j.streams) if (typeof s === "string") out.set(s, wrunId);
  }
  return out;
}

export function planPrune(opts: PruneOptions = {}): PruneResult {
  const stateDir = opts.stateDir ?? join(REPO_ROOT, ".eve", ".workflow-data");
  const runsDir = opts.runsDir ?? RUNS_DIR;
  const graceMs = opts.graceMs ?? DEFAULT_GRACE_MIN * 60 * 1000;
  const now = opts.now ?? Date.now();
  const floorMs = now - graceMs;

  const chunksDir = join(stateDir, "streams", "chunks");
  const owners = readStreamOwners(stateDir);
  const workflows = readWorkflowRuns(stateDir);
  const runs = withWindows(indexRuns(runsDir));

  const plans: StreamPlan[] = [];
  for (const id of listDirNames(chunksDir)) {
    const dir = join(chunksDir, id);
    const { bytes, files, newestMs } = measureDir(dir);
    const wrunId = owners.get(id) ?? null;
    const wf = wrunId ? workflows.get(wrunId) ?? null : null;
    const run = wrunId && wf ? mapWorkflowToRun(wf.startedMs, wrunId, runs) : null;

    const base = {
      id,
      dir,
      bytes,
      files,
      newestMs,
      wrunId,
      workflowStatus: wf?.status ?? null,
      runId: run?.id ?? null,
    };
    const keep = (reason: KeepReason): StreamPlan => ({ ...base, decision: "keep", reason });

    // ③ 活跃窗口：还在写的东西一概不碰（在跑的 run 的第一道闸门）
    if (newestMs >= floorMs) {
      plans.push(keep("active-window"));
      continue;
    }
    // ③ workflow 终态。status 未知 → 不在白名单 → 保留（fail-safe）
    if (wf && !TERMINAL_WORKFLOW_STATUS.has(wf.status)) {
      plans.push(keep("workflow-not-terminal"));
      continue;
    }
    if (wf?.completedMs !== null && wf?.completedMs !== undefined && wf.completedMs >= floorMs) {
      plans.push(keep("workflow-completed-recently"));
      continue;
    }
    // ①② 能映射到 run 就用强判据；映射不到只能退回 ③（已在上面过完）
    if (run) {
      if (!run.terminal) {
        plans.push(keep("run-not-terminal"));
        continue;
      }
      if (run.finishedMs !== null && newestMs > run.finishedMs + FINISH_SLACK_MS) {
        plans.push(keep("stream-newer-than-run"));
        continue;
      }
    }
    plans.push({ ...base, decision: "delete", reason: "prunable" });
  }

  plans.sort((a, b) => b.bytes - a.bytes);
  const prunable = plans.filter((p) => p.decision === "delete");
  const kept = plans.filter((p) => p.decision === "keep");
  const keepReasons: Record<string, number> = {};
  for (const k of kept) keepReasons[k.reason] = (keepReasons[k.reason] ?? 0) + 1;

  const deleted: string[] = [];
  let freedBytes = 0;
  let freedFiles = 0;
  if (opts.apply) {
    const guard = resolve(chunksDir) + sep;
    for (const p of prunable) {
      // 最后一道：删除路径必须真的落在 chunks/ 之下，且是它的直接子目录
      const abs = resolve(p.dir);
      if (!abs.startsWith(guard) || basename(abs) !== p.id) continue;
      try {
        rmSync(abs, { recursive: true, force: true });
        deleted.push(p.id);
        freedBytes += p.bytes;
        freedFiles += p.files;
      } catch {
        /* 并发删除 / 权限：跳过，下一次 prune 还会碰到它 */
      }
    }
  }

  return {
    stateDir,
    applied: opts.apply === true,
    graceMs,
    floorMs,
    scanned: plans.length,
    plans,
    prunable,
    kept,
    deleted,
    prunableBytes: prunable.reduce((a, p) => a + p.bytes, 0),
    prunableFiles: prunable.reduce((a, p) => a + p.files, 0),
    freedBytes,
    freedFiles,
    totalBytes: plans.reduce((a, p) => a + p.bytes, 0),
    keepReasons,
  };
}

export function summarize(r: PruneResult): string {
  return r.applied
    ? `释放 ${formatBytes(r.freedBytes)}（${r.deleted.length} 个流 / ${r.freedFiles} 文件），保留 ${r.kept.length} 个流`
    : `可释放 ${formatBytes(r.prunableBytes)}（${r.prunable.length} 个流 / ${r.prunableFiles} 文件），保留 ${r.kept.length} 个流`;
}

