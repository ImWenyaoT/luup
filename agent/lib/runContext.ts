/**
 * 「当前是哪一次 run」的唯一答案。
 *
 * runDir 通过环境变量 `LUUP_RUN_DIR` 传递，**不作为工具入参**：
 *  1. eve 的 tool 跑在 app runtime，`process.env` 全量可读（docs/tools/overview.mdx），
 *     而 sandbox 才是隔离的 —— 环境变量是这里最自然的进程级配置通道。
 *  2. 引用真实性防线要求「papers/ 只装本次运行实检命中的文献」。若 runDir 是入参，
 *     模型就能把 run 目录指向历史 run 或任意路径，B1 的「本次运行」语义当场失效。
 *     把它移出模型可控面，是 schema/机制层的约束，不是 prompt 层的约定。
 *  3. 外层驱动（eve invoke / 脚本）本来就要先建 runs/<ts>/ 再触发，顺手 export 即可。
 *
 * 时间戳同址：run 目录名就是 `utcStamp()`，`scripts/run.ts` 建目录、paperStore 造
 * 回退目录用的必须是同一份实现，否则两处会生成对不上的 run id。
 */
import { join, resolve } from "node:path";
import { REPO_ROOT } from "../../lib/paths.ts";

export const RUN_DIR_ENV = "LUUP_RUN_DIR";

/** run id 的格式：UTC `YYYYMMDD-HHMMSS`（lib/paths.ts 的 RUN_ID_RE 认这个）。 */
export function utcStamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`
  );
}

let fallbackRunDir: string | null = null;

/**
 * 取当前 run 目录。未设 `LUUP_RUN_DIR` 时退化为进程内一次性创建的
 * `runs/<utc-ts>/`（每个进程只创建一次并记忆），保证 `eve dev` 手工试跑也能用，
 * 且同一进程内多次调用始终落在同一个 run 里。
 */
export function resolveRunDir(): string {
  const fromEnv = process.env[RUN_DIR_ENV]?.trim();
  if (fromEnv) return resolve(process.cwd(), fromEnv);
  if (fallbackRunDir) return fallbackRunDir;
  fallbackRunDir = join(REPO_ROOT, "runs", utcStamp());
  console.warn(`[luup] ${RUN_DIR_ENV} 未设置，本进程回退到 ${fallbackRunDir}`);
  return fallbackRunDir;
}
