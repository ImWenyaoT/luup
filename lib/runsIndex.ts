/**
 * runs/index.json —— 列表页的派生缓存。
 *
 * 现状：listRuns() 对每个 run 目录做一次 scanRun()（递归 readdir + 每文件 statSync）
 * 再解析 meta/proposal/verification-report。9 个 run 时无感，125 全量跑后就是每次
 * 打开列表页都重扫上百个目录、上万个文件。
 *
 * 所以缓存的是 **RunSummary 全量**，不是几个字段：只有形状与 listRuns() 完全一致，
 * /api/runs 才能直接端出去，否则缓存救不了主路径。
 *
 * ## 它是派生物，不是真相
 *
 * 文件系统始终是唯一权威（docs/design 的既定选择：无数据库）。index.json 删了、
 * 写坏了、过期了，读入端一律退回 listRuns() 全量扫描。
 * 这条回退路径必须一直活着 —— 缓存可以错，交付面不能空。
 *
 * ## 新鲜度：每条存自己 run 目录的 mtime
 *
 * 「整份索引对不对」这个问题被拆成了「每一条对不对」：条目里带 `dirMtimeMs`，读的时候
 * 逐目录 statSync 比对，不符的那一条现算，其余照旧端出去。代价是每条一次 stat（比一次
 * 递归扫描便宜三个数量级），收益是 `pnpm verify` 事后补写验收报告这类改动能被立刻看见，
 * 而不是等下一次全量重建。
 *
 * 已知的洞（有意留着）：目录 mtime 只在**增删改名**条目时变，就地重写一个已有文件不变。
 * 唯一这么干的是 run.ts 收尾回写 meta.json —— 而那一刻正是它自己调 rebuildRunsIndex()
 * 的时候，所以这个洞在布局上是闭合的。
 */
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RUNS_DIR, RUNS_INDEX_FILE } from "./paths.ts";
import { listRunIds, listRuns, readSummary } from "./runs.ts";
import type { RunSummary } from "./types.ts";

/**
 * 形状或字段语义变了就 +1：老 index.json 会因版本不符被当作损坏，自动退回扫盘。
 * v2：终态判定收敛到 lib/runOutcome.ts + deriveNodes 认历史工件名 + 缓存不存 running
 *     + 每条带 dirMtimeMs 做新鲜度判定。
 */
export const RUNS_INDEX_VERSION = 2;

/** 一条缓存 = 一份 RunSummary + 它被算出来时那个 run 目录的 mtime。 */
export type RunsIndexEntry = { dirMtimeMs: number; summary: RunSummary };

export type RunsIndex = {
  version: number;
  generatedAt: string;
  count: number;
  /** 与 listRunIds() 同序：run id 倒序（新的在前）。 */
  runs: RunsIndexEntry[];
};

/** 目录自身的 mtime；取不到（并发删除）返回 0 —— 与任何缓存值都不相等，那一条就现算。 */
function dirMtime(id: string): number {
  try {
    return statSync(join(RUNS_DIR, id)).mtimeMs;
  } catch {
    return 0;
  }
}

function parseIndex(raw: string): RunsIndex | null {
  let j: unknown;
  try {
    j = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof j !== "object" || j === null) return null;
  const v = j as Partial<RunsIndex>;
  if (v.version !== RUNS_INDEX_VERSION || !Array.isArray(v.runs)) return null;
  // 逐条最小校验：id 是唯一的联结键，mtime 是新鲜度的唯一凭据，缺了谁下面都无从谈起
  if (!v.runs.every((r) => typeof r?.summary?.id === "string" && typeof r?.dirMtimeMs === "number")) return null;
  return { version: v.version, generatedAt: String(v.generatedAt ?? ""), count: v.runs.length, runs: v.runs };
}

/** 读盘上的索引；不存在 / 读不了 / 写坏 / 版本不符 —— 一律 null。 */
function loadIndex(): RunsIndex | null {
  try {
    return parseIndex(readFileSync(RUNS_INDEX_FILE, "utf8"));
  } catch {
    return null;
  }
}

/**
 * 重建（增量）。老索引里 mtime 没变的条目**整条复用**，只有新出现的 run 与目录动过的
 * run 才重算 —— 全量重建是 O(全部 run × 递归扫描)，而每跑完一题就要重建一次。
 * 老索引缺失 / 版本不符 / 写坏时退回全量，这条路径必须一直活着。
 *
 * `activeId` 显式传 null：缓存里只存 run 目录里看得出来的事实。
 *
 * 重建的时机恰恰是「某个 run 刚跑完、锁还没放」（scripts/run.ts 收尾段），读锁就会把
 * 那一条写死成 running —— 一条永远不会自己变回去的谎。running 是进程外事实，读的时候
 * 由 readRunsIndex 现叠加。
 */
export function buildRunsIndex(): RunsIndex {
  const reusable = new Map((loadIndex()?.runs ?? []).map((e) => [e.summary.id, e]));
  const runs: RunsIndexEntry[] = [];
  for (const id of listRunIds()) {
    const dirMtimeMs = dirMtime(id);
    const cached = reusable.get(id);
    if (cached && cached.dirMtimeMs === dirMtimeMs) {
      runs.push(cached);
      continue;
    }
    const summary = readSummary(id, null);
    if (summary) runs.push({ dirMtimeMs, summary });
  }
  return {
    version: RUNS_INDEX_VERSION,
    generatedAt: new Date().toISOString(),
    count: runs.length,
    runs,
  };
}

/**
 * 重建并落盘。run.ts 收尾调用，run-batch.ts 每题后间接调用。
 * 抛错由调用方决定怎么处理 —— 但两个调用点都必须吞掉：加速层绝不能改变一次真实 run 的退出码。
 */
export function rebuildRunsIndex(): { path: string; count: number } {
  const index = buildRunsIndex();
  writeFileSync(RUNS_INDEX_FILE, `${JSON.stringify(index, null, 2)}\n`, "utf8");
  return { path: RUNS_INDEX_FILE, count: index.count };
}

/**
 * 读缓存。返回 null = 调用方必须退回 listRuns()（只在索引缺失/损坏时发生：那时还没扫过盘）。
 *
 * 除了「缺失/损坏」，**过期也算损坏**：拿 index 里的 id 集合与 readdir 的真实结果比对，
 * 对不上就作废 —— 但那一次 readdir 的结果会顺手交给 listRuns()，不让调用方再扫一遍。
 * 一个陈旧的列表页比一个慢的列表页更糟。
 *
 * **活跃的那一条与目录动过的那些现算**：活跃靠单并发锁（lib/lock.ts）识别，同一时刻
 * 至多一个 pipeline；其余靠目录 mtime。别的条目连 stale 都是定型的 —— stale 是中断残留，
 * 没有任何进程还会碰它。
 */
export function readRunsIndex(limit: number, activeId: string | null): RunSummary[] | null {
  const index = loadIndex();
  if (!index) return null;

  const actual = listRunIds();
  const stale =
    actual.length !== index.runs.length ||
    // 顺序也必须一致（同为 id 倒序）
    actual.some((id, i) => id !== index.runs[i]?.summary.id);
  if (stale) return listRuns(limit, activeId, actual);

  return index.runs.slice(0, limit).map((e) => {
    if (e.summary.id !== activeId && e.dirMtimeMs === dirMtime(e.summary.id)) return e.summary;
    return readSummary(e.summary.id, activeId) ?? e.summary;
  });
}
