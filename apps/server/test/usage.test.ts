import { passingReviewFoundations } from "./fixtures/review-foundations.ts";
import assert from "node:assert/strict";
import { test } from "vitest";

import { ContractError, StageError } from "../src/agent/failures.ts";
import { EvidenceLedger } from "../src/agent/evidence.ts";
import { reportStructuredOutput } from "../src/agent/roles/structured-output.ts";
import { createDeterministicRuntime, createDeterministicVerifier } from "../src/executor-deterministic.ts";
import { usageOf, type StageUsage } from "../src/executor.ts";
import { Harness } from "../src/harness.ts";
import { runTask } from "../src/roles.ts";
import type { StageExecutor } from "../src/roles.ts";
import type { TaskContext } from "../src/agent/contracts.ts";
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
  const error = withState(
    new Error("boom"),
    {
      requests: 2,
      inputTokens: 100,
      outputTokens: 40,
      totalTokens: 140,
    },
    3,
  );

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
    const error = call === 1 ? new ContractError("模型写错了") : new StageError("provider_error", "provider 挂了");
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
    requests: 2,
    inputTokens: 20,
    outputTokens: 8,
    totalTokens: 28,
    toolCalls: 2,
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
    agent: "reviewer",
    input_tokens: 20,
    output_tokens: 8,
    total_tokens: 28,
  });
  // 用量发生在失败之前，事件顺序要说得通。
  assert.ok(usage!.version < events.find((event) => event.kind === "attempt.failed")!.version);
  store.close();
});

test("a stage failure inside the Harness lands its usage in the database", async () => {
  const store = new SqliteStore(":memory:");
  const spent: StageUsage = { requests: 1, inputTokens: 31, outputTokens: 5, totalTokens: 36, toolCalls: 0 };
  const execute: StageExecutor = () =>
    Promise.reject(Object.assign(new StageError("provider_error", "provider 挂了"), { usage: spent }));

  const runId = store.createRun("问题");
  const outcome = await new Harness(store, execute).execute(runId);

  assert.equal(outcome.status, "failed");
  assert.equal(outcome.errorCode, "provider_error");
  // 记账的最后一环：executor 挂在异常上的用量要一路走到库里，否则失败的成本被抹掉。
  const events = store.eventsAfter(runId, 0);
  const usage = events.find((event) => event.kind === "sdk.usage");
  assert.deepEqual(usage?.payload, {
    agent: "researcher",
    input_tokens: 31,
    output_tokens: 5,
    total_tokens: 36,
  });
  assert.ok(usage!.version < events.find((event) => event.kind === "attempt.failed")!.version);
  store.close();
});

test("a Harness failure without usage facts writes no usage event", async () => {
  const store = new SqliteStore(":memory:");
  const execute: StageExecutor = () => Promise.reject(new StageError("provider_error", "provider 挂了"));

  const runId = store.createRun("问题");
  await new Harness(store, execute).execute(runId);

  assert.equal(
    store.eventsAfter(runId, 0).some((event) => event.kind === "sdk.usage"),
    false,
  );
  store.close();
});

test("failAttempt invents no usage event when there is no usage fact", () => {
  const store = new SqliteStore(":memory:");
  const runId = store.createRun("问题");
  const attemptId = store.startAttempt(runId, "reviewer");

  store.failAttempt(runId, attemptId, { code: "provider_error", reason: "boom" }, "StageError", 0);

  assert.equal(
    store.eventsAfter(runId, 0).some((event) => event.kind === "sdk.usage"),
    false,
  );
  store.close();
});

/** reviewer 的冻结输入保留基础审查引用的真实计划字段。 */
const reviewerInputs = [
  {
    id: "plan",
    type: "research-plan",
    content: {
      problem_statement: "比较冻结证据门对错误引用的影响。",
      execution_plan: {
        predictions: [{ prediction: "错误引用减少。", falsification_criterion: "错误引用未减少。" }],
        steps: [{ order: 1, action: "比较固定样本的引用。", expected_output: "逐项记录。" }],
      },
      verification_evidence_ids: ["ev_reviewer"],
      references: ["https://arxiv.org/abs/2303.08774"],
    },
  },
  { id: "review", type: "evidence-review", content: {} },
];

const review = {
  artifact_type: "review",
  foundation_checks: passingReviewFoundations(),
  research_plan_artifact_id: "will be overwritten",
  evidence_review_artifact_id: "will be overwritten",
  independent_evidence_ids: ["ev_reviewer"],
  scores: { scientific_value: 4, technical_depth: 4, application_potential: 4 },
  weaknesses: [],
  feedback: [],
  suggested_successor_roles: [],
  accepted: true,
};

