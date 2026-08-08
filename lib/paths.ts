import { existsSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

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
 *     fixtures/science125.json」来判别这件事，而不是猜运行环境。
 *     next dev/build/start 与 eve 的 cwd 都是仓库根，退到 ③ 是对的。
 */
function detectRepoRoot(): string {
  try {
    const fromModule = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    if (existsSync(join(fromModule, "fixtures", "science125.json"))) return fromModule;
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
export const SCIENCE125_FILE = join(REPO_ROOT, "fixtures", "science125.json");
export const LOCK_FILE = join(RUNS_DIR, ".active.json");
/** 派生缓存，不是真相：删掉它一切照常，只是 /api/runs 退回全量扫盘。 */
export const RUNS_INDEX_FILE = join(RUNS_DIR, "index.json");

export const RUN_ID_RE = /^\d{8}-\d{6}$/;

export function isRunId(value: unknown): value is string {
  return typeof value === "string" && RUN_ID_RE.test(value);
}

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
