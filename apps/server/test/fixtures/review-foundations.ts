/** 合格计划的五项基础审查；路径对应测试计划的真实字段。 */
export function passingReviewFoundations() {
  return {
    premise: { verdict: "pass" as const, reason: "问题陈述明确限定研究前提。", plan_paths: ["problem_statement"] },
    falsifiability: {
      verdict: "pass" as const,
      reason: "预测列明可否定条件。",
      plan_paths: ["execution_plan"],
    },
    evidence_support: {
      verdict: "pass" as const,
      reason: "核心依据绑定冻结证据。",
      plan_paths: ["verification_evidence_ids"],
    },
    executability: {
      verdict: "pass" as const,
      reason: "执行步骤有明确操作和输出。",
      plan_paths: ["execution_plan"],
    },
    citation_relevance: {
      verdict: "pass" as const,
      reason: "参考来源对应计划的方法和依据。",
      plan_paths: ["references"],
    },
  };
}
