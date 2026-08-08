import { defineAgent } from "eve";

import { QWEN_CONTEXT_WINDOW_TOKENS, qwenModel } from "../../lib/model.ts";

/**
 * H 节点：假设生成。开思考——推导链质量是本节点的唯一产出。
 */
export default defineAgent({
  description:
    "Hypothesis generator. Given a scientific question plus the literature fact cards, produces 2-3 falsifiable " +
    "candidate hypotheses, each with an explicit derivation chain over the cited fact cards. It reasons only " +
    "from the cards it was given and says 'insufficient evidence' rather than inventing premises.",
  model: qwenModel({ thinking: true }),
  modelContextWindowTokens: QWEN_CONTEXT_WINDOW_TOKENS,
  /**
   * 熔断器（机制层，不靠 prompt）：单节点跑飞时按 SESSION_TOKEN_LIMIT_REACHED
   * 直接失败，master 按「预算耗尽被截断」升级处理，而不是无声烧钱。
   * H 只推理一轮产物，额度收紧。
   */
  limits: { maxInputTokensPerSession: 2_000_000 },
});
