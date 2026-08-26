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
});
