import assert from "node:assert/strict";
import { createServer } from "node:http";
import { Agent, tool } from "@openai/agents";
import { z } from "zod";
import { afterEach, test, vi } from "vitest";

import { StageError } from "../src/agent/failures.ts";
import { createQwenExecutor, type StageUsage } from "../src/executor.ts";
import { clearModelOverride, setModelOverride } from "../src/seams/model.ts";

afterEach(() => {
  clearModelOverride();
  vi.unstubAllGlobals();
});

const known = { input_tokens: 10, output_tokens: 4, total_tokens: 14 };
const text = [
  {
    type: "message",
    id: "msg",
    role: "assistant",
    status: "completed",
    content: [{ type: "output_text", text: "ok", annotations: [] }],
  },
];
const call = [
  { type: "function_call", id: "fc", call_id: "call", name: "probe", arguments: "{}", status: "completed" },
];

async function runFixture(responses: Record<string, unknown>[], httpStatus = 200) {
  let requests = 0;
  let toolCalls = 0;
  const server = createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      const current = responses[requests++] ?? { status: "completed", output: text, usage: known };
      response.statusCode = httpStatus;
      response.setHeader("content-type", "application/json");
      if (httpStatus !== 200) {
        response.setHeader("retry-after-ms", "0");
        response.end(JSON.stringify({ error: { message: "local transport failure" } }));
        return;
      }
      response.end(JSON.stringify({ id: `resp_${requests}`, object: "response", created_at: 0, ...current }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  const originalFetch = globalThis.fetch;
  vi.stubGlobal("fetch", ((input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== origin) throw new Error("Only the local provider fixture is allowed");
    return originalFetch(input, init);
  }) satisfies typeof fetch);
  setModelOverride({ apiKey: "local-test-only", baseUrl: `${origin}/v1`, modelId: "status-test" });
  try {
    let output: unknown;
    let error: unknown;
    let metrics: StageUsage | undefined;
    try {
      output = await createQwenExecutor((value) => {
        metrics = value;
      })({
        runId: "status-test",
        role: "reviewer",
        input: "{}",
        timeoutMs: 5_000,
        agent: new Agent({
          name: "status-test",
          model: "status-test",
          tools: [
            tool({
              name: "probe",
              description: "Track actual tool execution",
              parameters: z.object({}),
              execute: () => {
                toolCalls += 1;
                return "done";
              },
            }),
          ],
        }),
      });
    } catch (cause) {
      error = cause;
    }
    return { output, error, requests, toolCalls, usage: (error as { usage?: StageUsage } | undefined)?.usage, metrics };
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

for (const status of ["failed", "incomplete", "cancelled", "in_progress", "queued", undefined, "future_status"]) {
  for (const output of [text, call]) {
    test(`Responses ${String(status)} cannot deliver ${output === text ? "text" : "tools"} or retry`, async () => {
      const result = await runFixture([{ status, output, usage: known }]);
      assert.ok(result.error instanceof StageError);
      assert.equal(result.error.code, status === "incomplete" ? "invalid_output" : "provider_error");
      assert.equal(result.requests, 1);
      assert.equal(result.toolCalls, 0);
      assert.equal(result.output, undefined);
      assert.deepEqual(result.usage, { requests: 1, inputTokens: 10, outputTokens: 4, totalTokens: 14, toolCalls: 0 });
    });
  }
}

test("completed response carrying an error is rejected before tool execution", async () => {
  const result = await runFixture([
    { status: "completed", error: { code: "server_error", message: "failed" }, output: call, usage: known },
  ]);
  assert.ok(result.error instanceof StageError);
  assert.equal(result.error.code, "provider_error");
  assert.equal(result.requests, 1);
  assert.equal(result.toolCalls, 0);
});

test("provider context overflow retains its existing classification", async () => {
  const result = await runFixture([
    {
      status: "failed",
      error: { code: "context_length_exceeded", message: "context length exceeded" },
      output: text,
      usage: known,
    },
  ]);
  assert.ok(result.error instanceof StageError);
  assert.equal(result.error.code, "context_overflow");
  assert.equal(result.requests, 1);
});

test("a later failed response includes prior real usage and only executed tools", async () => {
  const result = await runFixture([
    { status: "completed", output: call, usage: known },
    { status: "incomplete", output: call, usage: known },
  ]);
  assert.ok(result.error instanceof StageError);
  assert.equal(result.requests, 2);
  assert.equal(result.toolCalls, 1);
  assert.deepEqual(result.usage, { requests: 2, inputTokens: 20, outputTokens: 8, totalTokens: 28, toolCalls: 1 });
});

test("missing failed-response usage preserves only the known lower bound", async () => {
  const result = await runFixture([
    { status: "completed", output: call, usage: known },
    { status: "failed", output: text },
  ]);
  assert.ok(result.error instanceof StageError);
  assert.deepEqual(result.usage, {
    incomplete: true,
    requests: 2,
    inputTokens: 10,
    outputTokens: 4,
    totalTokens: 14,
    toolCalls: 1,
  });
});

test("an unmetered failed response cannot manufacture zero usage", async () => {
  const result = await runFixture([{ status: "failed", output: text }]);
  assert.ok(result.error instanceof StageError);
  assert.equal(result.usage, undefined);
  assert.equal(result.metrics, undefined);
});

test("completed responses still execute valid tools and deliver output", async () => {
  const result = await runFixture([
    { status: "completed", error: null, output: call, usage: known },
    { status: "completed", output: text, usage: known },
  ]);
  assert.equal(result.error, undefined);
  assert.equal(result.output, "ok");
  assert.equal(result.requests, 2);
  assert.equal(result.toolCalls, 1);
});

test("empty failed output still records its reported cost", async () => {
  const result = await runFixture([{ status: "failed", error: { code: "server_error" }, output: [], usage: known }]);
  assert.ok(result.error instanceof StageError);
  assert.equal(result.requests, 1);
  assert.equal(result.usage?.totalTokens, 14);
});

test("unknown earlier usage cannot become complete when the rejected response reports cost", async () => {
  const result = await runFixture([
    { status: "completed", output: call },
    { status: "incomplete", output: text, usage: known },
  ]);
  assert.ok(result.error instanceof StageError);
  assert.equal(result.error.code, "invalid_output");
  assert.deepEqual(result.usage, {
    incomplete: true,
    requests: 2,
    inputTokens: 10,
    outputTokens: 4,
    totalTokens: 14,
    toolCalls: 1,
  });
});

for (const status of [429, 500, 400]) {
  test(`HTTP ${status} obeys the Runner's transport request budget`, async () => {
    const result = await runFixture([], status);
    assert.ok(result.error instanceof StageError);
    assert.equal(result.error.code, "provider_error");
    assert.equal(result.requests, status === 400 ? 1 : 3);
    assert.equal(result.toolCalls, 0);
    assert.equal(result.output, undefined);
    assert.equal(result.usage, undefined);
  });
}
