import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { FeedbackHistory } from "./feedback-history";
import type { Snapshot } from "./types";

test("feedback history distinguishes automatic feedback and persisted revision delta", () => {
  const snapshot: Snapshot = {
    id: "r1",
    question: "q",
    status: "review_rejected",
    current_role: null,
    version: 3,
    error_code: "review_rejected",
    final_artifact_id: null,
    attempts: [],
    subagents: [],
    tool_evidence: [],
    artifacts: [],
    recent_events: [
      {
        id: 1,
        version: 1,
        kind: "feedback.received",
        payload: {
          source: "researcher",
          feedback_source: "human",
          target: "research-plan",
          round: 1,
          action: "revise",
          feedback_count: 1,
          feedback: "补充停止条件",
        },
        created_at: "t",
      },
      {
        id: 2,
        version: 2,
        kind: "revision.applied",
        payload: { source: "model_reviewer", round: 2, changed_fields: "methods,references" },
        created_at: "t",
      },
      {
        id: 3,
        version: 3,
        kind: "evaluation.round",
        payload: {
          round: 2,
          phase: "revision",
          feedback_source: "auto",
          rubric_version: "review-v1",
          score_delta_total: 2,
          cost_delta_tokens: null,
          limitation_delta_count: -1,
          raw_plan_artifact_id: "plan-1",
          raw_review_artifact_id: "review-1",
          stop_reason: "revision_budget_exhausted",
          retry_reason: null,
          rollback_reason: null,
        },
        created_at: "t",
      },
    ],
  };

  const html = renderToStaticMarkup(<FeedbackHistory snapshot={snapshot} />);
  expect(html).toContain("人工反馈");
  expect(html).toContain("补充停止条件");
  expect(html).toContain("修订");
  expect(html).toContain("methods,references");
  expect(html).toContain("review-v1");
  expect(html).toContain("revision_budget_exhausted");
});
