import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { createApiClient } from "../lib/api/client";
import type { Artifact, Snapshot } from "../lib/types/wire";
import { createTestWrapper } from "../test-utils";
import Home from "./home";

const completedSnapshot: Snapshot = {
  id: "run-1",
  question: "first question",
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

const nextSnapshot: Snapshot = {
  ...completedSnapshot,
  id: "run-2",
  question: "第二个研究问题",
};

const artifact: Artifact = {
  id: "art-1",
  type: "research-plan",
  content: {
    artifact_type: "research-plan",
    problem_statement: "p",
    rationale: "r",
    technical_details: "t",
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
    paper_title: "title",
    paper_abstract: "abstract",
    methods: "m",
    experiments: { baselines: [], metrics: [], design: "d" },
    results: {
      status: "pending_verification",
      validation_basis: "formula_derivation",
      feasibility_argument: "f",
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

describe("Home sticky artifact errors", () => {
  test("旧 artifact 失败会短暂显示，且不会挂到新 run", async () => {
    let artifactCalls = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/api/runs/run-1")) return respond(200, completedSnapshot);
      if (url.endsWith("/api/artifacts/art-1")) {
        artifactCalls += 1;
        if (artifactCalls === 1) {
          await new Promise((done) => setTimeout(done, 50));
          return respond(500, { detail: "旧 Artifact 失败" });
        }
        return respond(200, artifact);
      }
      if (url.endsWith("/api/runs") && init?.method === "POST") {
        await new Promise((done) => setTimeout(done, 100));
        return respond(200, nextSnapshot);
      }
      return respond(404, { detail: "not found" });
    }) as typeof fetch;

    const client = createApiClient({ fetchImpl });

    render(<Home />, {
      wrapper: createTestWrapper({ client, initialEntries: ["/?run=run-1"] }),
    });

    await screen.findByText("first question");
    fireEvent.click(screen.getByRole("button", { name: "research-plan" }));
    await waitFor(() => expect(screen.getByTestId("artifact-loading")).toBeInTheDocument());
    await waitFor(() => expect(screen.queryByTestId("artifact-loading")).not.toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText("提出一个可以设计实验去检验的研究问题"), {
      target: { value: "第二个研究问题" },
    });
    fireEvent.click(screen.getByRole("button", { name: "开始研究" }));

    await waitFor(() => expect(screen.getByText("旧 Artifact 失败")).toBeInTheDocument());
    await waitFor(() => expect(screen.queryByText("旧 Artifact 失败")).not.toBeInTheDocument());
    expect(screen.getByText("第二个研究问题")).toBeInTheDocument();
  });
});
