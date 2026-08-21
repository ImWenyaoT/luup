import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onTestFinished, test } from "bun:test";

import type { DomainArtifact } from "../src/agent/contracts.ts";
import { BatchManifest, type BatchTerminalStatus } from "../src/batch/manifest.ts";
import {
  buildBatchSubmissionIndex,
  checkScience125BatchIndex,
  exportBatchSubmissionIndex,
  main,
  type BatchSubmissionIndex,
} from "../src/batch/submission-export.ts";
import { SqliteStore } from "../src/store/store.ts";

function testStore(): SqliteStore {
  const store = new SqliteStore(":memory:");
  onTestFinished(() => store.close());
  return store;
}

function completeRun(store: SqliteStore, questionId: number): { runId: string; artifactId: string } {
  const runId = store.createRun(`题 ${questionId}`, { science125Id: questionId });
  const attemptId = store.startAttempt(runId, "research-plan");
  const artifact = store.publishArtifact(
    runId,
    attemptId,
    { artifact_type: "research-plan" } as unknown as DomainArtifact,
    [],
    0,
  );
  store.finishRun(runId, "completed", { finalArtifactId: artifact.id });
  return { runId, artifactId: artifact.id };
}

function terminalRun(store: SqliteStore, questionId: number, status: BatchTerminalStatus): string {
  const runId = store.createRun(`题 ${questionId}`, { science125Id: questionId });
  if (status === "success") completeRunForExisting(store, runId);
  else if (status === "human_review") store.finishRun(runId, "review_rejected", { errorCode: "review_rejected" });
  else store.finishRun(runId, "failed", { errorCode: status === "partial" ? "partial" : "invalid_output" });
  return runId;
}

function completeRunForExisting(store: SqliteStore, runId: string): string {
  const attemptId = store.startAttempt(runId, "research-plan");
  const artifact = store.publishArtifact(
    runId,
    attemptId,
    { artifact_type: "research-plan" } as unknown as DomainArtifact,
    [],
    0,
  );
  store.finishRun(runId, "completed", { finalArtifactId: artifact.id });
  return artifact.id;
}

test("submission index has exactly one truthful row per expected ID and no artifact body", () => {
  const store = testStore();
  const manifest = BatchManifest.create(store, [1, 2, 3, 4]);
  const success = completeRun(store, 1);
  const partial = terminalRun(store, 2, "partial");
  const failure = terminalRun(store, 3, "failure");
  const humanReview = terminalRun(store, 4, "human_review");
  manifest.record({ questionId: 1, status: "success", runId: success.runId });
  manifest.record({ questionId: 2, status: "partial", runId: partial });
  manifest.record({ questionId: 3, status: "failure", runId: failure });
  manifest.record({ questionId: 4, status: "human_review", runId: humanReview });

  const index = buildBatchSubmissionIndex(store, manifest.id, "2026-08-22T00:00:00.000Z");

  assert.deepEqual(index.expectedIds, [1, 2, 3, 4]);
  assert.deepEqual(
    index.questions.map(({ questionId, status, runId }) => ({ questionId, status, runId })),
    [
      { questionId: 1, status: "success", runId: success.runId },
      { questionId: 2, status: "partial", runId: partial },
      { questionId: 3, status: "failure", runId: failure },
      { questionId: 4, status: "human_review", runId: humanReview },
    ],
  );
  assert.deepEqual(index.counts, {
    success: 1,
    partial: 1,
    failure: 1,
    human_review: 1,
    omitted: 0,
    invalid: 0,
    expected: 4,
    records: 4,
  });
  assert.equal(index.complete, true);
  assert.deepEqual(index.omittedIds, []);
  assert.deepEqual(index.invalidIds, []);
  assert.deepEqual(index.questions[0]!.links, {
    run: `/api/runs/${success.runId}`,
    finalArtifact: `/api/artifacts/${success.artifactId}`,
  });
  assert.equal("content" in index.questions[0]!, false);
  assert.doesNotMatch(JSON.stringify(index), /input_artifact_ids/);
});

