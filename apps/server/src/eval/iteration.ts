import { z } from "zod";

import type { Review } from "../agent/contracts.ts";

/**
 * Reviewer 的评价口径由 Harness 持有，不进入模型 prompt。
 *
 * 三项 1–5 分分别覆盖科学价值、技术深度和应用潜力；它们描述“这个研究计划
 * 值不值得继续人工审查”，不把 Reviewer 分数当成科学发现或终态 gate。
 */
export const REVIEW_RUBRIC_VERSION = "review-v2" as const;
export const REVIEW_RUBRIC_RATIONALE =
  "三项分数分别覆盖科学价值、技术深度和应用潜力，用于记录迭代诊断，不替代人工科学审查。";

const evaluationActionSchema = z.enum(["accept", "revise", "stop"]);
const feedbackSourceSchema = z.enum(["auto", "human"]);

/** 一轮评价的持久化合同；空值表示当前事实不可用，不用 0 代替未知。 */
export const evaluationRoundSchema = z.object({
  evaluator: z.literal("model_reviewer"),
  target: z.literal("research-plan"),
  sample: z.literal("one run / one research plan"),
  sample_size: z.literal(1),
  rubric_version: z.enum(["review-v1", REVIEW_RUBRIC_VERSION]),
  scientific_rationale: z.literal(REVIEW_RUBRIC_RATIONALE),
  round: z.number().int().min(1).max(2),
  phase: z.enum(["raw", "revision"]),
  action: evaluationActionSchema,
  feedback_source: feedbackSourceSchema,
  feedback_artifact_id: z.string().min(1).nullable(),
  feedback_count: z.number().int().nonnegative(),
  raw_plan_artifact_id: z.string().min(1),
  raw_review_artifact_id: z.string().min(1),
  plan_artifact_id: z.string().min(1),
  review_artifact_id: z.string().min(1),
  changed_fields: z.string(),
  score_before_total: z.number().int().min(0).nullable(),
  score_after_total: z.number().int().min(0),
  score_delta_total: z.number().int().nullable(),
  round_cost_tokens: z.number().int().nonnegative().nullable(),
  cost_delta_tokens: z.number().int().nullable(),
  limitations_before_count: z.number().int().nonnegative().nullable(),
  limitations_after_count: z.number().int().nonnegative(),
  limitation_delta_count: z.number().int().nullable(),
  stop_reason: z.string().min(1).nullable(),
  retry_reason: z.string().min(1).nullable(),
  rollback_reason: z.string().min(1).nullable(),
});

/** Reviewer 三项分数的独立、确定性汇总。 */
export function reviewScoreTotal(review: Pick<Review, "scores">): number {
  return review.scores.scientific_value + review.scores.technical_depth + review.scores.application_potential;
}

type UsageEvent = { kind?: unknown; payload?: unknown };

/** 只统计评价相关角色的已知 token；缺字段或类型损坏时返回 null。 */
export function evaluationUsageTokens(
  events: readonly UsageEvent[],
  roles: readonly string[] = ["research-plan", "reviewer"],
): number | null {
  const allowed = new Set(roles);
  let total = 0;
  let found = false;
  for (const event of events) {
    if (event.kind !== "sdk.usage" || typeof event.payload !== "object" || event.payload === null) continue;
    const payload = event.payload as Record<string, unknown>;
    if (typeof payload.agent !== "string" || !allowed.has(payload.agent)) {
      continue;
    }
    const tokens = payload.total_tokens;
    if (typeof tokens !== "number" || !Number.isSafeInteger(tokens) || tokens < 0) return null;
    found = true;
    total += tokens;
  }
  return found ? total : null;
}

export function knownDelta(after: number | null, before: number | null): number | null {
  return after === null || before === null ? null : after - before;
}
