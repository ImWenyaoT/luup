import assert from "node:assert/strict";
import test from "node:test";

import { ContractError, StageError } from "../src/agent/failures.ts";
import { usageOf, type StageUsage } from "../src/executor.ts";
import { runTask } from "../src/roles.ts";
import type { StageExecutor } from "../src/roles.ts";
import type { TaskContext } from "../src/store/contracts.ts";
import { SqliteStore } from "../src/store/store.ts";

/** SDK 失败时挂在异常上的那份状态：`AgentsError.state`（RunState.usage + _generatedItems）。 */
function withState(error: Error, usage: Record<string, number>, toolCalls = 0): Error {
  (error as { state?: unknown }).state = {
    usage,
    _generatedItems: Array.from({ length: toolCalls }, () => ({ type: "tool_call_item" })),
  };
  return error;
}

const context: TaskContext = {
  runId: "run",
  taskId: "attempt",
  role: "reviewer",
  goal: "独立评审研究计划",
  question: "问题",
  inputArtifactIds: [],
  inputArtifacts: [],
};

test("usage already spent is read back from the SDK error", () => {
  const error = withState(new Error("boom"), {
    requests: 2,
    inputTokens: 100,
    outputTokens: 40,
    totalTokens: 140,
  }, 3);

  assert.deepEqual(usageOf(error), {
    requests: 2,
    inputTokens: 100,
    outputTokens: 40,
    totalTokens: 140,
    toolCalls: 3,
  });
});

test("unknown usage is null rather than a row of zeros", () => {
  assert.equal(usageOf(new Error("no state")), null);
  assert.equal(usageOf(withState(new Error("half"), { requests: 1 })), null);
  assert.equal(usageOf(undefined), null);
});

test("a failed Attempt carries the usage of both of its calls", async () => {
  const spent: StageUsage = { requests: 1, inputTokens: 10, outputTokens: 4, totalTokens: 14, toolCalls: 1 };
  let call = 0;
  const execute: StageExecutor = () => {
    call += 1;
    // executor 已经把用量挂在它抛出的分类异常上；这里模拟那一步。
    const error = call === 1
      ? new ContractError("模型写错了")
      : new StageError("provider_error", "provider 挂了");
    return Promise.reject(Object.assign(error, { usage: spent }));
  };

  const failure = await runTask(context, { execute }).then(
    () => null,
    (error: unknown) => error as { corrections?: number; usage?: StageUsage },
  );

  assert.equal(call, 2, "第一次是可纠错的合同违规，应当再试一次");
  assert.equal(failure?.corrections, 1);
  // 只带最后一次调用的用量，就等于把纠错轮之前烧掉的 token 从账上抹掉。
  assert.deepEqual(failure?.usage, {
    requests: 2, inputTokens: 20, outputTokens: 8, totalTokens: 28, toolCalls: 2,
  });
});

test("a stage failure calls once and still carries its usage", async () => {
  const spent: StageUsage = { requests: 1, inputTokens: 7, outputTokens: 0, totalTokens: 7, toolCalls: 0 };
  const execute: StageExecutor = () =>
    Promise.reject(Object.assign(new StageError("deadline_exceeded", "超时"), { usage: spent }));

  const failure = await runTask(context, { execute }).then(
    () => null,
    (error: unknown) => error as { corrections?: number; usage?: StageUsage },
  );

  assert.equal(failure?.corrections, 0);
  assert.deepEqual(failure?.usage, spent);
});

test("an error without usage facts gains no usage field", async () => {
  const execute: StageExecutor = () => Promise.reject(new StageError("provider_error", "provider 挂了"));
  const failure = await runTask(context, { execute }).then(
    () => null,
    (error: unknown) => error as { usage?: StageUsage },
  );
  assert.equal(failure?.usage, undefined);
});

test("failAttempt records the usage already spent as one sdk.usage event", () => {
  const store = new SqliteStore(":memory:");
  const runId = store.createRun("问题");
  const attemptId = store.startAttempt(runId, "reviewer");

  store.failAttempt(runId, attemptId, { code: "provider_error", reason: "boom" }, "StageError", 1, {
    agent: "reviewer",
    inputTokens: 20,
    outputTokens: 8,
    totalTokens: 28,
  });

  const events = store.eventsAfter(runId, 0);
  const usage = events.find((event) => event.kind === "sdk.usage");
  assert.deepEqual(usage?.payload, {
    agent: "reviewer", input_tokens: 20, output_tokens: 8, total_tokens: 28,
  });
  // 用量发生在失败之前，事件顺序要说得通。
  assert.ok(usage!.version < events.find((event) => event.kind === "attempt.failed")!.version);
  store.close();
});

test("failAttempt invents no usage event when there is no usage fact", () => {
  const store = new SqliteStore(":memory:");
  const runId = store.createRun("问题");
  const attemptId = store.startAttempt(runId, "reviewer");

  store.failAttempt(runId, attemptId, { code: "provider_error", reason: "boom" }, "StageError", 0);

  assert.equal(store.eventsAfter(runId, 0).some((event) => event.kind === "sdk.usage"), false);
  store.close();
});