test("submission index makes omissions, invalid records, and unexpected IDs explicit", () => {
  const store = testStore();
  const manifest = BatchManifest.create(store, [1, 2, 3]);
  const success = completeRun(store, 1);
  manifest.record({ questionId: 1, status: "success", runId: success.runId });
  manifest.record({ questionId: 3, status: "success", runId: "missing-run" });
  manifest.record({ questionId: 99, status: "failure", runId: "unexpected-run" });

  const index = buildBatchSubmissionIndex(store, manifest.id, "2026-08-22T00:00:00.000Z");

  assert.deepEqual(
    index.questions.map(({ questionId, status, runId, reason }) => ({ questionId, status, runId, reason })),
    [
      { questionId: 1, status: "success", runId: success.runId, reason: null },
      { questionId: 2, status: "omitted", runId: null, reason: "omitted" },
      { questionId: 3, status: "invalid", runId: "missing-run", reason: "unknown_run" },
    ],
  );
  assert.deepEqual(index.omittedIds, [2]);
  assert.deepEqual(index.invalidIds, [3]);
  assert.deepEqual(index.unexpectedIds, [99]);
  assert.equal(index.complete, false);
  assert.deepEqual(index.counts, {
    success: 1,
    partial: 0,
    failure: 0,
    human_review: 0,
    omitted: 1,
    invalid: 1,
    expected: 3,
    records: 3,
  });
  assert.deepEqual(index.invalidRecords, [
    { questionId: 3, status: "success", runId: "missing-run", reason: "unknown_run" },
    { questionId: 99, status: "failure", runId: "unexpected-run", reason: "unexpected_question_id" },
  ]);
});

test("export writes only the machine-readable index to the requested path", () => {
  const store = testStore();
  const manifest = BatchManifest.create(store, [1]);
  const run = completeRun(store, 1);
  manifest.record({ questionId: 1, status: "success", runId: run.runId });
  const dir = mkdtempSync(join(tmpdir(), "luup-submission-export-"));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  const output = join(dir, "nested", "science125-index.json");

  const result = exportBatchSubmissionIndex({
    dbPath: ":memory:",
    manifestId: manifest.id,
    outputPath: output,
    store,
    generatedAt: "2026-08-22T00:00:00.000Z",
  });

  assert.equal(result.complete, true);
  assert.deepEqual(JSON.parse(readFileSync(output, "utf8")), result);
  assert.equal(JSON.stringify(result).includes('"content"'), false);
});

test("submission index has a stable format marker", () => {
  const store = testStore();
  const manifest = BatchManifest.create(store, [1]);
  const index: BatchSubmissionIndex = buildBatchSubmissionIndex(store, manifest.id, "2026-08-22T00:00:00.000Z");
  assert.equal(index.format, "luup.batch-submission-index");
  assert.equal(index.version, 1);
});

test("science125 strict gate rejects a diagnostic index with a precise reason", () => {
  const store = testStore();
  const manifest = BatchManifest.create(store, [1, 2]);
  const run = completeRun(store, 1);
  manifest.record({ questionId: 1, status: "success", runId: run.runId });

  const index = buildBatchSubmissionIndex(store, manifest.id, "2026-08-22T00:00:00.000Z");
  const gate = checkScience125BatchIndex(index);

  assert.equal(gate.passed, false);
  assert.ok(gate.reasons.includes("expected_ids_not_exact_science125"));
  assert.ok(gate.reasons.includes("manifest_incomplete"));
  assert.ok(gate.reasons.includes("omitted_ids_present"));
});

test("science125 strict gate accepts exactly one durable success for every frozen ID", () => {
  const store = testStore();
  const ids = Array.from({ length: 125 }, (_, index) => index + 1);
  const manifest = BatchManifest.create(store, ids);
  for (const questionId of ids) {
    const run = completeRun(store, questionId);
    manifest.record({ questionId, status: "success", runId: run.runId });
  }

  const index = buildBatchSubmissionIndex(store, manifest.id, "2026-08-22T00:00:00.000Z");
  assert.deepEqual(checkScience125BatchIndex(index), { passed: true, reasons: [] });
});

test("batch export strict mode still writes the incomplete diagnostic index", () => {
  const dir = mkdtempSync(join(tmpdir(), "luup-submission-export-strict-"));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  const dbPath = join(dir, "runs.db");
  const output = join(dir, "science125-index.json");
  const store = new SqliteStore(dbPath);
  const manifest = BatchManifest.create(store, [1]);
  store.close();

  const exitCode = main(["--manifest-id", manifest.id, "--db", dbPath, "--out", output, "--require-science125"]);

  assert.equal(exitCode, 1);
  const index = JSON.parse(readFileSync(output, "utf8")) as BatchSubmissionIndex;
  assert.equal(index.expectedIds.length, 1);
  assert.equal(index.complete, false);
});
