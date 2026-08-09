/**
 * 「当前是哪一次 run」的唯一答案：run 目录 + Science-125 题号。
 *
 * 两者同源同理由 —— 都由外层驱动（`scripts/run.ts` / `lib/spawn.ts`）在起进程时
 * 经环境变量给定，**都不作为工具入参**。题号原先是 `memory_note` 的模型入参：模型
 * 可以把本题的战役记录写到别的题页去，或者干脆报错记不住；收编进来之后
 * `LUUP_QUESTION_ID` 全仓只有这一个读点，模型可控面关闭。
 *
 * runDir 通过环境变量 `LUUP_RUN_DIR` 传递，**不作为工具入参**：
 *  1. eve 的 tool 跑在 app runtime，`process.env` 全量可读（docs/tools/overview.mdx），
 *     而 sandbox 才是隔离的 —— 环境变量是这里最自然的进程级配置通道。
 *  2. 引用真实性防线要求「papers/ 只装本次运行实检命中的文献」。若 runDir 是入参，
 *     模型就能把 run 目录指向历史 run 或任意路径，B1 的「本次运行」语义当场失效。
 *     把它移出模型可控面，是 schema/机制层的约束，不是 prompt 层的约定。
 *  3. 外层驱动（eve invoke / 脚本）本来就要先建 runs/<ts>/ 再触发，顺手 export 即可。
 *
 * 时间戳不在这里造：run id 的生成/校验/解析同址在 `lib/runId.ts`，`scripts/run.ts`
 * 建目录、这里造回退目录用的必须是同一份实现，否则两处会生成对不上的 run id。
 */
import { join, resolve } from "node:path";
import { REPO_ROOT } from "../../lib/paths.ts";
import { utcStamp } from "../../lib/runId.ts";

export const RUN_DIR_ENV = "LUUP_RUN_DIR";
export const QUESTION_ID_ENV = "LUUP_QUESTION_ID";

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

/**
 * 本次 run 的 Science-125 题号。**`LUUP_QUESTION_ID` 的唯一读点** —— app runtime
 * （memory_note / arxiv_save 的反向索引）与驱动侧（`scripts/run.ts` 写 meta.json）
 * 都调它，两边对同一个环境变量不会给出两个答案。
 *
 * 不合法或未设一律 null —— 直接手跑的 run 本来就没有题号，那不是错误，只是没有题页可写。
 */
export function resolveQuestionId(raw = process.env[QUESTION_ID_ENV]): number | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const n = Number.parseInt(s, 10);
  return Number.isInteger(n) && n >= 1 && n <= 125 ? n : null;
}
