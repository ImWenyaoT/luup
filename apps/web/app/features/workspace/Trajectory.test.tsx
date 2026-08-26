import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import type { Snapshot } from "../../lib/types/wire";
import { Trajectory } from "./Trajectory";

describe("Trajectory", () => {
  test("折叠检索证据段隐藏引用", () => {
    const snapshot: Snapshot = {
      id: "run-1",
      question: "q",
      status: "completed",
      current_role: null,
      version: 1,
      error_code: null,
      final_artifact_id: null,
      attempts: [
        {
          id: "a1",
          role: "researcher",
          ordinal: 1,
          status: "completed",
          corrections: 0,
          failure_code: null,
          started_at: "2025-01-01T00:00:00Z",
          finished_at: "2025-01-01T00:00:02Z",
        },
      ],
      subagents: [],
      tool_evidence: [
        {
          id: "e1",
          attempt_id: "a1",
          tool_name: "arxiv_search",
          query: "rag",
          status: "completed",
          created_at: "2025-01-01T00:00:00Z",
          output: {
            result_summary: "summary text",
            citations: [{ title: "Paper", locator: "arxiv:1234v1", url: null }],
          },
        },
      ],
      omitted_evidence_count: 0,
      omitted_evidence_tools: [],
      artifacts: [],
      recent_events: [],
    };

    render(<Trajectory snapshot={snapshot} />);
    expect(screen.getByText("执行轨迹 · 1 次检索")).toBeInTheDocument();
    expect(screen.getByText("arxiv:1234v1")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /检索证据/ }));
    expect(screen.queryByText("arxiv:1234v1")).not.toBeInTheDocument();
    expect(screen.getByText(/… 1 次检索 · 1 条引用/)).toBeInTheDocument();
  });
});
