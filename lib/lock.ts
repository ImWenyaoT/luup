import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { LOCK_FILE, RUNS_DIR } from "./paths.ts";

/**
 * **单并发锁：runs/.active.json —— 「谁在跑」的全系统唯一事实源。**
 *
 * 为什么必须单并发：百炼端点并发过载阈值低（实测），且 campaignMemory 是无锁的
 * read-modify-write（lib/agents/campaignMemory.ts 约束 4），两个 pipeline 同时写
 * library 会丢反向索引条目。
 *
 * ## 两个 adapter，一把锁
 *
 *   web  ── POST /api/runs 拿锁 → lib/spawn.ts 在子进程收尾时释放
 *   CLI  ── scripts/run.ts 启动时拿锁 → 进程退出时释放
 *
 * 锁只有一个 adapter 的时候它不是不变式，只是那个入口的自觉：收编前 CLI 完全不持锁，
 * web 与 CLI 之间随时能起两条流水线并发写 memory/，而 deriveStatus 读锁也就对 CLI
 * 的 run 失明（判成 stale）。两个入口都走这里之后，「同一时刻至多一个 pipeline」
 * 才是一条真的不变式。
 *
 * web 起的子进程正是 scripts/run.ts —— 它不该跟自己的父进程抢锁。父把自己的 pid 写进
 * `LUUP_LOCK_PID`，子用 `parentHoldsLock()` 认领（见那里：环境变量伪造不出一把锁）。
 *
 * 写入用 wx flag 保证原子；EEXIST 即视为占用。
 */
export type Lock = { runId: string | null; pid: number; startedAt: string };

/** 父进程持锁时传给子进程的 pid。 */
export const LOCK_PID_ENV = "LUUP_LOCK_PID";

const serialize = (lock: Lock) => `${JSON.stringify(lock, null, 2)}\n`;

function parse(raw: string): Lock | null {
  try {
    const v = JSON.parse(raw) as Partial<Lock>;
    if (typeof v.pid !== "number") return null;
    return {
      runId: typeof v.runId === "string" ? v.runId : null,
      pid: v.pid,
      startedAt: typeof v.startedAt === "string" ? v.startedAt : new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

/** kill(pid, 0)：ESRCH = 进程没了；EPERM = 存在但不归我们（仍算存活）。 */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** 锁不在、读不动、写坏了 —— 一律「没有锁」。读失败本身就是答案，不必先 existsSync 问一遍。 */
export function readLock(): Lock | null {
  try {
    return parse(readFileSync(LOCK_FILE, "utf8"));
  } catch {
    return null;
  }
}

/** 陈旧锁（写坏的 / pid 已死）当场清除。返回仍然有效的锁。 */
function readFresh(): Lock | null {
  const lock = readLock();
  if (lock !== null && isAlive(lock.pid)) return lock;
  rmSync(LOCK_FILE, { force: true });
  return null;
}

/** 当前活跃 run 的 id；锁存在但还没回填 runId 时返回 null。 */
export function activeRunId(): string | null {
  return readFresh()?.runId ?? null;
}

/**
 * 这个进程是否跑在父进程已经拿好的锁下。只有当锁**真的**还在 `LUUP_LOCK_PID` 那个
 * pid 手里才算数 —— 环境变量伪造不出一把锁，父进程死了也不算（readFresh 会清掉它，
 * 调用方随即自己去 acquire）。
 */
export function parentHoldsLock(env: Record<string, string | undefined> = process.env): boolean {
  const pid = Number.parseInt(env[LOCK_PID_ENV] ?? "", 10);
  return Number.isInteger(pid) && readFresh()?.pid === pid;
}

/** 拿到锁之后能做的两件事。归属信息封在闭包里，调用方无从伪造，也不必自报家门。 */
export type Held = {
  ok: true;
  /** 从 run 目录名回填；此后释放按新 runId 校验归属。 */
  setRunId(runId: string): void;
  /**
   * 释放 —— **只删自己的那把**。重复调用是 no-op，返回是否真的删了。
   *
   * 释放路径不止一条：spawn 的超时、error、close 三个回调在一次失败的启动里可能先后
   * 触发，web 路由的 catch 还会再补一次。无条件 `rmSync` 意味着一个迟到的释放能把
   * **下一个 run** 刚拿到的锁删掉，单并发保证当场失效（而且不报错）。归属比对把迟到的
   * 释放降级成 no-op：pid 不是自己的不删；锁上回填了别的 runId 也不删。
   */
  release(): boolean;
};

export type Denied = { ok: false; holder: Lock };

function held(mine: Lock): Held {
  const owner = { pid: mine.pid, runId: mine.runId };
  const stillMine = (): Lock | null => {
    const lock = readLock();
    if (lock === null || lock.pid !== owner.pid) return null;
    return lock.runId === null || lock.runId === owner.runId ? lock : null;
  };
  return {
    ok: true,
    setRunId(runId) {
      const lock = stillMine();
      if (!lock) return;
      owner.runId = runId;
      writeFileSync(LOCK_FILE, serialize({ ...lock, runId }), "utf8");
    },
    release() {
      if (!stillMine()) return false;
      rmSync(LOCK_FILE, { force: true });
      return true;
    },
  };
}

/** 拿锁。被占用时返回持有者：web 回 409，CLI 打印它并退 2。 */
export function acquire(): Held | Denied {
  mkdirSync(RUNS_DIR, { recursive: true });
  const mine: Lock = { runId: null, pid: process.pid, startedAt: new Date().toISOString() };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(LOCK_FILE, serialize(mine), { encoding: "utf8", flag: "wx" });
      return held(mine);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      const holder = readFresh();
      if (holder) return { ok: false, holder };
      // 陈旧锁已被 readFresh 清掉，重试一次
    }
  }
  // 两次都撞上、又两次都读不到持有者：说不出是谁，但确实没拿到
  return { ok: false, holder: readLock() ?? { runId: null, pid: -1, startedAt: new Date(0).toISOString() } };
}
