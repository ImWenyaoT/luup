import { defineAgent } from "eve";

import { QWEN_CONTEXT_WINDOW_TOKENS, qwenModel } from "./lib/model.ts";

/**
 * root agent = master（architecture.md「DAG」的 [M] 节点）。
 *
 * 开思考：master 的全部价值在于逐项对照判据审内容并定向打回，这是本流水线里
 * 唯一必须做严肃推理的角色。
 *
 * limits 是循环失控的最后一道闸（criteria C4）。注意 eve 把父的剩余配额按批次
 * 均分给并行 subagent，而本流水线的 subagent 是**串行**派工的，所以每个子节点
 * 都能拿到当时的全部剩余额度，不会被均分饿死。
 */
export default defineAgent({
  model: qwenModel({ thinking: true }),
  modelContextWindowTokens: QWEN_CONTEXT_WINDOW_TOKENS,
  compaction: { thresholdPercent: 0.8 },
  limits: {
    maxInputTokensPerSession: 20_000_000,
    maxOutputTokensPerSession: 2_000_000,
    sessionTimeoutMs: 2 * 60 * 60 * 1000,
  },
});
