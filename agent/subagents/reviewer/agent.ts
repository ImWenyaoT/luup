import { defineAgent } from "eve";

import { ReviewSchema } from "../../lib/contracts.ts";
import { QWEN_CONTEXT_WINDOW_TOKENS, qwenModel } from "../../lib/model.ts";

export default defineAgent({
  description:
    "Independent reviewer. Re-searches arXiv for prior art and counterevidence, checks whether the proposed " +
    "experiment can falsify the hypothesis, and returns pass or a concrete one-time revision list.",
  model: qwenModel({ thinking: true }),
  modelContextWindowTokens: QWEN_CONTEXT_WINDOW_TOKENS,
  /**
   * 熔断器（机制层，不靠 prompt）：单节点跑飞时按 SESSION_TOKEN_LIMIT_REACHED
   * 直接失败，master 按「预算耗尽被截断」升级处理，而不是无声烧钱。
   * C 要反查 arXiv，比 H 略宽。
   */
  limits: { maxInputTokensPerSession: 2_500_000 },
  outputSchema: ReviewSchema,
});