test.each([null, true, false])(
  "successful correction accounts for known and unknown calls (%s)",
  async (knownFirst) => {
    const spent: StageUsage = { requests: 1, inputTokens: 10, outputTokens: 4, totalTokens: 14, toolCalls: 0 };
    const ledger = new EvidenceLedger();
    let call = 0;
    const execute: StageExecutor = ({ agent, onUsage }) => {
      call += 1;
      if (knownFirst === null || (call === 1) === knownFirst) onUsage?.(spent);
      // 首轮：模型调用成功（用量已经发生），产物被合同门驳回。
      if (call === 1) {
        return Promise.reject(new ContractError("产物违反后置约束"));
      }
      const evidence = ledger.record({
        tool: "arxiv_search",
        sourceType: "arxiv",
        query: "reviewer search",
        status: "succeeded",
        resultSummary: "one source",
        citations: [{ source_type: "arxiv", title: "source", locator: "arxiv:1", url: null }],
      });
      return reportStructuredOutput(agent, { ...review, independent_evidence_ids: [evidence.evidenceId] });
    };

    const result = await runTask(
      { ...context, inputArtifacts: reviewerInputs, inputArtifactIds: ["plan", "review"] },
      { execute, ledger },
    );

    assert.equal(call, 2);
    assert.equal(result.corrections, 1);
    // 被驳回的那一轮同样烧掉了 token —— 只记交出 Artifact 的那次就是漏账。
    assert.deepEqual(result.usage, {
      ...(knownFirst === null ? {} : { incomplete: true }),
      requests: knownFirst === null ? 2 : 1,
      inputTokens: knownFirst === null ? 20 : 10,
      outputTokens: knownFirst === null ? 8 : 4,
      totalTokens: knownFirst === null ? 28 : 14,
      toolCalls: 0,
    });
  },
);

test("an executor that reports no usage leaves the Attempt usage unknown", async () => {
  const ledger = new EvidenceLedger();
  const execute: StageExecutor = ({ agent }) => {
    const evidence = ledger.record({
      tool: "arxiv_search",
      sourceType: "arxiv",
      query: "reviewer search",
      status: "succeeded",
      resultSummary: "one source",
      citations: [{ source_type: "arxiv", title: "source", locator: "arxiv:1", url: null }],
    });
    return reportStructuredOutput(agent, { ...review, independent_evidence_ids: [evidence.evidenceId] });
  };
  const result = await runTask(
    { ...context, inputArtifacts: reviewerInputs, inputArtifactIds: ["plan", "review"] },
    { execute, ledger },
  );
  assert.equal(result.usage, null);
});

test("publishArtifact records the usage as one event ahead of the published artifact", () => {
  const store = new SqliteStore(":memory:");
  const runId = store.createRun("问题");
  const attemptId = store.startAttempt(runId, "reviewer");

  store.publishArtifact(runId, attemptId, review as any, [], 0, {
    agent: "reviewer",
    inputTokens: 20,
    outputTokens: 8,
    totalTokens: 28,
  });

  const events = store.eventsAfter(runId, 0);
  const usage = events.filter((event) => event.kind === "sdk.usage");
  assert.equal(usage.length, 1);
  assert.deepEqual(usage[0]!.payload, {
    agent: "reviewer",
    input_tokens: 20,
    output_tokens: 8,
    total_tokens: 28,
  });
  // 与失败路径同一形状：用量发生在终态事件之前。
  assert.ok(usage[0]!.version < events.find((event) => event.kind === "artifact.published")!.version);
  store.close();
});

test("publishArtifact invents no usage event when there is no usage fact", () => {
  const store = new SqliteStore(":memory:");
  const runId = store.createRun("问题");
  const attemptId = store.startAttempt(runId, "reviewer");

  store.publishArtifact(runId, attemptId, review as any, [], 0);

  assert.equal(
    store.eventsAfter(runId, 0).some((event) => event.kind === "sdk.usage"),
    false,
  );
  store.close();
});

test("every completed Attempt of a whole run lands exactly one usage event", async () => {
  const store = new SqliteStore(":memory:");
  const runtime = createDeterministicRuntime(store);
  const spent: StageUsage = { requests: 1, inputTokens: 100, outputTokens: 40, totalTokens: 140, toolCalls: 1 };
  // 离线替身不花钱，所以由这层替它报一份用量 —— 验的是记账通路，不是替身的账。
  const execute: StageExecutor = (request) => {
    request.onUsage?.(spent);
    return runtime.execute(request);
  };

  const runId = store.createRun("问题");
  const outcome = await new Harness(store, execute, {
    createLedger: runtime.createLedger,
    verifyReferences: createDeterministicVerifier(),
  }).execute(runId);

  assert.equal(outcome.status, "completed");
  const events = store.eventsAfter(runId, 0);
  const usage = events.filter((event) => event.kind === "sdk.usage");
  const published = events.filter((event) => event.kind === "artifact.published");
  // 成对：每个成功 Attempt 一条，不多也不少 —— 多一条就是双写。
  assert.equal(usage.length, published.length);
  assert.equal(usage.length, 5);
  for (const [index, event] of usage.entries()) {
    assert.equal(event.version + 1, published[index]!.version);
  }
  assert.equal(
    usage.reduce((total, event) => total + Number(event.payload.total_tokens), 0),
    5 * spent.totalTokens,
  );
  store.close();
});

test.each([true, false])(
  "correction usage is incomplete when one call is unknown (known first: %s)",
  async (knownFirst) => {
    const usage: StageUsage = { requests: 1, inputTokens: 10, outputTokens: 4, totalTokens: 14, toolCalls: 0 };
    let calls = 0;
    const execute: StageExecutor = () => {
      const first = calls++ === 0;
      const error = first ? new ContractError("修正结构") : new StageError("provider_error", "provider unavailable");
      return Promise.reject(first === knownFirst ? Object.assign(error, { usage }) : error);
    };
    await assert.rejects(runTask(context, { execute }), (error: unknown) => {
      assert.deepEqual((error as { usage?: StageUsage }).usage, { ...usage, incomplete: true });
      return true;
    });
  },
);
