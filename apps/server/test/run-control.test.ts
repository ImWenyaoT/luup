import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { onTestFinished, test, vi } from "vitest";
import { projectRunSnapshot } from "../src/api/projection.ts";
import { createDeterministicRuntime, createDeterministicVerifier } from "../src/executor-deterministic.ts";
import { Harness } from "../src/harness.ts";
import type { StageExecutor } from "../src/roles.ts";
import { createApp } from "../src/server.ts";
import { RunScheduler } from "../src/run-scheduler.ts";
import { ControlSubmissionError, SqliteStore } from "../src/store/store.ts";
import { StageError } from "../src/agent/failures.ts";
import { findQuestion } from "../src/domain/science125.ts";
import { createHarnessRunner } from "../src/batch/runner.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function until(predicate: () => boolean) {
  for (let tick = 0; tick < 100; tick++) {
    if (predicate()) return;
    await sleep(5);
  }
  assert.fail("expected control state did not settle");
}

function fixture(wrap: (execute: StageExecutor) => StageExecutor = (execute) => execute) {
  const store = new SqliteStore(":memory:");
  const runtime = createDeterministicRuntime(store);
  const harness = new Harness(store, wrap(runtime.execute), {
    createLedger: runtime.createLedger,
    verifyReferences: createDeterministicVerifier(),
  });
  const errors: unknown[] = [];
  const scheduler = new RunScheduler(store, harness, (_message, error) => errors.push(error));
  onTestFinished(async () => {
    await scheduler.close();
    store.close();
  });
  return { store, harness, scheduler, errors };
}

test("batch cancellation enters the same Harness signal path and preserves its infra_timeout classification", async () => {
  const store = new SqliteStore(":memory:");
  onTestFinished(() => store.close());
  const runId = store.createRun("Timed out batch question", { science125Id: 1 });
  const reason = new StageError("infra_timeout", "Batch deadline");
  const outcome = await createHarnessRunner(store)({
    runId,
    questionId: 1,
    question: findQuestion(1)!,
    signal: AbortSignal.abort(reason),
  });
  assert.equal(outcome.status, "failed");
  assert.equal(store.readRunOutcome(runId)!.errorCode, "infra_timeout");
  assert.equal(store.snapshot(runId)!.attempts.length, 0);
});

test("queued cancellation skips execution; an active cancellation holds its slot until the executor exits", async () => {
  const release = deferred();
  const entered = new Set<string>();
  const { store, scheduler, errors } = fixture((execute) => async (request) => {
    // Capture before waiting: this fixture deliberately returns a late successful result after cancellation.
    const result = await execute(request);
    entered.add(request.runId);
    request.onUsage?.({ requests: 1, inputTokens: 8, outputTokens: 2, totalTokens: 10, toolCalls: 1 });
    await release.promise;
    return result;
  });
  onTestFinished(() => release.resolve());
  const ids = ["first", "second", "queued", "replacement"].map((question) => store.createRun(question));
  ids.slice(0, 3).forEach((id) => scheduler.schedule(id));
  scheduler.schedule(ids[0]!);
  await until(() => entered.size === 2);
  assert.equal(scheduler.size, 3);
  assert.equal(scheduler.cancel(ids[2]!), "settled");
  assert.equal(scheduler.cancel(ids[2]!), "settled");
  assert.equal(store.snapshot(ids[2]!)!.attempts.length, 0);
  assert.equal(scheduler.cancel(ids[0]!), "stopping");
  assert.equal(scheduler.cancel(ids[0]!), "stopping");
  scheduler.schedule(ids[3]!);
  await sleep(10);
  assert.equal(entered.size, 2);
  assert.equal(store.snapshot(ids[0]!)!.status, "running");
  release.resolve();
  await until(() => scheduler.size === 0);
  const cancelled = store.snapshot(ids[0]!)!;
  assert.equal(cancelled.status, "failed");
  assert.equal(cancelled.error_code, "interrupted");
  assert.equal(cancelled.artifacts.length, 0);
  assert.equal(cancelled.attempts.length, 1);
  assert.equal(cancelled.attempts[0].status, "failed");
  const events = store.eventsAfter(ids[0]!, 0);
  assert.equal(events.filter((event) => event.kind === "harness.stop_requested").length, 1);
  assert.equal(events.filter((event) => event.kind === "harness.dispatched").length, 1);
  assert.equal(events.filter((event) => event.kind === "sdk.usage").length, 1);
  assert.equal(events.find((event) => event.kind === "sdk.usage")!.payload.total_tokens, 10);
  assert.ok(entered.has(ids[3]!));
  assert.deepEqual(errors, []);
});

