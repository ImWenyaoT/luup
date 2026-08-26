import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import type { Snapshot } from "../../lib/types/wire";
import { FeedbackHistory } from "./FeedbackHistory";

describe("FeedbackHistory", () => {
  test("展示反馈与修订事件", () => {
    const snapshot: Snapshot = {
      id: "run-1",
      question: "q",
      status: "running",
      current_role: "reviewer",
      version: 2,
      error_code: null,
      final_artifact_id: null,
      attempts: [],
      subagents: [],
      tool_evidence: [],
      omitted_evidence_count: 0,
      omitted_evidence_tools: [],
      artifacts: [],
      recent_events: [
        {
          id: 1,
          version: 1,
          kind: "feedback.received",
          payload: { feedback_source: "human", round: 1, action: "revise", feedback: "请补充对照" },
          created_at: "2025-01-01T00:00:00Z",
        },
        {
          id: 2,
          version: 2,
          kind: "revision.applied",
          payload: { round: 1, changed_fields: "title" },
          created_at: "2025-01-01T00:00:01Z",
        },
        {
          id: 3,
          version: 3,
          kind: "evaluation.round",
          payload: { round: 1, phase: "review", feedback_source: "auto", rubric_version: "v1" },
          created_at: "2025-01-01T00:00:02Z",
        },
      ],
    };

    render(<FeedbackHistory snapshot={snapshot} />);
    expect(screen.getByText("人工反馈")).toBeInTheDocument();
    expect(screen.getByText("请补充对照")).toBeInTheDocument();
    expect(screen.getByText("修订")).toBeInTheDocument();
    expect(screen.getByText(/第 1 轮评价/)).toBeInTheDocument();
  });

  test("无事件时不渲染", () => {
    const snapshot: Snapshot = {
      id: "run-1",
      question: "q",
      status: "completed",
      current_role: null,
      version: 1,
      error_code: null,
      final_artifact_id: null,
      attempts: [],
      subagents: [],
      tool_evidence: [],
      omitted_evidence_count: 0,
      omitted_evidence_tools: [],
      artifacts: [],
      recent_events: [],
    };

    const { container } = render(<FeedbackHistory snapshot={snapshot} />);
    expect(container).toBeEmptyDOMElement();
  });
});
