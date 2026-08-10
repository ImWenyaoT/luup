/**
 * M9 / M10 的 judge 调用适配器（**唯一**一处评估层的模型调用）。
 *
 * 两件事必须在 import `#lib/model.ts` 的 client **被使用之前**做完：
 *
 *  1. **加载 .env**。`lib/agents/model.ts` 的 client 是懒构造的（首次调用才读
 *     `QWEN_BASE_URL` / `QWEN_API_KEY`），但独立脚本没有任何外层代劳加载 .env，
 *     必须自己来。
 *  2. **把 `LUUP_RUN_DIR` 指到 `runs/.eval/`**。teeUsage 会把每次调用的 usage 落到
 *     这个目录；不改的话 judge 的 token 会算进被评估 run 的成本账（M6 立刻失真），
 *     或者更糟 —— 回退目录会在 `runs/` 下凭空造出一个看起来像真 run 的目录。
 *     `.eval` 点开头，过不了 `isRunId`，所有 run 扫描器都会跳过它。
 *  3. **不设 `LUUP_QUESTION_ID`**。题页定位由调用方显式传题号（从 meta.json 读），
 *     评估脚本不冒充一次 run。
 *
 * 调用走 `qwenClient(thinking).responses.create`（openai SDK 直连，criteria D2：
 * responses 协议）——judge 是单发问答，不需要 agent 循环，不经 @openai/agents。
 *
 * judge 也是 Qwen（criteria D1 锁死模型族）。同族自评偏置无法用换族 judge 消解，
 * 处置是结构性降权（分数不进 gate）+ M10 变异体校准，不假装校准过。
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
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

const { qwenClient } = await import("#lib/agents/model.ts");

/**
 * judge 档位。**写死成字面量，不继承 `QWEN_DEFAULT_MODEL_ID`** —— 这是刻意的：
 * `qwenModel` 的默认档现在可被 `LUUP_MODEL_ID` 覆盖（救援通道，见 lib/agents/model.ts），
 * 若 judge 隐式吃默认档，一次救援批跑就会顺手把判分器也换档，救援轮的分与主批不再可比。
 * 显式传档 + 字面量 = 判分器档位由这一行独占声明，环境变量碰不到。
 *
 * **3.8-max 校准实验 2026-08-09 中止**（单次调用 ~6 分钟，超出旧的 600s 判分超时，
 * 六次调用的检出率表跑不完）。无校准数据 → 预写的「检出 ≥3/4 才升档」规则无从执行，
 * 档位按替补判据回落 3.7-plus：慢且未证准是最差组合，而 M9 本就是 advisory（不进 gate），
 * 同族自评偏置的天花板也不因换档消失。若 M9 判别力将来成为承重项再重启该实验，
 * 重启入口 = `scripts/calibrate-judge.ts`。
 */
export const JUDGE_MODEL_ID = "qwen3.7-plus";
/** judge 开思考：评分要读全文做归因，关思考实测会退化成「看起来还行」式打分。 */
export const JUDGE_THINKING = true;

/** 端点并发阈值低（实测），评估调用一律串行；超时给足，思考链很慢。 */
const TIMEOUT_MS = 600_000;

export type JudgeReply = { text: string; ms: number };

export async function askJudge(req: JudgeRequest, label: string): Promise<JudgeReply> {
  const started = Date.now();
  process.stderr.write(`[luup:judge] ${label} …`);
  const response = await qwenClient(JUDGE_THINKING).responses.create(
    {
      model: JUDGE_MODEL_ID,
      instructions: req.system,
      input: req.prompt,
    },
    { timeout: TIMEOUT_MS },
  );
  const text = response.output_text;
  const ms = Date.now() - started;
  process.stderr.write(` ${(ms / 1000).toFixed(1)}s，${text.length} 字\n`);
  return { text, ms };
}
