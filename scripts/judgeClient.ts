/**
 * M9 / M10 的 judge 调用适配器（**唯一**一处评估层的模型调用）。
 *
 * 三件事必须在 import `#lib/model.ts` **之前**做完，所以这里用顶层 await + 动态 import：
 *
 *  1. **加载 .env**。`agent/lib/model.ts` 在模块初始化时就把 `QWEN_BASE_URL` /
 *     `QWEN_API_KEY` 读进 provider，晚一步读就是空串。pipeline 走 `npx eve invoke`
 *     由 eve 加载 .env，独立脚本没有这一层。
 *  2. **把 `LUUP_RUN_DIR` 指到 `runs/.eval/`**。teeUsage 会把每次调用的 usage 落到
 *     这个目录；不改的话 judge 的 token 会算进被评估 run 的成本账（M6 立刻失真），
 *     或者更糟 —— 回退目录会在 `runs/` 下凭空造出一个看起来像真 run 的目录。
 *     `.eval` 点开头，过不了 `isRunId`，所有 run 扫描器都会跳过它。
 *  3. **不设 `LUUP_QUESTION_ID`**。题页定位由调用方显式传题号（从 meta.json 读），
 *     评估脚本不冒充一次 run。
 *
 * judge 也是 Qwen（criteria D1 锁死模型族）。同族自评偏置无法用换族 judge 消解，
 * 处置是结构性降权（分数不进 gate）+ M10 变异体校准，不假装校准过。
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { generateText } from "ai";
import type { JudgeRequest } from "../lib/scoring.ts";
import { EVAL_DIR, REPO_ROOT } from "../lib/paths.ts";

try {
  process.loadEnvFile(join(REPO_ROOT, ".env"));
} catch {
  // .env 不存在时不报错：环境变量也可能已经由外层注入
}

if (!process.env.QWEN_API_KEY || !process.env.QWEN_BASE_URL) {
  console.error("[luup] 缺 QWEN_API_KEY / QWEN_BASE_URL（.env 或环境变量），judge 无法调用。");
  process.exit(2);
}

mkdirSync(EVAL_DIR, { recursive: true });
// 评估层的用量单独记账，绝不混进被评估 run 的 usage.jsonl
process.env.LUUP_RUN_DIR = EVAL_DIR;

const { qwenModel, QWEN_DEFAULT_MODEL_ID } = await import("#lib/model.ts");

export const JUDGE_MODEL_ID = QWEN_DEFAULT_MODEL_ID;
/** judge 开思考：评分要读全文做归因，关思考实测会退化成「看起来还行」式打分。 */
export const JUDGE_THINKING = true;

/** 端点并发阈值低（实测），评估调用一律串行；超时给足，思考链很慢。 */
const TIMEOUT_MS = 600_000;

export type JudgeReply = { text: string; ms: number };

export async function askJudge(req: JudgeRequest, label: string): Promise<JudgeReply> {
  const started = Date.now();
  process.stderr.write(`[luup:judge] ${label} …`);
  const { text } = await generateText({
    model: qwenModel({ thinking: JUDGE_THINKING }),
    system: req.system,
    prompt: req.prompt,
    timeout: TIMEOUT_MS,
  });
  const ms = Date.now() - started;
  process.stderr.write(` ${(ms / 1000).toFixed(1)}s，${text.length} 字\n`);
  return { text, ms };
}
