import type { Role, RunStatus } from "./wire";

export const TERMINAL_STATUSES: ReadonlySet<RunStatus> = new Set(["completed", "review_rejected", "failed"]);

export const ROLE_ORDER: readonly Role[] = [
  "researcher",
  "hypothesis-generation",
  "evidence-review",
  "research-plan",
  "reviewer",
] as const;

export const ROLE_LABEL: Record<Role, string> = {
  researcher: "检索证据",
  "hypothesis-generation": "生成假设",
  "evidence-review": "审查证据",
  "research-plan": "研究计划",
  reviewer: "独立评审",
};
