/**
 * 单并发锁自测（零 API、零网络）。
 *
 *   node scripts/selftest-lock.ts
 *
 * 两件事：
 *
 * 1. **锁本身**：拿锁 / 撞锁 / 陈旧接管 / 归属释放 / 父进程认领。全在本进程内，
 *    换根到临时仓库（LUUP_REPO_ROOT）做破坏性断言。
 * 2. **两个 adapter 真的共用这一把锁**：直接起 `scripts/run.ts`，第二个实例必须退 2
 *    并打印占用者。这一条只有起真进程才作数 —— 单进程里连调两次 acquire 证明不了
 *    CLI 入口接上了锁。
 *
 * 怎么做到零 API：换根 + 把 PATH 的第一项换成一个假的 `npx`（睡几秒就退）。run.ts 只
 * 经由 `npx eve invoke` 花钱，换掉它之后建目录、持锁、收尾、放锁这条命全程照跑，锁的
 * 生命周期与真跑一模一样。**不为测试往 run.ts 里加任何开关。**
 */
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { check, eq, report } from "./selftestHarness.ts";

/* LUUP_REPO_ROOT 在 lib/paths.ts 的模块加载期读取 —— 必须先设好再 import。 */
const root = mkdtempSync(join(tmpdir(), "luup-lock-"));
process.env.LUUP_REPO_ROOT = root;
const { LOCK_PID_ENV, acquire, activeRunId, isAlive, parentHoldsLock, readLock } = await import("../lib/lock.ts");
const { deriveStatus, scanDir } = await import("../lib/phase.ts");

const RUN_SCRIPT = join(import.meta.dirname, "run.ts");
const RUNS = join(root, "runs");
const LOCK_FILE = join(RUNS, ".active.json");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function writeRawLock(lock: Record<string, unknown> | string): void {
  mkdirSync(RUNS, { recursive: true });
  writeFileSync(LOCK_FILE, typeof lock === "string" ? lock : JSON.stringify(lock, null, 2), "utf8");
}

/** 一个必然已经死掉的 pid：起一个立刻退出的进程，拿它的号。 */
const deadPid = spawnSync(process.execPath, ["-e", ""]).pid ?? -1;

/* ------------------------------------------------------------------ */
/* 1. 拿锁 / 撞锁 / 回填                                                 */
/* ------------------------------------------------------------------ */

console.log("\n[1] 拿锁 —— 第二个申请者拿到的是持有者，不是队列");
const first = acquire();
check("空仓库里拿得到锁", first.ok);
if (!first.ok) process.exit(1);
check("锁文件落盘", existsSync(LOCK_FILE));
eq("锁记的是自己的 pid", readLock()?.pid, process.pid);
eq("还没回填 run 目录时 activeRunId 是 null", activeRunId(), null);

const denied = acquire();
check("再拿一次拿不到", !denied.ok);
eq("拿不到时给出持有者的 pid", denied.ok ? -1 : denied.holder.pid, process.pid);

const RUN_A = "20200101-000000";
first.setRunId(RUN_A);
eq("回填后 activeRunId 就是那个 run", activeRunId(), RUN_A);
const deniedAfterFill = acquire();
eq("持有者信息里也带上了 run", deniedAfterFill.ok ? null : deniedAfterFill.holder.runId, RUN_A);

/* ------------------------------------------------------------------ */
/* 2. 归属：只删自己的那把                                                */
/* ------------------------------------------------------------------ */

console.log("\n[2] 释放 —— 迟到的释放不能删掉下一个 run 的锁");
writeRawLock({ runId: "20200102-000000", pid: process.pid, startedAt: new Date().toISOString() });
eq("锁上换了别的 runId：不删", first.release(), false);
check("锁还在", existsSync(LOCK_FILE));

writeRawLock({ runId: RUN_A, pid: 1, startedAt: new Date().toISOString() });
eq("锁是别的活进程的：不删", first.release(), false);
check("锁还在", existsSync(LOCK_FILE));

writeRawLock({ runId: RUN_A, pid: process.pid, startedAt: new Date().toISOString() });
eq("确实是自己的那把：删", first.release(), true);
check("锁文件没了", !existsSync(LOCK_FILE));
eq("重复释放是 no-op", first.release(), false);

/* ------------------------------------------------------------------ */
/* 3. 陈旧锁：进程死了，锁不该跟着占位                                     */
/* ------------------------------------------------------------------ */

console.log("\n[3] 陈旧锁 —— 自动接管");
check("拿来当死 pid 的那个号确实死了", !isAlive(deadPid), `pid=${deadPid}`);
writeRawLock({ runId: "20200103-000000", pid: deadPid, startedAt: new Date().toISOString() });
eq("死进程的锁不算活跃 run", activeRunId(), null);
check("读的时候就顺手清掉了", !existsSync(LOCK_FILE));

writeRawLock({ runId: "20200103-000000", pid: deadPid, startedAt: new Date().toISOString() });
const takeover = acquire();
check("死进程的锁能被接管", takeover.ok);
eq("接管后锁归自己", readLock()?.pid, process.pid);
if (takeover.ok) takeover.release();

writeRawLock("{ 这不是 JSON");
const overBroken = acquire();
check("写坏的锁同样按陈旧处理", overBroken.ok);
if (overBroken.ok) overBroken.release();

/* ------------------------------------------------------------------ */
/* 4. 父进程认领：web 起的子进程不跟父进程抢锁                             */
/* ------------------------------------------------------------------ */

