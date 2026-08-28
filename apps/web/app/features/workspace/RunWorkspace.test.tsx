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

  test.each([
    ["review_rejected", "评审未通过"],
    ["failed", "运行失败"],
  ] as const)("终态 %s 不会伪装成最终研究报告", (status, label) => {
    render(
      <RunWorkspace
        snapshot={{ ...snapshot, status }}
        onRefetch={vi.fn()}
        selectedArtifactId={null}
        onSelectArtifact={vi.fn()}
        artifact={null}
        artifactLoading={false}
      />,
      { wrapper: createTestWrapper() },
    );

    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.queryByText("最终研究报告")).not.toBeInTheDocument();
  });

  test("主画布展示终局引用验收摘要", () => {
    render(
      <RunWorkspace
        snapshot={{
          ...snapshot,
          recent_events: [
            {
              id: 8,
              version: 8,
              kind: "verification.references",
              created_at: "2026-08-28T00:00:00Z",
              payload: { ok: true, reference_count: 3, failed_count: 0 },
            },
          ],
        }}
        onRefetch={vi.fn()}
        selectedArtifactId={null}
        onSelectArtifact={vi.fn()}
        artifact={null}
        artifactLoading={false}
      />,
      { wrapper: createTestWrapper() },
    );

    expect(screen.getByText("引用验收")).toBeInTheDocument();
    expect(screen.getByText("通过 · 3 条")).toBeInTheDocument();
  });
});
