import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onTestFinished, test } from "vitest";

import type { Role } from "../src/agent/contracts.ts";
import { ControlSubmissionError, SqliteStore } from "../src/store/store.ts";

function setup() {
  const store = new SqliteStore(":memory:");
  onTestFinished(() => store.close());
  return { store, runId: store.createRun("freeform research") };
}

const input = { id: "instruction-1", role: "research-plan" as const, text: "明确区分假设与已验证事实。" };
function controlError(code: ControlSubmissionError["code"]) {
  return (error: unknown) => error instanceof ControlSubmissionError && error.code === code;
}

function failAttempt(store: SqliteStore, runId: string, attemptId: string) {
  store.failAttempt(runId, attemptId, { code: "runtime_error", reason: "fixture" }, "Error", 0);
}

test("an instruction is normalized, idempotent and applied only to its target's first Attempt", () => {
  const { store, runId } = setup();
  assert.deepEqual(store.queueInstruction(runId, { ...input, id: ` ${input.id} `, text: ` ${input.text} ` }), {
    ...input,
    status: "queued",
  });
  const queuedEvents = store.eventsAfter(runId, 0);
  assert.equal(store.queueInstruction(runId, input).status, "queued");
  assert.deepEqual(store.eventsAfter(runId, 0), queuedEvents);
  const researcher = store.startAttempt(runId, "researcher");
  assert.equal(store.attemptInstruction(runId, researcher), null);
  failAttempt(store, runId, researcher);
  const planner = store.startAttempt(runId, "research-plan");
  assert.equal(store.attemptInstruction(runId, planner), input.text);
  assert.deepEqual(store.queueInstruction(runId, input), { ...input, status: "applied", attemptId: planner });
  const applied = store.eventsAfter(runId, 0).filter((event) => event.kind === "harness.instruction_applied");
  assert.equal(applied.length, 1);
  assert.equal(applied[0]!.payload.attempt_id, planner);
  assert.equal(store.attemptInstruction(store.createRun("another question"), planner), null);
  failAttempt(store, runId, planner);
  const laterPlanner = store.startAttempt(runId, "research-plan");
  assert.equal(store.attemptInstruction(runId, laterPlanner), null);
  assert.equal(store.eventsAfter(runId, 0).filter((event) => event.kind === "harness.instruction_applied").length, 1);
});

test.each([
  { ...input, id: " " },
  { ...input, id: "a".repeat(129) },
  { ...input, text: " " },
  { ...input, text: "a".repeat(2_001) },
  { ...input, role: "arbitrary-agent" as Role },
])("invalid instruction input is rejected without writing events", (invalid) => {
  const { store, runId } = setup();
  const before = store.eventsAfter(runId, 0);
  assert.throws(() => store.queueInstruction(runId, invalid), controlError("invalid"));
  assert.deepEqual(store.eventsAfter(runId, 0), before);
});

test("an unknown run is not created by an instruction", () => {
  const { store } = setup();
  assert.throws(() => store.queueInstruction("missing", input), controlError("not_found"));
});

test("instruction ID reuse with different payload and multiple instructions for one role conflict", () => {
  const { store, runId } = setup();
  store.queueInstruction(runId, input);
  assert.throws(() => store.queueInstruction(runId, { ...input, text: "different" }), controlError("conflict"));
  assert.throws(() => store.queueInstruction(runId, { ...input, role: "reviewer" }), controlError("conflict"));
  assert.throws(() => store.queueInstruction(runId, { ...input, id: "instruction-2" }), controlError("conflict"));
  assert.equal(
    store.queueInstruction(runId, { ...input, id: "reviewer-instruction", role: "reviewer" }).status,
    "queued",
  );
});

test("a started role and a stopping run refuse new instructions", () => {
  const { store, runId } = setup();
  const planner = store.startAttempt(runId, "research-plan");
  assert.throws(() => store.queueInstruction(runId, input), controlError("conflict"));
  failAttempt(store, runId, planner);
  assert.throws(() => store.queueInstruction(runId, input), controlError("conflict"));
  store.emit(runId, "harness.stop_requested", { source: "user" });
  assert.throws(() => store.queueInstruction(runId, { ...input, role: "reviewer" }), controlError("conflict"));
});

test.each([{ science125Id: 1 }, { memoryArm: "on" as const }, { memoryArm: "off" as const }])(
  "benchmark origins refuse instruction injection",
  (origin) => {
    const { store } = setup();
    const runId = store.createRun("benchmark", origin);
    assert.throws(() => store.queueInstruction(runId, input), controlError("conflict"));
  },
);

test.each(["completed", "failed", "review_rejected"] as const)(
  "%s discards pending instructions exactly once",
  (status) => {
    const { store, runId } = setup();
    const queued = { ...input, role: "reviewer" as const };
    store.queueInstruction(runId, queued);
    let finalArtifactId: string | undefined;
    if (status === "completed") {
      const attemptId = store.startAttempt(runId, "research-plan");
      finalArtifactId = store.publishArtifact(runId, attemptId, { artifact_type: "research-plan" } as never, [], 0).id;
    }
    store.finishRun(runId, status, { finalArtifactId });
    assert.deepEqual(store.queueInstruction(runId, queued), { ...queued, status: "discarded" });
    assert.throws(() => store.queueInstruction(runId, { ...input, id: "new" }), controlError("conflict"));
    store.finishRun(runId, status, { finalArtifactId });
    assert.equal(
      store.eventsAfter(runId, 0).filter((event) => event.kind === "harness.instruction_discarded").length,
      1,
    );
  },
);

test("abandoned and restarted runs discard pending instructions without erasing applied ones", () => {
  const directory = mkdtempSync(join(tmpdir(), "luup-instructions-"));
  onTestFinished(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "runs.db");
  const store = new SqliteStore(path);
  const runId = store.createRun("freeform");
  store.queueInstruction(runId, input);
  const planner = store.startAttempt(runId, "research-plan");
  const pending = { ...input, id: "pending", role: "reviewer" as const };
  store.queueInstruction(runId, pending);
  const interruptedId = store.createRun("process restart");
  store.queueInstruction(interruptedId, input);
  store.settleAbandonedRun(runId, "interrupted", "UserCancellation");
  assert.equal(store.attemptInstruction(runId, planner), input.text);
  assert.equal(store.queueInstruction(runId, pending).status, "discarded");
  store.close();
  const reopened = new SqliteStore(path);
  onTestFinished(() => reopened.close());
  assert.equal(reopened.queueInstruction(interruptedId, input).status, "discarded");
  assert.equal(reopened.queueInstruction(runId, input).status, "applied");
  assert.equal(reopened.attemptInstruction(runId, planner), input.text);
});