test("a queued instruction reaches only its chosen role and cannot restart a completed branch", async () => {
  const inputs: Array<{ role: string; question: string; instruction?: string }> = [];
  const { store, harness } = fixture((execute) => async (request) => {
    const payload = JSON.parse(request.input);
    inputs.push({ role: request.role, question: payload.question, instruction: payload.user_instruction });
    return execute(request);
  });
  const runId = store.createRun("Frozen question");
  const instruction = { id: "once", role: "research-plan" as const, text: "列出可测量的成功条件。" };
  store.queueInstruction(runId, instruction);
  assert.equal((await harness.execute(runId)).status, "completed");
  assert.equal(inputs.length, 5);
  assert.ok(inputs.every((input) => input.question === "Frozen question"));
  assert.deepEqual(
    inputs.filter((input) => input.instruction),
    [{ role: "research-plan", question: "Frozen question", instruction: instruction.text }],
  );
  assert.equal(store.queueInstruction(runId, instruction).status, "applied");
  assert.throws(() => store.queueInstruction(runId, { ...instruction, id: "again" }), ControlSubmissionError);
  assert.equal((await harness.execute(runId)).status, "completed");
  assert.equal(inputs.length, 5);
});

test("cancellation while verifying rejects a late valid result and never records SUCCESS memory", async () => {
  const store = new SqliteStore(":memory:");
  onTestFinished(() => store.close());
  const runtime = createDeterministicRuntime(store);
  const entered = deferred();
  const release = deferred();
  const written: string[] = [];
  const harness = new Harness(store, runtime.execute, {
    createLedger: runtime.createLedger,
    verifyReferences: async (input) => {
      entered.resolve();
      await release.promise;
      return createDeterministicVerifier()({ ...input, signal: undefined });
    },
    memory: {
      readPriorAttempts: () => ({ status: "empty", entries: [], reason: null }),
      recordRun: ({ status }) => {
        written.push(status);
        return { status: "written", reason: null };
      },
    },
  });
  const controller = new AbortController();
  const runId = store.createRun("Cancel verification");
  const done = harness.execute(runId, { signal: controller.signal });
  await entered.promise;
  controller.abort(new Error("stop"));
  release.resolve();
  assert.equal((await done).status, "failed");
  assert.equal(store.readRunOutcome(runId)!.errorCode, "interrupted");
  assert.deepEqual(written, ["failed"]);
  assert.equal(
    store.eventsAfter(runId, 0).some((event) => event.kind === "run.completed"),
    false,
  );
});

test("completed outcomes win over a later cancellation and closed schedulers reject new work", async () => {
  const { store, scheduler } = fixture();
  const runId = store.createRun("Complete first");
  scheduler.schedule(runId);
  await until(() => scheduler.size === 0);
  const before = store.eventsAfter(runId, 0);
  assert.equal(scheduler.cancel(runId), "settled");
  assert.equal(store.readRunOutcome(runId)!.status, "completed");
  scheduler.schedule(runId);
  assert.deepEqual(store.eventsAfter(runId, 0), before);
  assert.throws(() => scheduler.cancel(store.createRun("unowned")), ControlSubmissionError);
  await scheduler.close();
  assert.throws(() => scheduler.schedule(store.createRun("closed")), ControlSubmissionError);
});

test("subagent progress uses explicit Attempt lineage, includes correction calls and hides instruction text", () => {
  const { store } = fixture();
  const runId = store.createRun("Progress");
  store.queueInstruction(runId, { id: "private", role: "researcher", text: "private input" });
  const attemptId = store.startAttempt(runId, "researcher");
  for (let n = 0; n < 2; n++) {
    const payload = { attempt_id: attemptId, trace_id: `trace-${n}`, tool: "arxiv_search", secret: "not public" };
    store.emit(runId, "sdk.trace.started", payload);
    store.emit(runId, "sdk.trace.tool_started", payload);
    store.emit(runId, "sdk.trace.tool_ended", { ...payload, status: "completed" });
    store.emit(runId, "sdk.trace.ended", { ...payload, usage_tool_calls: 4, truncated: true });
  }
  store.emit(runId, "sdk.trace.tool_started", { attempt_id: "other", trace_id: "other", tool: "private_tool" });
  const snapshot = projectRunSnapshot(store.snapshot(runId)!);
  assert.equal(snapshot.subagents[0]!.tool_calls, 8);
  assert.equal(snapshot.subagents[0]!.recent_activity.length, 4);
  assert.equal(snapshot.subagents[0]!.recent_activity[0]!.status, "started");
  const serialized = JSON.stringify(snapshot);
  assert.ok(!serialized.includes("private input"));
  assert.ok(!serialized.includes("not public"));
  assert.equal(
    snapshot.recent_events.find((event) => event.kind === "sdk.trace.started")!.payload.attempt_id,
    attemptId,
  );
  const historical = store.createRun("No observed trace");
  store.startAttempt(historical, "researcher");
  assert.equal(projectRunSnapshot(store.snapshot(historical)!).subagents[0]!.tool_calls, null);
});

