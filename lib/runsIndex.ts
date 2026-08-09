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
 * 写坏了、过期了，readRunsIndex() 一律返回 null，调用方退回 listRuns() 全量扫描。
 * 这条回退路径必须一直活着 —— 缓存可以错，交付面不能空。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { RUNS_INDEX_FILE } from "./paths.ts";
import { listRunIds, readSummary } from "./runs.ts";
import type { RunSummary } from "./types.ts";

/**
 * 形状或字段语义变了就 +1：老 index.json 会因版本不符被当作损坏，自动退回扫盘。
 * v2：deriveNodes 开始认历史工件名（老 run 的 critique.md），已定型条目的 nodes 会变。
 * v3：终态判定收敛到 lib/runOutcome.ts。status 对现存 run 全部不变，但结束时间的兜底
 *     从「目录内所有文件的最新 mtime」收窄为「顶层文件」，缺 meta.finishedAt 的老 run
 *     的 finishedAt / durationSec 会变。
 * v4：缓存不再存 running（见 buildRunsIndex）。老索引里被写死成 running 的条目会随
 *     版本作废 —— 那正是它们该有的下场。
 */
export const RUNS_INDEX_VERSION = 4;

export type RunsIndex = {
  version: number;
  generatedAt: string;
  count: number;
  /** 与 listRunIds() 同序：run id 倒序（新的在前）。 */
  runs: RunSummary[];
};

/**
 * `activeId` 显式传 null：缓存里只存 run 目录里看得出来的事实。
 *
 * 重建的时机恰恰是「某个 run 刚跑完、锁还没放」（scripts/run.ts 收尾段），读锁就会把
 * 那一条写死成 running —— 一条永远不会自己变回去的谎。running 是进程外事实，读的时候
 * 由 readRunsIndex 现叠加。
 */
export function buildRunsIndex(): RunsIndex {
  const runs: RunSummary[] = [];
  for (const id of listRunIds()) {
    const s = readSummary(id, null);
    if (s) runs.push(s);
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
  // 逐条最小校验：id 是唯一的联结键，缺了它下面的集合比对就无从谈起
  if (!v.runs.every((r) => typeof r?.id === "string")) return null;
  return { version: v.version, generatedAt: String(v.generatedAt ?? ""), count: v.runs.length, runs: v.runs };
}

/**
 * 读缓存。返回 null = 调用方必须退回 listRuns()。
 *
 * 除了「缺失/损坏」，**过期也算损坏**：拿 index 里的 id 集合与 readdir 的真实结果比对，
 * 对不上就作废。这一次 readdir 是整个缓存唯一的必付成本，换来的是缓存不会悄悄骗人 ——
 * 一个陈旧的列表页比一个慢的列表页更糟。
 *
 * **只有活跃的那一条现算**，靠的是单并发锁（lib/lock.ts）：同一时刻至多一个 pipeline，
 * 还在写盘的就只可能是活跃的那个 run。别的条目连 stale 都是定型的 —— stale 是中断残留，
 * 没有任何进程还会碰它。
 */
export function readRunsIndex(limit: number, activeId: string | null): RunSummary[] | null {
  let index: RunsIndex | null;
  try {
    index = parseIndex(readFileSync(RUNS_INDEX_FILE, "utf8"));
  } catch {
    return null; // 不存在 / 读不了
  }
  if (!index) return null;

  const actual = listRunIds();
  if (actual.length !== index.runs.length) return null;
  for (let i = 0; i < actual.length; i++) {
    if (actual[i] !== index.runs[i].id) return null; // 顺序也必须一致（同为 id 倒序）
  }

  return index.runs.slice(0, limit).map((r) => (r.id === activeId ? readSummary(r.id, activeId) ?? r : r));
}
