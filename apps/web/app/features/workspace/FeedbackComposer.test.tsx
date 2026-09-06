import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { createApiClient } from "../../lib/api/client";
import type { Snapshot } from "../../lib/types/wire";
import { createTestWrapper } from "../../test-utils";
import { FeedbackComposer } from "./FeedbackComposer";

describe("FeedbackComposer", () => {
  test("Reviewer 首轮未运行时不显示", () => {
    const snapshot: Snapshot = {
      id: "run-1",
      question: "q",
      status: "running",
      current_role: "researcher",
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

    const { container } = render(<FeedbackComposer snapshot={snapshot} onSubmitted={() => {}} />, {
      wrapper: createTestWrapper(),
    });
    expect(container).toBeEmptyDOMElement();
  });

  test("Reviewer 首轮 running 时显示表单", () => {
    const snapshot: Snapshot = {
      id: "run-1",
      question: "q",
      status: "running",
      current_role: "reviewer",
      version: 1,
      error_code: null,
      final_artifact_id: null,
      attempts: [
        {
          id: "a1",
          role: "reviewer",
          ordinal: 1,
          status: "running",
          corrections: 0,
          failure_code: null,
          started_at: "2025-01-01T00:00:00Z",
          finished_at: null,
        },
      ],
      subagents: [],
      tool_evidence: [],
      omitted_evidence_count: 0,
      omitted_evidence_tools: [],
      artifacts: [],
      recent_events: [],
    };

    render(<FeedbackComposer snapshot={snapshot} onSubmitted={() => {}} />, {
      wrapper: createTestWrapper(),
    });
    expect(screen.getByTestId("feedback-composer")).toBeInTheDocument();
    expect(screen.getByText("提交人工反馈")).toBeInTheDocument();
  });

  test("Reviewer 已排队时显示排队文案", () => {
    const snapshot: Snapshot = {
      id: "run-1",
      question: "q",
      status: "running",
      current_role: "reviewer",
      version: 1,
      error_code: null,
      final_artifact_id: null,
      attempts: [
        {
          id: "a1",
          role: "reviewer",
          ordinal: 1,
          status: "running",
          corrections: 0,
          failure_code: null,
          started_at: "2025-01-01T00:00:00Z",
          finished_at: null,
        },
      ],
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
          payload: { feedback_source: "human" },
          created_at: "2025-01-01T00:00:00Z",
        },
      ],
    };

    render(<FeedbackComposer snapshot={snapshot} onSubmitted={() => {}} />, {
      wrapper: createTestWrapper(),
    });
    expect(screen.getByTestId("feedback-composer-queued")).toBeInTheDocument();
  });

  test("提交反馈调用 API", async () => {
    const onSubmitted = vi.fn();
    const fetchImpl = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/feedback") && init?.method === "POST") {
        return {
          ok: true,
          status: 202,
          statusText: "OK",
          json: async () => ({ status: "queued", feedback_id: "fb-1", round: 1 }),
        } as Response;
      }
      return { ok: false, status: 404, statusText: "NF", json: async () => ({}) } as Response;
    }) as typeof fetch;
    const client = createApiClient({ fetchImpl });

    const snapshot: Snapshot = {
      id: "run-1",
      question: "q",
      status: "running",
      current_role: "reviewer",
      version: 1,
      error_code: null,
      final_artifact_id: null,
      attempts: [
        {
          id: "a1",
          role: "reviewer",
          ordinal: 1,
          status: "running",
          corrections: 0,
          failure_code: null,
          started_at: "2025-01-01T00:00:00Z",
          finished_at: null,
        },
      ],
      subagents: [],
      tool_evidence: [],
      omitted_evidence_count: 0,
      omitted_evidence_tools: [],
      artifacts: [],
      recent_events: [],
    };

    render(<FeedbackComposer snapshot={snapshot} onSubmitted={onSubmitted} />, {
      wrapper: createTestWrapper({ client }),
    });

    fireEvent.change(screen.getByPlaceholderText("指出计划需要修订的具体内容"), {
      target: { value: "需要更多对照实验" },
    });
    fireEvent.click(screen.getByText("提交人工反馈"));

    await waitFor(() => expect(onSubmitted).toHaveBeenCalled());
    expect(screen.getByText("人工反馈已排队，评审收尾时将终止当前支线，不会自动修订。")).toBeInTheDocument();
  });
});
