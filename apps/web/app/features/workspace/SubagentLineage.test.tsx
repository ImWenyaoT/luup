import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import type { Snapshot } from "../../lib/types/wire";
import { SubagentLineage } from "./SubagentLineage";

describe("SubagentLineage", () => {
  test("展示 subagent 数量与控制面", () => {
    const snapshot: Snapshot = {
      id: "run-abc",
      question: "q",
      status: "completed",
      current_role: null,
      version: 1,
      error_code: null,
      final_artifact_id: null,
      attempts: [],
      subagents: [
        {
          id: "sub-1",
          parent_run_id: "run-abc",
          role: "researcher",
          ordinal: 1,
          mode: "one-shot",
          status: "completed",
          stop_reason: null,
          started_at: "2025-01-01T00:00:00Z",
          finished_at: "2025-01-01T00:00:01Z",
        },
      ],
      tool_evidence: [],
      omitted_evidence_count: 0,
      omitted_evidence_tools: [],
      artifacts: [],
      recent_events: [],
    };

    const { rerender } = render(<SubagentLineage snapshot={snapshot} />);
    expect(screen.getByRole("heading", { name: "Subagents · 1" })).toBeInTheDocument();
    expect(screen.getByText("控制面")).toBeInTheDocument();
    expect(screen.getByTitle("sub-1")).toHaveTextContent("one-shot");
    expect(screen.getByText("耗时 1 秒")).toBeInTheDocument();
    expect(screen.getByText("工具调用次数未知")).toBeInTheDocument();
    rerender(
      <SubagentLineage
        snapshot={{
          ...snapshot,
          subagents: [
            {
              ...snapshot.subagents[0],
              tool_calls: 2,
              recent_activity: [{ tool: "arxiv_search", status: "completed", created_at: "2025-01-01T00:00:01Z" }],
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("已观测 2 次工具调用")).toBeInTheDocument();
    expect(screen.getByText(/arxiv_search · 完成/)).toBeInTheDocument();
  });
});