console.log("\n[4] parentHoldsLock —— 环境变量伪造不出一把锁");
eq("没有锁时不认", parentHoldsLock({ [LOCK_PID_ENV]: String(process.pid) }), false);

const parent = acquire();
check("父进程拿到锁", parent.ok);
if (!parent.ok) process.exit(1);
eq("pid 对得上：认领", parentHoldsLock({ [LOCK_PID_ENV]: String(process.pid) }), true);
eq("pid 对不上：不认（那是别人的锁）", parentHoldsLock({ [LOCK_PID_ENV]: "1" }), false);
eq("没给 pid：不认", parentHoldsLock({}), false);
eq("给了个不是数字的：不认", parentHoldsLock({ [LOCK_PID_ENV]: "yes" }), false);

/* ------------------------------------------------------------------ */
/* 5. 锁 → 状态：activeRunId 就是 deriveStatus 的那个入参                  */
/* ------------------------------------------------------------------ */

console.log("\n[5] running 态的唯一来源");
const dir = join(RUNS, RUN_A);
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "question.md"), "Q\n", "utf8");
const scan = scanDir(dir);
parent.setRunId(RUN_A);
eq("持锁的 run 是 running", scan ? deriveStatus(scan, activeRunId()) : null, "running");
parent.release();
eq("锁一放，同一个目录就回到 stale（中断残留）", scan ? deriveStatus(scan, activeRunId()) : null, "stale");
rmSync(dir, { recursive: true, force: true });

/* ------------------------------------------------------------------ */
/* 6. 两个真进程：CLI 入口确实接在这把锁上                                 */
/* ------------------------------------------------------------------ */

console.log("\n[6] scripts/run.ts —— 第二个实例退 2 并打印占用者");

/** 假 npx：run.ts 唯一花钱的地方是 `npx eve invoke`，换成睡几秒就退。 */
const binDir = join(root, "bin");
mkdirSync(binDir, { recursive: true });
const fakeNpx = join(binDir, "npx");
writeFileSync(fakeNpx, "#!/bin/sh\nsleep 6\nexit 0\n", "utf8");
chmodSync(fakeNpx, 0o755);

const childEnv: NodeJS.ProcessEnv = { ...process.env, LUUP_REPO_ROOT: root, PATH: `${binDir}:${process.env.PATH ?? ""}` };
delete childEnv[LOCK_PID_ENV]; // 我们不是谁的父进程，两个孩子都得自己拿锁

const QUESTION = "这是一道只用于锁自测的假问题，不会调用任何模型。";
const runIds = () => readdirSync(RUNS, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);

const a: ChildProcess = spawn(process.execPath, [RUN_SCRIPT, QUESTION], { env: childEnv, stdio: "ignore" });
const exitA = new Promise<number>((res) => a.on("close", (code) => res(code ?? -1)));

let holder = readLock();
for (const deadline = Date.now() + 10_000; Date.now() < deadline && holder?.runId == null; ) {
  await sleep(50);
  holder = readLock();
}
check("run.ts 起来就拿了锁并回填了 run 目录", holder?.runId != null, `lock=${JSON.stringify(holder)}`);
eq("锁记的是 run.ts 自己的 pid", holder?.pid, a.pid);

const b = spawnSync(process.execPath, [RUN_SCRIPT, QUESTION], { env: childEnv, encoding: "utf8" });
eq("第二个实例退 2", b.status, 2);
check("打印了占用者的 run", (b.stderr ?? "").includes(holder?.runId ?? " "), `stderr=${b.stderr}`);
check("打印了占用者的 pid", (b.stderr ?? "").includes(`pid=${a.pid}`), `stderr=${b.stderr}`);
eq("撞锁的实例没有留下空 run 目录", runIds().length, 1);

const codeA = await exitA;
eq("第一个实例正常收尾（没产出 proposal，退 1）", codeA, 1);
check("退出时把锁放了", !existsSync(LOCK_FILE), `残留 ${JSON.stringify(readLock())}`);

console.log("\n[7] web 入口的交接 —— 子进程认领父进程的锁，不抢也不放");
const web = acquire(); // 扮演 server 进程：POST /api/runs 先拿锁，再起 run.ts
check("扮演 web 入口先拿到锁", web.ok);
const handoff = spawnSync(process.execPath, [RUN_SCRIPT, QUESTION], {
  env: { ...childEnv, [LOCK_PID_ENV]: String(process.pid) },
  encoding: "utf8",
});
eq("子进程没有跟父进程抢锁（不是退 2）", handoff.status, 1);
eq("它照常建了自己的 run 目录", runIds().length, 2);
eq("锁仍然在父进程手里 —— 谁拿的谁放", readLock()?.pid, process.pid);
if (web.ok) web.release();

console.log("\n[8] 中断 —— SIGINT 之后锁不留残");
const c: ChildProcess = spawn(process.execPath, [RUN_SCRIPT, QUESTION], { env: childEnv, stdio: "ignore" });
const exitC = new Promise<number>((res) => c.on("close", (code, sig) => res(code ?? (sig ? 130 : -1))));
for (const deadline = Date.now() + 10_000; Date.now() < deadline && readLock()?.runId == null; ) await sleep(50);
check("第三个实例拿到了锁（前一个已经放干净）", readLock()?.pid === c.pid, `lock=${JSON.stringify(readLock())}`);
c.kill("SIGINT");
await exitC;
check("Ctrl-C 之后锁文件没了", !existsSync(LOCK_FILE), `残留 ${JSON.stringify(readLock())}`);

/* ------------------------------------------------------------------ */

rmSync(root, { recursive: true, force: true });
report("selftest-lock");
