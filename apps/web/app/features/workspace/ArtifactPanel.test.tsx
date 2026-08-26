import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { useArtifact } from "../../hooks/useArtifact";
import { createApiClient } from "../../lib/api/client";
import type { Artifact, Snapshot } from "../../lib/types/wire";
import { createTestWrapper } from "../../test-utils";
import { ArtifactPanel } from "./ArtifactPanel";

const snapshot: Snapshot = {
  id: "run-1",
  question: "q",
  status: "completed",
  current_role: null,
  version: 1,
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

const artifact: Artifact = {
  id: "art-1",
  type: "research-plan",
  content: {
    artifact_type: "research-plan",
    problem_statement: "问题",
    rationale: "理由",
    technical_details: "细节",
    datasets: [],
    source: "s",
    target: "t",
    execution_plan: {
      predictions: [],
      data_requirements: [],
      steps: [],
      analysis: [],
      result_interpretations: [],
      stop_conditions: [],
      rollback_conditions: [],
      supplement_evidence_conditions: [],
    },
    paper_title: "标题",
    paper_abstract: "摘要",
    methods: "方法",
    experiments: { baselines: [], metrics: [], design: "设计" },
    results: {
      status: "pending_verification",
      validation_basis: "formula_derivation",
      feasibility_argument: "论证",
      expected_outcomes: [],
    },
    references: [],
  },
};

function respond(status: number, body: unknown, ok = status < 400): Response {
  return {
    ok,
    status,
    statusText: `HTTP-${status}`,
    json: async () => body,
  } as unknown as Response;
}

function ArtifactPanelWithFetch({
  selectedArtifactId,
  onSelectArtifact,
}: {
  selectedArtifactId: string | null;
  onSelectArtifact: (id: string) => void;
}) {
  const { artifact: loadedArtifact, loading } = useArtifact(selectedArtifactId);
  return (
    <ArtifactPanel
      snapshot={snapshot}
      selectedArtifactId={selectedArtifactId}
      onSelectArtifact={onSelectArtifact}
      artifact={loadedArtifact}
      artifactLoading={loading}
    />
  );
}

describe("ArtifactPanel", () => {
  test("选中产物后拉取并渲染", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith("/api/artifacts/art-1")) return respond(200, artifact);
      return respond(404, { detail: "not found" });
    }) as typeof fetch;
    const client = createApiClient({ fetchImpl });
    const onSelect = vi.fn();

    render(<ArtifactPanelWithFetch selectedArtifactId="art-1" onSelectArtifact={onSelect} />, {
      wrapper: createTestWrapper({ client }),
    });

    await waitFor(() => expect(screen.getByTestId("artifact-view")).toBeInTheDocument());
    expect(screen.getByText("标题")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "research-plan" }));
    expect(onSelect).toHaveBeenCalledWith("art-1");
  });

  test("产物加载失败时 useArtifact 返回错误", async () => {
    const fetchImpl = vi.fn(async () => respond(500, { detail: "加载失败" }));
    const client = createApiClient({ fetchImpl });

    function Probe() {
      const { error } = useArtifact("art-1");
      return <span data-testid="error">{error?.message ?? ""}</span>;
    }

    render(<Probe />, { wrapper: createTestWrapper({ client }) });

    await waitFor(() => expect(screen.getByTestId("error")).toHaveTextContent("加载失败"));
  });
});
