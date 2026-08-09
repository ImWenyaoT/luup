import { existsSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { isRunId } from "./runId.ts";

/**
 * 仓库根的**唯一**定义点（web、scripts/**、agent/ 全都从这里取，不再各自
 * `resolve(import.meta.dirname, "..")` 手抄）。三级判定，按可信度排序：
 *
 *  1. `LUUP_REPO_ROOT`：显式换根（selftest 拿临时仓库做破坏性断言时用）。
 *  2. 本文件所在的 `<root>/lib/` 的上一级。`node scripts/xxx.ts` 直跑时
 *     `import.meta.url` 就是源文件路径，因此**与 cwd 无关** —— 脚本从任何目录
 *     启动都指向同一个仓库根。
 *  3. `process.cwd()`。打包器（next build / eve build）会把本文件重写进
 *     `.next/` 或 `.eve/`，届时 ② 指向产物目录而不是仓库；用「上一级有没有
 *     agent/instructions.md」来判别这件事，而不是猜运行环境。
 *     next dev/build/start 与 eve 的 cwd 都是仓库根，退到 ③ 是对的。
 */
function detectRepoRoot(): string {
  try {
    const fromModule = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    if (existsSync(join(fromModule, "agent", "instructions.md"))) return fromModule;
  } catch {
    /* import.meta.url 不可用的打包形态：退到 cwd */
  }
  return resolve(process.cwd());
}

/**
 * 一切文件访问都从这里派生——绝不接受来自请求的绝对路径。
 */
export const REPO_ROOT = process.env.LUUP_REPO_ROOT ?? detectRepoRoot();
export const RUNS_DIR = join(REPO_ROOT, "runs");
/** runs/ 之外唯一的读点，硬编码，不接受参数。 */
export const LOCK_FILE = join(RUNS_DIR, ".active.json");
/** 派生缓存，不是真相：删掉它一切照常，只是 /api/runs 退回全量扫盘。 */
export const RUNS_INDEX_FILE = join(RUNS_DIR, "index.json");
/** Tier1 指标报告（scripts/stats.ts 写）。同样是派生物，删了重跑即可。 */
export const RUNS_STATS_FILE = join(RUNS_DIR, "stats.md");
/**
 * 评估层自己的 run 目录。**点开头 → 过不了 `isRunId`**，因此不会被 listRunIds /
 * readAllRunMetrics 当成一次真实 run —— 这正是它叫 `.eval` 的原因：
 * judge 调用的 token 用量（`agent/lib/model.ts` 的 teeUsage 按 `LUUP_RUN_DIR` 落盘）
 * 必须与被评估 run 的成本账分开，否则 M6 会把评估开销算进流水线开销。
 */
export const EVAL_DIR = join(RUNS_DIR, ".eval");

/** 越界访问是编程/攻击错误，不是数据错误——单独一类，路由层映射成 400。 */
export class BoundaryError extends Error {
  constructor(attempted: string) {
    super(`path escapes sandbox: ${attempted}`);
    this.name = "BoundaryError";
  }
}

/**
 * 唯一允许的路径拼接。resolve 之后必须仍在 base 之下，否则抛。
 * `..`、绝对路径、符号链接式的字符串都在这里被挡住。
 */
export function safeJoin(base: string, ...parts: string[]): string {
  const target = resolve(base, ...parts);
  if (target !== base && !target.startsWith(base + sep)) throw new BoundaryError(parts.join("/"));
  return target;
}

export function runDir(id: string): string {
  if (!isRunId(id)) throw new BoundaryError(id);
  return safeJoin(RUNS_DIR, id);
}
