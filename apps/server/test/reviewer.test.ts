import assert from "node:assert/strict";
import { test } from "vitest";

import { EvidenceLedger } from "../src/agent/evidence.ts";
import { ContractError } from "../src/agent/failures.ts";
import { reportStructuredOutput } from "../src/agent/roles/structured-output.ts";
import { runTask, type StageExecutor } from "../src/roles.ts";
import type { TaskContext } from "../src/store/contracts.ts";
import { SqliteStore } from "../src/store/store.ts";

const reviewerInputs = [
  { id: "plan", type: "research-plan", content: {} },
  { id: "evidence-review", type: "evidence-review", content: {} },
];

const review = {
  artifact_type: "review" as const,
  research_plan_artifact_id: "model-value",
  evidence_review_artifact_id: "model-value",
  independent_evidence_ids: ["not-in-scope"],
  scores: { scientific_value: 4, technical_depth: 4, application_potential: 4 },
  weaknesses: [],
  feedback: [],
  suggested_successor_roles: [] as const,
  accepted: true,
};

const citation = {
  source_type: "arxiv" as const,
  title: "Independent reviewer source",
  locator: "arxiv:2401.00001v1",
  url: "https://arxiv.org/abs/2401.00001v1",
};

function context(taskId = "reviewer-attempt"): TaskContext {
  return {
    runId: "run",
    taskId,
    role: "reviewer",
    goal: "独立评审研究计划",
    question: "问题",
    inputArtifactIds: reviewerInputs.map((item) => item.id),
    inputArtifacts: reviewerInputs,
  };
}

function successfulSearch(ledger: EvidenceLedger, status: "succeeded" | "partial" = "succeeded") {
  return ledger.record({
    tool: "arxiv_search",
    sourceType: "arxiv",
    query: "counterevidence method risk",
    status,
    resultSummary: "one independent citable source",
    citations: [citation],
  });
}

test("a reviewer without usable independent evidence gets one correction and then fails", async () => {
  const inputs: Record<string, unknown>[] = [];
  const execute: StageExecutor = ({ agent, input }) => {
    inputs.push(JSON.parse(input));
    return reportStructuredOutput(agent, review);
  };

  const failure = await runTask(context(), { execute, ledger: new EvidenceLedger() }).then(
    () => null,
    (error: unknown) => error,
  );

  assert.ok(failure instanceof ContractError);
  assert.equal((failure as { corrections?: number }).corrections, 1);
  assert.equal(inputs.length, 2);
  assert.deepEqual(inputs[1]?.frozen_searches, []);
  assert.match(String(inputs[1]?.correction_search_policy), /do not run retrieval tools again/);
});

test("failed searches and searches with empty citations do not satisfy reviewer evidence", async () => {
  const ledger = new EvidenceLedger();
  const execute: StageExecutor = ({ agent }) => {
    const failed = ledger.record({
      tool: "arxiv_search",
      sourceType: "arxiv",
      query: "failed counterevidence search",
      status: "failed",
      resultSummary: "source failed",
      citations: [],
    });
    const empty = ledger.record({
      tool: "crossref_search",
      sourceType: "web",
      query: "empty method risk search",
      status: "succeeded",
      resultSummary: "no citable records",
      citations: [],
    });
    return reportStructuredOutput(agent, {
      ...review,
      independent_evidence_ids: [failed.evidenceId, empty.evidenceId],
    });
  };

  const failure = await runTask(context("reviewer-invalid-evidence"), { execute, ledger }).then(
    () => null,
    (error: unknown) => error,
  );

  assert.ok(failure instanceof ContractError);
  assert.equal((failure as { corrections?: number }).corrections, 1);
});

test("a successful or partial cited search lets the reviewer pass", async () => {
  for (const status of ["succeeded", "partial"] as const) {
    const ledger = new EvidenceLedger();
    const execute: StageExecutor = ({ agent }) => {
      const record = successfulSearch(ledger, status);
      return reportStructuredOutput(agent, { ...review, independent_evidence_ids: [record.evidenceId] });
    };

    const result = await runTask(context(`reviewer-${status}`), { execute, ledger });
    assert.equal(result.artifact.artifact_type, "review");
    assert.equal(result.corrections, 0);
  }
});

test("reviewer search evidence is persisted on its own Attempt scope", async () => {
  const store = new SqliteStore(":memory:");
  const runId = store.createRun("问题");
  const reviewerAttemptId = store.startAttempt(runId, "reviewer");
  const reviewerLedger = new EvidenceLedger({
    namespace: `${reviewerAttemptId}_`,
    onRecord: (record) => store.recordEvidence(runId, reviewerAttemptId, record),
  });
  const result = await runTask(context("reviewer-persisted"), {
    ledger: reviewerLedger,
    execute: ({ agent }) => {
      const record = successfulSearch(reviewerLedger);
      return reportStructuredOutput(agent, { ...review, independent_evidence_ids: [record.evidenceId] });
    },
  });
  assert.equal(result.artifact.artifact_type, "review");

  const researcherAttemptId = store.startAttempt(runId, "researcher");
  const researcherLedger = new EvidenceLedger({
    namespace: `${researcherAttemptId}_`,
    onRecord: (record) => store.recordEvidence(runId, researcherAttemptId, record),
  });
  researcherLedger.record({
    tool: "arxiv_search",
    sourceType: "arxiv",
    query: "researcher search",
    status: "succeeded",
    resultSummary: "one source",
    citations: [citation],
  });

  const evidence = store.snapshot(runId)!.tool_evidence;
  assert.equal(evidence.filter((row: any) => row.attempt_id === reviewerAttemptId).length, 1);
  assert.equal(evidence.filter((row: any) => row.attempt_id === researcherAttemptId).length, 1);
  assert.notEqual(evidence[0]!.id, evidence[1]!.id);
  store.close();
});
