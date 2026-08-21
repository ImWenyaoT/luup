import assert from "node:assert/strict";
import { test } from "bun:test";

import type { DomainArtifact } from "../src/agent/contracts.ts";
import { SqliteStore } from "../src/store/store.ts";

const artifact = (type: DomainArtifact["artifact_type"]): DomainArtifact => ({ artifact_type: type }) as DomainArtifact;

test("terminal runs cannot start new attempts", () => {
  const store = new SqliteStore(":memory:");
  const runId = store.createRun("q");
  store.finishRun(runId, "failed", { errorCode: "runtime_error" });

  assert.throws(() => store.startAttempt(runId, "researcher"), /cannot start.*failed run/);
  assert.deepEqual(store.snapshot(runId)!.attempts, []);
  store.close();
});

test("a late artifact cannot revive a failed attempt and the rejection is durable", () => {
  const store = new SqliteStore(":memory:");
  const runId = store.createRun("q");
  const attemptId = store.startAttempt(runId, "researcher");
  store.failAttempt(runId, attemptId, { code: "deadline_exceeded", reason: "late" }, "StageError", 0);

  assert.throws(() => store.publishArtifact(runId, attemptId, artifact("research"), [], 0), /cannot publish/);

  const snapshot = store.snapshot(runId)!;
  assert.equal(snapshot.attempts[0]!.status, "failed");
  assert.deepEqual(snapshot.artifacts, []);
  assert.deepEqual(snapshot.recent_events.at(-1)!.payload, {
    action: "publish_artifact",
    attempt_status: "failed",
    run_status: "running",
  });
  store.close();
});

test("a late failure cannot rewrite a completed attempt", () => {
  const store = new SqliteStore(":memory:");
  const runId = store.createRun("q");
  const attemptId = store.startAttempt(runId, "researcher");
  store.publishArtifact(runId, attemptId, artifact("research"), [], 0);

  assert.throws(
    () => store.failAttempt(runId, attemptId, { code: "runtime_error", reason: "late" }, "Error", 0),
    /cannot fail completed attempt/,
  );
  assert.equal(store.snapshot(runId)!.attempts[0]!.status, "completed");
  store.close();
});

test("completed runs require no active attempt and a real completed final artifact", () => {
  const store = new SqliteStore(":memory:");
  const runId = store.createRun("q");
  const attemptId = store.startAttempt(runId, "research-plan");

  assert.throws(() => store.finishRun(runId, "completed"), /running attempts/);
  const final = store.publishArtifact(runId, attemptId, artifact("research-plan"), [], 0);
  assert.throws(() => store.finishRun(runId, "completed"), /requires finalArtifactId/);
  store.finishRun(runId, "completed", { finalArtifactId: final.id });

  assert.equal(store.snapshot(runId)!.status, "completed");
  assert.equal(store.snapshot(runId)!.final_artifact_id, final.id);
  store.close();
});
