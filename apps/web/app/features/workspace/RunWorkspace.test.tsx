import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { Snapshot } from "../../lib/types/wire";
import { createTestWrapper } from "../../test-utils";
import { RunWorkspace } from "./RunWorkspace";

const snapshot: Snapshot = {
  id: "run-1",
  question: "测试问题",
  status: "completed",
  current_role: null,
  version: 3,
  error_code: null,
  final_artifact_id: "art-1",
  attempts: [],
  subagents: [],
  tool_evidence: [],
  omitted_evidence_count: 0,
  omitted_evidence_tools: [],
  artifacts: [{ id: "art-1", type: "research-plan" }],
  recent_events: [],
};

describe("RunWorkspace", () => {
  test("渲染轨迹与产物区", () => {
    render(
      <RunWorkspace
        snapshot={snapshot}
        onRefetch={vi.fn()}
        selectedArtifactId={null}
        onSelectArtifact={vi.fn()}
        artifact={null}
        artifactLoading={false}
      />,
      { wrapper: createTestWrapper() },
    );

    expect(screen.getByTestId("run-workspace")).toBeInTheDocument();
    expect(screen.getByTestId("trajectory")).toBeInTheDocument();
    expect(screen.getByTestId("artifact-panel")).toBeInTheDocument();
    expect(screen.getByText("冻结产物")).toBeInTheDocument();
  });
});
