import { z } from "zod";

export const reviewFoundationCheckSchema = z.strictObject({
  verdict: z.enum(["pass", "fail"]),
  reason: z.string().trim().min(1),
  plan_paths: z.array(z.string().trim().min(1)).min(1),
});

export const reviewFoundationChecksSchema = z.strictObject({
  premise: reviewFoundationCheckSchema,
  falsifiability: reviewFoundationCheckSchema,
  evidence_support: reviewFoundationCheckSchema,
  executability: reviewFoundationCheckSchema,
  citation_relevance: reviewFoundationCheckSchema,
});

export type ReviewFoundationChecks = z.infer<typeof reviewFoundationChecksSchema>;

/** Missing historical checks remain readable, but cannot authorize a new acceptance. */
export function reviewCanAccept(review: { accepted: boolean; foundation_checks?: unknown }): boolean {
  if (review.accepted !== true) return false;
  const checks = reviewFoundationChecksSchema.safeParse(review.foundation_checks);
  return checks.success && Object.values(checks.data).every((check) => check.verdict === "pass");
}

/** Only concrete own JSON fields and array indices; no wildcards or prototype traversal. */
function resolvesPlanPath(plan: unknown, path: string): boolean {
  if (!/^[A-Za-z_][A-Za-z0-9_]*(?:(?:\.[A-Za-z_][A-Za-z0-9_]*)|(?:\[(?:0|[1-9][0-9]*)\]))*$/.test(path)) {
    return false;
  }
  const segments = path.match(/[A-Za-z_][A-Za-z0-9_]*|[0-9]+/g);
  if (!segments) return false;
  let current: unknown = plan;
  for (const segment of segments) {
    if (segment === "__proto__" || segment === "prototype" || segment === "constructor") return false;
    if (current === null || typeof current !== "object" || !Object.hasOwn(current, segment)) return false;
    if (Array.isArray(current) && !/^(0|[1-9][0-9]*)$/.test(segment)) return false;
    current = (current as Record<string, unknown>)[segment];
  }
  return current !== undefined;
}

export function reviewFoundationPathIssues(checks: ReviewFoundationChecks, plan: unknown): string[] {
  const issues: string[] = [];
  for (const [key, check] of Object.entries(checks)) {
    for (const path of check.plan_paths) {
      if (!resolvesPlanPath(plan, path)) {
        issues.push(`foundation_checks.${key}.plan_paths: path does not resolve in research plan: ${path}`);
      }
    }
  }
  return issues;
}
