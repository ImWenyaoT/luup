import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { LOCK_FILE, RUNS_DIR } from "./paths";

/**
 * 单并发锁：runs/.active.json。
 * 理由不是"怕并发 bug"，是百炼端点并发过载阈值低（run-batch.ts 已因此串行）。
 * 锁只有一份，写入用 wx flag 保证原子；EEXIST 即视为占用。
 */
export type Lock = { runId: string | null; pid: number; startedAt: string };

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

export function readLock(): Lock | null {
  if (!existsSync(LOCK_FILE)) return null;
  try {
    return parse(readFileSync(LOCK_FILE, "utf8"));
  } catch {
    return null;
  }
}

export function release(): void {
  rmSync(LOCK_FILE, { force: true });
}

/** 陈旧锁（写坏的 / pid 已死）自动清除。返回仍然有效的锁。 */
function readFresh(): Lock | null {
  const lock = readLock();
  if (!lock) {
    if (existsSync(LOCK_FILE)) release();
    return null;
  }
  if (!isAlive(lock.pid)) {
    release();
    return null;
  }
  return lock;
}

/** 当前活跃 run 的 id；锁存在但还没回填 runId 时返回 null（仍算占用，见 activeLock）。 */
export function activeRunId(): string | null {
  return readFresh()?.runId ?? null;
}

export function activeLock(): Lock | null {
  return readFresh();
}

/** 拿锁。成功返回 Lock；已被占用返回持有者（调用方回 409）。 */
export function acquire(): { ok: true; lock: Lock } | { ok: false; held: Lock } {
  mkdirSync(RUNS_DIR, { recursive: true });
  const mine: Lock = { runId: null, pid: process.pid, startedAt: new Date().toISOString() };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(LOCK_FILE, `${JSON.stringify(mine, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
      return { ok: true, lock: mine };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      const held = readFresh();
      if (held) return { ok: false, held };
      // 陈旧锁已被 readFresh 清掉，重试一次
    }
  }
  return { ok: false, held: readLock() ?? { runId: null, pid: -1, startedAt: new Date().toISOString() } };
}

/** 从 stdout 解析出 run 目录后回填。 */
export function setRunId(runId: string): void {
  const lock = readLock();
  if (!lock) return;
  writeFileSync(LOCK_FILE, `${JSON.stringify({ ...lock, runId }, null, 2)}\n`, "utf8");
}
