import assert from "node:assert/strict";
import { test } from "vitest";

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

test("researcher feedback is accepted once during the first reviewer attempt and remains durable", () => {
  const store = new SqliteStore(":memory:");
  const runId = store.createRun("q");
  const planner = store.startAttempt(runId, "research-plan");
  store.publishArtifact(runId, planner, artifact("research-plan"), [], 0);
  store.startAttempt(runId, "reviewer");

  const feedback = store.submitResearcherFeedback(runId, {
    id: "human-1",
    text: "请补充失败结果对应的回退条件。",
  });

  assert.deepEqual(feedback, { id: "human-1", text: "请补充失败结果对应的回退条件。", round: 1 });
  assert.deepEqual(store.researcherFeedback(runId, 1), feedback);
  assert.throws(
    () => store.submitResearcherFeedback(runId, { id: "human-2", text: "另一条" }),
    /feedback already queued/,
  );
  const events = store.eventsAfter(runId, 0).filter((event) => event.kind === "feedback.received");
  assert.equal(events.length, 1);
  assert.equal(events[0]!.payload.feedback_source, "human");
  assert.equal(events[0]!.payload.feedback, "请补充失败结果对应的回退条件。");
  store.close();
});

test("researcher feedback fails closed outside the first reviewer attempt", () => {
  const store = new SqliteStore(":memory:");
  const runId = store.createRun("q");
  assert.throws(
    () => store.submitResearcherFeedback(runId, { id: "human-1", text: "不能排队" }),
    /feedback is only accepted during the first reviewer attempt/,
  );
  store.finishRun(runId, "failed", { errorCode: "test" });
  assert.throws(
    () => store.submitResearcherFeedback(runId, { id: "human-2", text: "不能复活终态" }),
    /cannot submit feedback to failed run/,
  );
  assert.equal(
    store.eventsAfter(runId, 0).some((event) => event.kind === "feedback.received"),
    false,
  );
  store.close();
});