async function setup() {
  vi.stubEnv("LUUP_API_TOKEN", "control-test-token");
  const store = new SqliteStore(":memory:");
  const runtime = createDeterministicRuntime(store);
  const entered = deferred();
  const release = deferred();
  const harness = new Harness(
    store,
    async (request) => {
      const result = await runtime.execute(request);
      entered.resolve();
      // Deliberately uncooperative fixture to expose shutdown and cancellation admission races.
      await release.promise;
      return result;
    },
    { createLedger: runtime.createLedger, verifyReferences: createDeterministicVerifier() },
  );
  const server = createApp({ store, harness, runtime: "deterministic" });
  await server.ready;
  let stopped = false;
  onTestFinished(async () => {
    release.resolve();
    if (!stopped) await server.stop(true);
    store.close();
    vi.unstubAllEnvs();
  });
  const request = (path: string, body: unknown = {}, token = "control-test-token", contentType = "application/json") =>
    server.fetch(
      new Request(`${server.url.origin}${path}`, {
        method: "POST",
        headers: { "content-type": contentType, authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      }),
    );
  return {
    store,
    server,
    entered,
    release,
    request,
    markStopped: () => {
      stopped = true;
    },
  };
}

test("control routes authenticate, validate, persist idempotent instructions and reject started targets", async () => {
  const { request, entered, store } = await setup();
  const created = await (await request("/api/runs", { question: "Controlled research" })).json();
  await entered.promise;
  const path = `/api/runs/${created.id}/instructions`;
  const instruction = { instruction_id: "same", role: "research-plan", instruction: "明确检验条件" };
  assert.equal((await request(path, instruction, "wrong")).status, 401);
  assert.equal((await request(`/api/runs/${created.id}/cancel`, {}, "wrong")).status, 401);
  assert.equal((await request(path, instruction, "control-test-token", "text/plain")).status, 415);
  assert.equal((await request(path, [])).status, 400);
  assert.equal((await request(path, {})).status, 422);
  assert.equal((await request(path, { ...instruction, role: "researcher" })).status, 409);
  const queued = await request(path, instruction);
  assert.equal(queued.status, 202);
  assert.deepEqual(await queued.json(), { status: "queued", instruction_id: "same", role: "research-plan" });
  assert.equal((await request(path, instruction)).status, 202);
  assert.equal(
    store.eventsAfter(created.id, 0).filter((event) => event.kind === "harness.instruction_queued").length,
    1,
  );
  assert.equal((await request(path, { ...instruction, instruction: "changed" })).status, 409);
  assert.equal((await request("/api/runs/missing/instructions", instruction)).status, 404);
  assert.equal((await request("/api/runs/missing/cancel")).status, 404);
  assert.equal((await request(`/api/runs/${created.id}/cancel`)).status, 202);
  assert.equal((await request(`/api/runs/${created.id}/cancel`)).status, 202);
  assert.equal((await request(path, { ...instruction, instruction_id: "new", role: "reviewer" })).status, 409);
  assert.equal((await request(path, instruction)).status, 202);
});

test("shutdown rejects admission before creating a Run and cancellation settles existing work", async () => {
  const { store, server, request, entered, release, markStopped } = await setup();
  const created = await (await request("/api/runs", { question: "First research" })).json();
  await entered.promise;
  const create = vi.spyOn(store, "createRun");
  const closing = server.stop(true);
  const rejected = await request("/api/runs", { question: "Must not be created" });
  assert.equal(rejected.status, 503);
  assert.equal(create.mock.calls.length, 0);
  const ready = await server.fetch(new Request(`${server.url.origin}/readyz`));
  assert.equal(ready.status, 503);
  release.resolve();
  await closing;
  markStopped();
  assert.equal(store.readRunOutcome(created.id)!.errorCode, "interrupted");
  assert.equal((await request(`/api/runs/${created.id}/cancel`)).status, 200);
});

test("queued cancellation never starts an Attempt and yields discarded receipts", async () => {
  const { request, entered, store } = await setup();
  await request("/api/runs", { question: "First" });
  await entered.promise;
  await request("/api/runs", { question: "Second" });
  const queued = await (await request("/api/runs", { question: "Waiting" })).json();
  const path = `/api/runs/${queued.id}`;
  const instruction = { instruction_id: "unused", role: "researcher", instruction: "Use verified evidence" };
  assert.equal((await request(`${path}/instructions`, instruction)).status, 202);
  assert.equal((await request(`${path}/cancel`)).status, 200);
  await sleep(5);
  assert.equal(store.snapshot(queued.id)!.attempts.length, 0);
  const receipt = await request(`${path}/instructions`, instruction);
  assert.equal(receipt.status, 200);
  assert.equal((await receipt.json()).status, "discarded");
});
