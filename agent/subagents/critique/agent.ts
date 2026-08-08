import { defineAgent } from "eve";

import { CritiqueSchema } from "../../lib/contracts.ts";
import { QWEN_CONTEXT_WINDOW_TOKENS, qwenModel } from "../../lib/model.ts";

/**
 * C 节点：批判。开思考，且**必须带工具**——纯 prompt 批判无信息增量
 * （architecture.md 角色表，书 ch10 表 10-2）。
 */
export default defineAgent({
  description:
    "Adversarial critic. Assumes every candidate hypothesis is wrong, trivial or already published: it " +
    "actually re-searches arXiv for prior art, audits each derivation step against the cited fact cards, " +
    "and judges feasibility. Returns >=3 substantive critiques per hypothesis, a winning hypothesis, and a " +
    "mandatory revision list for the plan writer.",
  model: qwenModel({ thinking: true }),
  modelContextWindowTokens: QWEN_CONTEXT_WINDOW_TOKENS,
  /**
   * 熔断器（机制层，不靠 prompt）：单节点跑飞时按 SESSION_TOKEN_LIMIT_REACHED
   * 直接失败，master 按「预算耗尽被截断」升级处理，而不是无声烧钱。
   * C 要反查 arXiv，比 H 略宽。
   */
  limits: { maxInputTokensPerSession: 2_500_000 },
  /**
   * C→W handoff 的结构化防线：胜出假设与强制修改要求是 W 的必需输入，
   * 用自由文本传递就得让 master 去正则捞。task mode 直接返回结构化 JSON，
   * master 原样落盘 `critique.json`，判据「每假设 ≥3 条批判」由 schema 基数兜底。
   */
  outputSchema: CritiqueSchema,
});
