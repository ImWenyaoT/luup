import { screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import type { Snapshot } from "../../lib/types/wire";
import { renderWithProviders } from "../../test-utils";
import { RunHeader } from "./RunHeader";

const snapshot: Snapshot = {
  id: "run-1",
  question: "测试问题？",
  status: "running",
  current_role: "researcher",
  version: 3,
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

describe("RunHeader", () => {
  test("展示问题、状态与技术详情", () => {
    renderWithProviders(<RunHeader snapshot={snapshot} sseConnected />);

    expect(screen.getByTestId("run-header")).toBeInTheDocument();
    expect(screen.getByText("测试问题？")).toBeInTheDocument();
    expect(screen.getByTestId("run-status-badge")).toHaveTextContent("进行中");
    expect(screen.getByText("SSE")).toBeInTheDocument();
    expect(screen.getByText("技术详情")).toBeInTheDocument();
  });
});

test("主动停止显示中性终态，而不是模型失败", () => {
  renderWithProviders(<RunHeader snapshot={{ ...snapshot, status: "failed", error_code: "interrupted" }} />);
  expect(screen.getByTestId("run-status-badge")).toHaveTextContent("已停止");
  expect(screen.queryByText("interrupted")).not.toBeInTheDocument();
});
