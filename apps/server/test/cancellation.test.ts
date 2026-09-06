import assert from "node:assert/strict";
import { createServer } from "node:http";
import { Agent, tool } from "@openai/agents";
import { z } from "zod";
import { onTestFinished, test, vi } from "vitest";

import { ContractError, StageError } from "../src/agent/failures.ts";
import { createQwenExecutor } from "../src/executor.ts";
import { createDeterministicRuntime } from "../src/executor-deterministic.ts";
import { SqliteStore } from "../src/store/store.ts";
import { runTask, type StageExecutor } from "../src/roles.ts";
import { clearModelOverride, modelForRole, setModelOverride } from "../src/seams/model.ts";

const context = {
  runId: "cancelled",
  taskId: "attempt",
  role: "reviewer" as const,
  goal: "review",
  question: "问题",
  inputArtifactIds: [],
  inputArtifacts: [],
};
const usage = { requests: 1, inputTokens: 10, outputTokens: 4, totalTokens: 14, toolCalls: 0 };

test("a pre-cancelled task never invokes its executor", async () => {
  const reason = new Error("run cancelled");
  let calls = 0;
  await assert.rejects(
    runTask(context, {
      signal: AbortSignal.abort(reason),
      execute: () => {
        calls += 1;
        return Promise.resolve("unused");
      },
    }),
    (error) => error === reason,
  );
  assert.equal(calls, 0);
});

test.each([false, true])(
  "cancellation rejects late results and never starts correction (reject: %s)",
  async (reject) => {
    const controller = new AbortController();
    const reason = new ContractError("cancelled despite a correction-shaped error");
    let calls = 0;
    const execute: StageExecutor = ({ signal, onUsage }) => {
      calls += 1;
      assert.equal(signal, controller.signal);
      onUsage?.(usage);
      controller.abort(reason);
      return reject ? Promise.reject(new ContractError("late malformed output")) : Promise.resolve("late output");
    };
    await assert.rejects(runTask(context, { signal: controller.signal, execute }), (error) => {
      assert.equal(error, reason);
      assert.deepEqual((error as Error & { usage?: unknown }).usage, usage);
      return true;
    });
    assert.equal(calls, 1);
  },
);

test.each(["caller", "deadline", "caller_with_usage"] as const)(
  "%s cancellation aborts the real SDK HTTP request with the correct reason",
  async (source) => {
    const controller = new AbortController();
    const reason = new Error("caller cancelled");
    let started!: () => void;
    const requestStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    let disconnected!: () => void;
    const requestDisconnected = new Promise<void>((resolve) => {
      disconnected = resolve;
    });
    let requests = 0;
    const server = createServer((request, response) => {
      request.resume();
      requests += 1;
      if (source === "caller_with_usage" && requests === 1) {
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({
            id: "resp_1",
            object: "response",
            status: "completed",
            created_at: 0,
            usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 },
            output: [
              {
                type: "function_call",
                id: "fc_1",
                call_id: "call_1",
                name: "probe",
                arguments: "{}",
                status: "completed",
              },
            ],
          }),
        );
        return;
      }
      response.on("close", disconnected);
      started();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const origin = `http://127.0.0.1:${address.port}`;
    const originalFetch = globalThis.fetch;
    vi.stubGlobal("fetch", ((input, init) => {
      assert.equal(new URL(input instanceof Request ? input.url : String(input)).origin, origin);
      return originalFetch(input, init);
    }) satisfies typeof fetch);
    setModelOverride({ apiKey: "local-test-only", baseUrl: `${origin}/v1`, modelId: "cancel-test" });
    onTestFinished(async () => {
      vi.unstubAllGlobals();
      clearModelOverride();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    const pending = createQwenExecutor()({
      runId: "cancel",
      role: "reviewer",
      agent: new Agent({
        name: "cancel",
        model: modelForRole(),
        tools: [tool({ name: "probe", description: "local probe", parameters: z.object({}), execute: () => "done" })],
      }),
      input: "{}",
      timeoutMs: source === "deadline" ? 100 : 2_000,
      signal: controller.signal,
    });
    const rejected = assert.rejects(pending, (error) =>
      source !== "deadline" ? error === reason : error instanceof StageError && error.code === "deadline_exceeded",
    );
    await requestStarted;
    if (source !== "deadline") controller.abort(reason);
    await rejected;
    await requestDisconnected;
    if (source === "caller_with_usage") {
      assert.deepEqual((reason as Error & { usage?: unknown }).usage, { ...usage, toolCalls: 1, incomplete: true });
    }
  },
);

test.each([undefined, "", "限定研究范围"])(
  "a task freezes its user instruction across correction (%s)",
  async (userInstruction) => {
    const inputs: Array<Record<string, unknown>> = [];
    const taskContext = { ...context, userInstruction, priorAttempts: ["frozen prior"] };
    await assert.rejects(
      runTask(taskContext, {
        execute: ({ input }) => {
          inputs.push(JSON.parse(input));
          taskContext.userInstruction = "下一角色的新指令";
          return Promise.reject(new ContractError("fix artifact"));
        },
      }),
    );
    assert.equal(inputs.length, 2);
    for (const input of inputs) {
      if (userInstruction) {
        assert.equal(input.user_instruction, userInstruction);
        assert.ok(Object.keys(input).indexOf("user_instruction") < Object.keys(input).indexOf("prior_attempts"));
      } else {
        assert.equal(Object.hasOwn(input, "user_instruction"), false);
      }
    }
  },
);

test("the deterministic executor checks cancellation before recording evidence", async () => {
  const store = new SqliteStore(":memory:");
  try {
    const runtime = createDeterministicRuntime(store);
    const reason = new Error("cancelled before deterministic execution");
    await assert.rejects(
      runtime.execute({
        runId: "unused",
        role: "researcher",
        input: "{}",
        agent: new Agent({ name: "unused" }),
        timeoutMs: 1_000,
        signal: AbortSignal.abort(reason),
      }),
      (error) => error === reason,
    );
  } finally {
    store.close();
  }
});
