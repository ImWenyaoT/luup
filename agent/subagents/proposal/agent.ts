import { defineAgent } from "eve";

import { ProposalSchema } from "../../lib/contracts.ts";
import { QWEN_CONTEXT_WINDOW_TOKENS, qwenModel } from "../../lib/model.ts";

/**
 * W 节点：研究计划撰写。
 * 不开思考——产出被 outputSchema 完全约束，token 应烧在字段内容而非推理上。
 * `outputSchema` 让本节点在 task mode 下直接返回结构化 JSON，master 拿到即可落盘，
 * 无需再解析自由文本（能力图谱 V5 已验证 outputSchema 在 Qwen 上出结构化 JSON）。
 */
export default defineAgent({
  description:
    "Research plan writer. Given the question, the fact cards, the winning hypothesis and the critic's " +
    "mandatory revisions, emits the 10-field 《科学假设与研究计划》 as structured JSON matching the project " +
    "contract. References may only use arXiv ids that appear in the fact cards.",
  model: qwenModel(),
  modelContextWindowTokens: QWEN_CONTEXT_WINDOW_TOKENS,
  /**
   * 熔断器（机制层，不靠 prompt）：单节点跑飞时按 SESSION_TOKEN_LIMIT_REACHED
   * 直接失败，master 按「预算耗尽被截断」升级处理，而不是无声烧钱。
   * W 一次性出结构化 JSON。
   */
  limits: { maxInputTokensPerSession: 2_000_000 },
  outputSchema: ProposalSchema,
});
