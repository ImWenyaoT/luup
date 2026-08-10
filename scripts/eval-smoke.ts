/**
 * 冒烟 eval（**一次真调用**，花小钱）：模型接线活着、master 能听懂「不要启动流水线」。
 *
 *   pnpm eval:smoke
 *
 * 廉价预检，跑在 eval:full 之前。用量落 runs/.eval/（与 judge 同一记账位），
 * 不冒充一次真实 run。
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { run } from "@openai/agents";
import { buildMasterAgent } from "#lib/agents/master.ts";
import { EVAL_DIR, REPO_ROOT } from "../lib/paths.ts";

try {
  process.loadEnvFile(join(REPO_ROOT, ".env"));
} catch {
  // .env 不存在时不报错：环境变量也可能已经由外层注入
}
if (!process.env.QWEN_API_KEY || !process.env.QWEN_BASE_URL) {
  console.error("[eval-smoke] 缺 QWEN_API_KEY / QWEN_BASE_URL，无法冒烟。");
  process.exit(2);
}
mkdirSync(EVAL_DIR, { recursive: true });
process.env.LUUP_RUN_DIR = EVAL_DIR;

const master = buildMasterAgent();
const started = Date.now();
const result = await run(
  master,
  "这是一次连通性检查：直接回复 LUUP-SMOKE-OK，不要调用任何工具，不要启动流水线。",
  { maxTurns: 2, signal: AbortSignal.timeout(120_000), reasoningItemIdPolicy: "omit" },
);
const elapsed = ((Date.now() - started) / 1000).toFixed(1);

const text = typeof result.finalOutput === "string" ? result.finalOutput : JSON.stringify(result.finalOutput ?? "");
const toolCalls = result.newItems.filter((i) => i.type.includes("tool_call")).length;
const usage = result.state.usage;

console.log(`[eval-smoke] 回复（${elapsed}s，in=${usage.inputTokens} out=${usage.outputTokens}）：${text.slice(0, 200)}`);

const okReply = text.includes("LUUP-SMOKE-OK");
const okNoTools = toolCalls === 0;
if (!okReply) console.error("[eval-smoke] ✘ 回复未含 LUUP-SMOKE-OK");
if (!okNoTools) console.error(`[eval-smoke] ✘ 误调用了 ${toolCalls} 次工具`);
console.log(`[eval-smoke] ${okReply && okNoTools ? "PASS" : "FAIL"}`);
process.exit(okReply && okNoTools ? 0 : 1);
