import type { ResearchPlan } from "./contracts.ts";

const cjk = /[\u3400-\u4dbf\u4e00-\u9fff]/;

/** \u4e0a\u6e38\u51bb\u7ed3\u4e8b\u5b9e\uff1a\u6240\u6709 Research Artifact \u91cc\u51fa\u73b0\u8fc7\u7684 evidence ID \u4e0e URL\u3002 */
export type FrozenEvidence = { evidenceIds: ReadonlySet<string>; urls: ReadonlySet<string> };

/** \u8ba1\u5212\u76f8\u5bf9\u4e0a\u6e38\u51bb\u7ed3 Artifact \u7684\u53ef\u8ffd\u6eaf\u6027\u3002
 *
 * \u5224\u636e\u5bf9\u8c61\u523b\u610f\u662f **Research Artifact \u7684 citations**\uff0c\u4e0d\u662f\u68c0\u7d22\u53f0\u8d26\u5168\u96c6\uff1a
 * \u53f0\u8d26\u91cc\u53ef\u80fd\u6709\u68c0\u7d22\u5230\u5374\u4ece\u672a\u5199\u8fdb\u4efb\u4f55\u51bb\u7ed3 Artifact \u7684\u6761\u76ee\uff0c\u8ba9\u8ba1\u5212\u53bb\u6838\u9a8c\u90a3\u79cd\u6761\u76ee\uff0c
 * \u8ffd\u6eaf\u94fe\u5c31\u65ad\u5728 Artifact \u4e4b\u5916\u4e86\u3002\u5bf9\u5e94 backend/app/harness.py \u7684\u540c\u540d\u4e24\u6761\u68c0\u67e5\u3002
 */
export function upstreamTraceabilityIssues(plan: ResearchPlan, frozen: FrozenEvidence): string[] {
  const issues: string[] = [];
  if (plan.verification_evidence_ids.length === 0) {
    issues.push("verification_evidence_ids \u4e0d\u80fd\u4e3a\u7a7a\uff0c\u8ba1\u5212\u5fc5\u987b\u7ed1\u5b9a\u51bb\u7ed3\u8bc1\u636e");
  }
  for (const id of plan.verification_evidence_ids) {
    if (!frozen.evidenceIds.has(id)) {
      issues.push(`verification_evidence_ids \u7684\u201c${id}\u201d\u4e0d\u5728\u4efb\u4f55\u51bb\u7ed3 Research Artifact \u91cc`);
    }
  }
  for (const url of plan.references) {
    if (!frozen.urls.has(url)) {
      issues.push(`references \u7684\u201c${url}\u201d\u6ca1\u6709\u51fa\u73b0\u5728\u4efb\u4f55\u51bb\u7ed3 Research Artifact \u7684\u5f15\u7528\u91cc`);
    }
  }
  return issues;
}

export function validateResearchPlanQuality(plan: ResearchPlan): void {
  const issues = researchPlanQualityIssues(plan);
  if (issues.length > 0) throw new Error(issues.join("\uff1b"));
}

export function researchPlanQualityIssues(plan: ResearchPlan): string[] {
  // 中文正文这条已由 contracts.ts 的 chineseProse 在 schema 层守住，这里不再抄一遍。
  const issues: string[] = [];

  // 每一项都带着自己的 evidence_id（schema 保证），这里只需确认它确实是本计划核验过的
  // 冻结证据。「必须有出处」这条已经由类型守住，不再需要逐字匹配另一张表。
  const verified = new Set(plan.verification_evidence_ids);
  for (const item of [...plan.experiments.baselines, ...plan.experiments.metrics]) {
    if (!verified.has(item.evidence_id)) {
      issues.push(`“${item.name}”绑定的证据“${item.evidence_id}”不在 verification_evidence_ids 里`);
    }
  }
  const metrics = new Set(plan.experiments.metrics.map((item) => item.name));
  for (const item of plan.results.expected_outcomes) {
    if (!metrics.has(item.metric)) {
      issues.push(`results.expected_outcomes 绑定的“${item.metric}”不在 experiments.metrics 里`);
    }
  }
  // 条数下限已由 schema 的 min(2) 守住，这里只查去重后是否还够 —— 写两条一样的不算覆盖。
  if (new Set(plan.experiments.baselines.map((item) => item.name)).size < 2
    || metrics.size < 2) {
    issues.push("experiments.baselines 与 experiments.metrics 去重后必须各覆盖至少两项");
  }

  return issues;
}
