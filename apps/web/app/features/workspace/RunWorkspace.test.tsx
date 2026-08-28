import { fireEvent, render, screen } from "@testing-library/react";
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
  test("主画布仅渲染可扫读进度与 Inspector 入口", () => {
    const onInspectorChange = vi.fn();
    render(
      <RunWorkspace
        snapshot={snapshot}
        onRefetch={vi.fn()}
        selectedArtifactId={null}
        onSelectArtifact={vi.fn()}
        artifact={null}
        artifactLoading={false}
        onInspectorChange={onInspectorChange}
      />,
      { wrapper: createTestWrapper() },
    );

    expect(screen.getByTestId("run-workspace")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "研究进度" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "查看冻结产物" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "查看执行轨迹" })).toBeInTheDocument();
    expect(screen.queryByTestId("trajectory")).not.toBeInTheDocument();
    expect(screen.queryByTestId("artifact-panel")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "查看冻结产物" }));
    expect(onInspectorChange).toHaveBeenLastCalledWith("artifacts");
    fireEvent.click(screen.getByRole("button", { name: "查看执行轨迹" }));
    expect(onInspectorChange).toHaveBeenLastCalledWith("process");
  });
});
