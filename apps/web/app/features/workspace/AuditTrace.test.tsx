import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import type { Snapshot } from "../../lib/types/wire";
import { AuditTrace } from "./AuditTrace";

const baseSnapshot = (): Snapshot => ({
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
});

describe("AuditTrace", () => {
  test("无 trace 时不伪造，展示未知状态", () => {
    render(<AuditTrace snapshot={baseSnapshot()} />);
    expect(screen.getByText("暂无公开 trace · 状态未知")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "审计轨迹 · Audit / Trace" })).toBeInTheDocument();
  });

  test("展示公共投影中的引用验收计分板", () => {
    render(
      <AuditTrace
        snapshot={{
          ...baseSnapshot(),
          recent_events: [
            {
              id: 9,
              version: 9,
              kind: "verification.references",
              created_at: "2026-08-28T00:00:00Z",
              payload: {
                ok: false,
                reference_count: 4,
                frozen_sources: 4,
                arxiv_checked: 3,
                doi_checked: 1,
                failed_count: 1,
                infra_error: false,
              },
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("引用验收 · Verification")).toBeInTheDocument();
    expect(screen.getByText("未通过 · 1 条失败")).toBeInTheDocument();
    expect(screen.getByText("arXiv 3 · DOI 1")).toBeInTheDocument();
  });
});
