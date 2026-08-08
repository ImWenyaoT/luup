import { join, resolve, sep } from "node:path";

/**
 * 仓库根定位。withEve() 单项目布局下 next dev / next build 的 cwd 就是仓库根。
 * 一切文件访问都从这里派生——绝不接受来自请求的绝对路径。
 */
export const REPO_ROOT = process.env.LUUP_REPO_ROOT ?? resolve(process.cwd());
export const RUNS_DIR = join(REPO_ROOT, "runs");
/** runs/ 之外唯一的读点，硬编码，不接受参数。 */
export const SCIENCE125_FILE = join(REPO_ROOT, "fixtures", "science125.json");
export const LOCK_FILE = join(RUNS_DIR, ".active.json");

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
