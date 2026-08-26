import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { ApiError, createApiClient } from "../lib/api/client";
import type { Artifact } from "../lib/types/wire";
import { createTestWrapper } from "../test-utils";
import { useArtifact } from "./useArtifact";

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

describe("useArtifact", () => {
  test("artifactId 为 null 时不请求", () => {
    const fetchImpl = vi.fn();
    const client = createApiClient({ fetchImpl });
    renderHook(() => useArtifact(null, { client }), {
      wrapper: createTestWrapper({ client }),
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("拉取 artifact 成功", async () => {
    const fetchImpl = vi.fn(async () => respond(200, artifact));
    const client = createApiClient({ fetchImpl });
    const { result } = renderHook(() => useArtifact("art-1", { client }), {
      wrapper: createTestWrapper({ client }),
    });

    await waitFor(() => expect(result.current.artifact).toEqual(artifact));
  });

  test("错误隔离：失败不污染其他 id 的缓存展示", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(respond(500, { detail: "旧 Artifact 失败" }))
      .mockResolvedValueOnce(respond(200, artifact));
    const client = createApiClient({ fetchImpl });
    const wrapper = createTestWrapper({ client });

    const { result, rerender } = renderHook(({ id }) => useArtifact(id, { client }), {
      wrapper,
      initialProps: { id: "bad-art" as string | null },
    });

    await waitFor(() => expect(result.current.error).toBeInstanceOf(ApiError));
    rerender({ id: "art-1" });
    await waitFor(() => expect(result.current.artifact?.id).toBe("art-1"));
    expect(result.current.error).toBeNull();
  });
});
