import { defineAgent } from "eve";

import { QWEN_CONTEXT_WINDOW_TOKENS, qwenModel } from "../../lib/model.ts";

/**
 * L 节点：文献挖掘。DAG 的唯一外部事实入口。
 * 不开思考——本节点的工作是检索与摘录，token 应烧在多轮 arXiv 调用上而非推理。
 */
export default defineAgent({
  description:
    "Literature miner. Given a scientific question, searches arXiv from multiple angles, saves the most " +
    "relevant papers into this run's literature memory, and returns fact cards (claim + arXiv id + relevance). " +
    "Every claim is grounded in a real abstract; it never invents papers.",
  model: qwenModel(),
  modelContextWindowTokens: QWEN_CONTEXT_WINDOW_TOKENS,
  /**
   * 熔断器（机制层，不靠 prompt）：单节点跑飞时按 SESSION_TOKEN_LIMIT_REACHED
   * 直接失败，master 按「预算耗尽被截断」升级处理，而不是无声烧钱。
   * L 要多轮检索，给的额度最宽。
   */
  limits: { maxInputTokensPerSession: 3_000_000 },
});
