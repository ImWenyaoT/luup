import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import type { Snapshot } from "../../lib/types/wire";
import { AuditTrace } from "./AuditTrace";

describe("AuditTrace with traces", () => {
  test("有 trace 时渲染 TraceCard", () => {
    const snapshot: Snapshot = {
      id: "run-1",
      question: "q",
      status: "completed",
      current_role: null,
      version: 4,
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
          kind: "sdk.trace.started",
          payload: { trace_id: "attempt-1:1", agent: "researcher", role: "researcher", model: "m" },
          created_at: "2025-01-01T00:00:00Z",
        },
        {
          id: 4,
          version: 4,
          kind: "sdk.trace.ended",
          payload: { trace_id: "attempt-1:1", outcome: "completed" },
          created_at: "2025-01-01T00:00:03Z",
        },
        {
          id: 5,
          version: 5,
          kind: "sdk.usage",
          payload: { agent: "researcher", input_tokens: 1, output_tokens: 2, total_tokens: 3 },
          created_at: "2025-01-01T00:00:04Z",
        },
      ],
    };

    render(<AuditTrace snapshot={snapshot} />);
    expect(screen.queryByText("暂无公开 trace · 状态未知")).not.toBeInTheDocument();
    expect(screen.getByText("sdk.usage 记账")).toBeInTheDocument();
    expect(screen.getByText("attempt attempt-1")).toBeInTheDocument();
  });
});
