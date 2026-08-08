/**
 * 保留策略自测（零 API，零网络）。
 *
 *   node scripts/selftest-retention.ts
 *
 * 覆盖两件事：
 *
 * 1. **prune 的安全判据**：造一套假的 workflow 状态盘（已完成流 / 活跃流 / 归属 run 未终态的流 /
 *    孤儿流），断言 dry-run 只报告不删、--apply 只删够格的、活跃的那个一动不动。
 *    这里必须用假目录 —— 拿真状态盘做破坏性断言就是在赌当时没有 run 在跑。
 *
 * 2. **rebuildRunsIndex 的健壮性**：对真实 runs/ 跑一次，断言条目数与真实 run 目录数一致；
 *    再对一个含损坏 meta.json 的临时仓库跑一次，断言不炸且照样计数。
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO_ROOT, RUNS_DIR, RUN_ID_RE } from "../lib/paths.ts";
import { planPrune } from "../lib/retention.ts";

/* ------------------------------------------------------------------ */
/* 断言                                                                 */
/* ------------------------------------------------------------------ */

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed += 1;
    console.log(`  ✔ ${name}`);
  } else {
    failed += 1;
    console.error(`  ✘ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function eq<T>(name: string, actual: T, expected: T): void {
  check(name, Object.is(actual, expected), `期望 ${String(expected)}，实际 ${String(actual)}`);
}

/* ------------------------------------------------------------------ */
/* fixture                                                             */
/* ------------------------------------------------------------------ */

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

function writeJson(path: string, value: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

/** 目录 mtime 必须最后设：往目录里写文件会把它刷回当前时间。 */
function makeStream(chunksDir: string, id: string, atMs: number, chunks = 3): void {
  const dir = join(chunksDir, id);
  mkdirSync(dir, { recursive: true });
  for (let i = 0; i < chunks; i++) {
    const f = join(dir, `chnk_${id}_${i}.bin`);
    writeFileSync(f, "x".repeat(1024), "utf8");
    utimesSync(f, new Date(atMs), new Date(atMs));
  }
  utimesSync(dir, new Date(atMs), new Date(atMs));
}

type Fixture = { root: string; stateDir: string; runsDir: string; now: number };

function buildFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "luup-retention-"));
  const stateDir = join(root, "state");
  const runsDir = join(root, "runs");
  const now = Date.now();

  const chunks = join(stateDir, "streams", "chunks");
  mkdirSync(chunks, { recursive: true });

  // run A：终态（有 verification-report.md），T-4h 起，T-3h 完
  const runA = join(runsDir, "20260101-000000");
  mkdirSync(runA, { recursive: true });
  writeJson(join(runA, "meta.json"), {
    questionId: 1,
    startedAt: new Date(now - 4 * HOUR).toISOString(),
    finishedAt: new Date(now - 3 * HOUR).toISOString(),
    exitCode: 0,
  });
  writeFileSync(join(runA, "verification-report.md"), "结果: ALL PASS\n", "utf8");

  // run B：**非**终态（没有 verification-report.md / FAILED.md），T-2h 起，没写完
  const runB = join(runsDir, "20260102-000000");
  mkdirSync(runB, { recursive: true });
  writeJson(join(runB, "meta.json"), {
    questionId: 2,
    startedAt: new Date(now - 2 * HOUR).toISOString(),
    finishedAt: null,
    exitCode: null,
  });

  // ① 已完成流：workflow completed，落在 run A 的窗口里，写入早于 run A 结束
  writeJson(join(stateDir, "runs", "wrun_DONE.json"), {
    runId: "wrun_DONE",
    status: "completed",
    startedAt: new Date(now - 4 * HOUR + MIN).toISOString(),
    completedAt: new Date(now - 3 * HOUR).toISOString(),
  });
  writeJson(join(stateDir, "streams", "runs", "wrun_DONE.json"), { streams: ["strm_DONE_user"] });
  makeStream(chunks, "strm_DONE_user", now - 3.5 * HOUR);

  // ② 活跃流：workflow running，chunk 刚写（模拟正在跑的 run）
  writeJson(join(stateDir, "runs", "wrun_ACTIVE.json"), {
    runId: "wrun_ACTIVE",
    status: "running",
    startedAt: new Date(now - 10 * MIN).toISOString(),
    completedAt: null,
  });
  writeJson(join(stateDir, "streams", "runs", "wrun_ACTIVE.json"), { streams: ["strm_ACTIVE_user"] });
  makeStream(chunks, "strm_ACTIVE_user", now);

  // ③ workflow 已终态，但归属的 run B 还没有终态凭据 → 判据①挡下
  writeJson(join(stateDir, "runs", "wrun_PENDINGRUN.json"), {
    runId: "wrun_PENDINGRUN",
    status: "completed",
    startedAt: new Date(now - 2 * HOUR + MIN).toISOString(),
    completedAt: new Date(now - 100 * MIN).toISOString(),
  });
  writeJson(join(stateDir, "streams", "runs", "wrun_PENDINGRUN.json"), { streams: ["strm_PENDING_user"] });
  makeStream(chunks, "strm_PENDING_user", now - 95 * MIN);

  // ④ 孤儿流：没有任何 streams/runs 指向它，且早于活跃窗口
  makeStream(chunks, "strm_ORPHAN_user", now - 3 * HOUR);

  return { root, stateDir, runsDir, now };
}

/* ------------------------------------------------------------------ */
/* 1. prune                                                            */
/* ------------------------------------------------------------------ */

const fx = buildFixture();
const chunksDir = join(fx.stateDir, "streams", "chunks");
const opts = { stateDir: fx.stateDir, runsDir: fx.runsDir, graceMs: HOUR, now: fx.now };
const ids = (list: { id: string }[]) => list.map((p) => p.id).sort();

console.log("\n[1] prune —— dry-run 只报告，不动盘");
const dry = planPrune({ ...opts, apply: false });
eq("扫到 4 个流", dry.scanned, 4);
check(
  "可删 = 已完成流 + 孤儿流",
  JSON.stringify(ids(dry.prunable)) === JSON.stringify(["strm_DONE_user", "strm_ORPHAN_user"]),
  `实际 ${JSON.stringify(ids(dry.prunable))}`,
);
eq("dry-run 未删任何东西", dry.deleted.length, 0);
eq("dry-run 释放量为 0", dry.freedBytes, 0);
check("dry-run 报出可释放量 > 0", dry.prunableBytes > 0, `实际 ${dry.prunableBytes}`);
check("四个流目录全部还在", [
  "strm_DONE_user",
  "strm_ACTIVE_user",
  "strm_PENDING_user",
  "strm_ORPHAN_user",
].every((d) => existsSync(join(chunksDir, d))));

const keepReason = (id: string) => dry.kept.find((k) => k.id === id)?.reason;
eq("活跃流的保留理由 = active-window", keepReason("strm_ACTIVE_user"), "active-window");
eq("归属 run 未终态的保留理由 = run-not-terminal", keepReason("strm_PENDING_user"), "run-not-terminal");

console.log("\n[2] prune —— --apply 只删够格的");
const applied = planPrune({ ...opts, apply: true });
check(
  "实际删除 = 已完成流 + 孤儿流",
  JSON.stringify([...applied.deleted].sort()) === JSON.stringify(["strm_DONE_user", "strm_ORPHAN_user"]),
  `实际 ${JSON.stringify(applied.deleted)}`,
);
check("已完成流目录已消失", !existsSync(join(chunksDir, "strm_DONE_user")));
check("孤儿流目录已消失", !existsSync(join(chunksDir, "strm_ORPHAN_user")));
check("活跃流目录纹丝不动", existsSync(join(chunksDir, "strm_ACTIVE_user")));
check("归属 run 未终态的流纹丝不动", existsSync(join(chunksDir, "strm_PENDING_user")));
check("释放量 > 0 且已统计", applied.freedBytes > 0, `实际 ${applied.freedBytes}`);
check("events/steps/hooks 不在删除面内", !existsSync(join(fx.stateDir, "events", "deleted")));

console.log("\n[3] prune —— 再跑一次是幂等的（没有可删的了）");
const again = planPrune({ ...opts, apply: true });
eq("第二次没有任何可删", again.deleted.length, 0);
eq("剩下 2 个流", again.scanned, 2);

rmSync(fx.root, { recursive: true, force: true });

/* ------------------------------------------------------------------ */
/* 2. rebuildRunsIndex                                                 */
/* ------------------------------------------------------------------ */

console.log("\n[4] rebuildRunsIndex —— 对真实 runs/");
const realRunDirs = readdirSync(RUNS_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory() && RUN_ID_RE.test(e.name))
  .map((e) => e.name);

const { rebuildRunsIndex, readRunsIndex } = await import("../lib/runsIndex.ts");
const built = rebuildRunsIndex();
eq("索引条目数 == 真实 run 目录数", built.count, realRunDirs.length);
check("index.json 已落盘", existsSync(built.path));

const readBack = readRunsIndex(500);
check("读回来不是 null", readBack !== null);
eq("读回条目数一致", readBack?.length ?? -1, realRunDirs.length);
check(
  "读回的 id 集合与磁盘一致",
  JSON.stringify((readBack ?? []).map((r) => r.id).sort()) === JSON.stringify([...realRunDirs].sort()),
);

console.log("\n[5] rebuildRunsIndex —— 损坏的 meta.json 不炸");
const tmpRoot = mkdtempSync(join(tmpdir(), "luup-runsindex-"));
const bad = join(tmpRoot, "runs", "20260101-000000");
mkdirSync(bad, { recursive: true });
writeFileSync(join(bad, "meta.json"), "{ this is not json", "utf8"); // 半截 JSON
writeFileSync(join(bad, "question.md"), "问题：坏 meta 的 run\n", "utf8");
const good = join(tmpRoot, "runs", "20260102-000000");
mkdirSync(good, { recursive: true });
writeJson(join(good, "meta.json"), { questionId: 7, startedAt: new Date().toISOString(), exitCode: 0 });
writeFileSync(join(good, "verification-report.md"), "结果: ALL PASS\n", "utf8");

// LUUP_REPO_ROOT 在 lib/paths.ts 的模块加载期读取 —— 换根必须换进程
const child = spawnSync(
  process.execPath,
  [
    "-e",
    'const m = await import(process.argv[1]); const r = m.rebuildRunsIndex(); console.log("COUNT=" + r.count);',
    join(REPO_ROOT, "lib", "runsIndex.ts"),
  ],
  { env: { ...process.env, LUUP_REPO_ROOT: tmpRoot }, encoding: "utf8" },
);
eq("子进程正常退出（没被损坏 meta 炸掉）", child.status, 0);
check("两个 run 都被计入（坏 meta 的那个也算）", /COUNT=2/.test(child.stdout ?? ""), `stdout=${child.stdout}\n${child.stderr}`);
check("临时仓库里生成了 index.json", existsSync(join(tmpRoot, "runs", "index.json")));

rmSync(tmpRoot, { recursive: true, force: true });

/* ------------------------------------------------------------------ */

console.log(`\n[selftest-retention] ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
