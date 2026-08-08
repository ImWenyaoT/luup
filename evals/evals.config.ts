import { defineEvalConfig } from "eve/evals";
import { qwenModel } from "#lib/model.ts";

export default defineEvalConfig({
  // judge 也走 Qwen（criteria D1：所有 LLM 调用走百炼）；judge 只用于打分，永不替换被测 agent
  judge: { model: qwenModel() },
  // 百炼端点并发过载阈值低（实测），eval 串行
  maxConcurrency: 1,
});
