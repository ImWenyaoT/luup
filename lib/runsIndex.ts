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
import { activeRunId } from "./lock.ts";
import { RUNS_INDEX_FILE } from "./paths.ts";
import { listRunIds, readSummary } from "./runs.ts";
import type { RunSummary } from "./types.ts";

/** 形状变了就 +1：老 index.json 会因版本不符被当作损坏，自动退回扫盘。 */
export const RUNS_INDEX_VERSION = 1;

export type RunsIndex = {
  version: number;
  generatedAt: string;
  count: number;
  /** 与 listRunIds() 同序：run id 倒序（新的在前）。 */
  runs: RunSummary[];
};

export function buildRunsIndex(): RunsIndex {
  const runs: RunSummary[] = [];
  for (const id of listRunIds()) {
    const s = readSummary(id);
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
 * **未定型的条目永远现算**。缓存只对已经定型的 run 有意义：passed/failed/completed 之后
 * 目录不会再变，缓存与磁盘永远一致。running/stale 则相反 —— 尤其 stale，它是 CLI 批跑
 * （run-batch.ts 不持 runs/.active.json 锁，锁只有 web API 走）里**在跑的 run** 的样子：
 * deriveStatus 看不到锁，就只能判 stale。把这类条目现算，缓存就不会在批跑途中骗人；
 * 代价是每次多扫几个目录，而未定型的 run 通常只有 0~1 个。
 */
const SETTLED = new Set<RunSummary["status"]>(["passed", "failed", "completed"]);

export function readRunsIndex(limit = 50): RunSummary[] | null {
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

  const active = activeRunId();
  const runs = index.runs
    .slice(0, limit)
    .map((r) => (r.id === active || !SETTLED.has(r.status) ? readSummary(r.id) ?? r : r));
  return runs;
}
