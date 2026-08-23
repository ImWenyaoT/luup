import assert from "node:assert/strict";
import {
  Agent,
  Runner,
  Usage,
  type Model,
  type ModelProvider,
  type ModelResponse,
  type RunContext,
} from "@openai/agents";
import { test } from "vitest";

import {
  installRunnerTraceHooks,
  TraceCollector,
  TRACE_EVENT_LIMIT,
  summarizeInput,
  type RunTraceEvent,
} from "../src/agent/run-trace.ts";
import { projectRunEvent, projectRunSnapshot } from "../src/api/projection.ts";
import { createQwenExecutor } from "../src/executor.ts";
import { createDeterministicRuntime, createDeterministicVerifier } from "../src/executor-deterministic.ts";
import { Harness } from "../src/harness.ts";
import type { StageExecutor } from "../src/roles.ts";
import { SqliteStore } from "../src/store/store.ts";

test("input summary is structured and contains no prompt text", () => {
  const input = JSON.stringify({ question: "不可公开的问题", goal: "检索证据", input_artifacts: [] });
  const summary = summarizeInput(input);

  assert.deepEqual(summary.top_level_fields, ["goal", "input_artifacts", "question"]);
  assert.equal(summary.chars, input.length);
  assert.match(summary.sha256, /^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(summary).includes("不可公开的问题"));
});

test("Runner hooks emit a bounded lifecycle trace for the real SDK run", async () => {
  const events: RunTraceEvent[] = [];
  const traces = new Map<string, TraceCollector>();
  const model: Model = {
    getResponse(): Promise<ModelResponse> {
      return Promise.resolve({
        usage: new Usage(),
        output: [
          {
            id: "message_1",
            type: "message",
            role: "assistant",
            status: "completed",
            content: [{ type: "output_text", text: "完成" }],
          },
        ],
      });
    },
    getStreamedResponse() {
      throw new Error("trace test does not stream");
    },
  };
  const runner = new Runner({ modelProvider: { getModel: () => model }, tracingDisabled: true });
  installRunnerTraceHooks(runner, traces);
  const agent = new Agent({ name: "TraceProbe", instructions: "完成任务", model: "fake" });
  const trace = new TraceCollector(
    { traceId: "attempt_1", role: "reviewer", agent, task: "完成一个测试任务", input: '{"goal":"test"}' },
    (event) => events.push(event),
  );
  traces.set("attempt_1", trace);

  const result = await runner.run(agent, '{"goal":"test"}', { context: { trace_id: "attempt_1" }, maxTurns: 1 });
  trace.ended("completed", "final_output", {
    requests: result.runContext.usage.requests,
    input_tokens: result.runContext.usage.inputTokens,
    output_tokens: result.runContext.usage.outputTokens,
    total_tokens: result.runContext.usage.totalTokens,
    tool_calls: 0,
  });

  assert.deepEqual(
    events.map((event) => event.kind),
    ["started", "agent_started", "agent_ended", "ended"],
  );
  const started = events[0];
  assert.equal(started?.kind, "started");
  if (started?.kind === "started") {
    assert.equal(started.model, "fake");
    assert.equal(started.structured_constraint, "text");
    assert.deepEqual(started.available_tools, []);
  }
  const ended = events.at(-1);
  assert.equal(ended?.kind, "ended");
  if (ended?.kind === "ended") {
    assert.equal(ended.outcome, "completed");
    assert.equal(ended.usage.total_tokens, 0);
  }
});

test("trace collector drops excess lifecycle noise but keeps explicit truncation", () => {
  const events: RunTraceEvent[] = [];
  const agent = new Agent({ name: "TraceProbe", instructions: "完成任务", model: "fake" });
  const trace = new TraceCollector(
    { traceId: "attempt_1", role: "researcher", agent, task: "检索", input: "{}" },
    (event) => events.push(event),
  );
  for (let index = 0; index < TRACE_EVENT_LIMIT + 20; index += 1) {
    trace.agentStarted("TraceProbe", null);
  }
  trace.ended("completed", "final_output", {
    requests: null,
    input_tokens: null,
    output_tokens: null,
    total_tokens: null,
    tool_calls: null,
  });

  assert.equal(events.length, TRACE_EVENT_LIMIT + 1);
  const ended = events.at(-1);
  assert.equal(ended?.kind, "ended");
  if (ended?.kind === "ended") {
    assert.equal(ended.truncated, true);
    assert.equal(ended.usage.total_tokens, null);
  }
});

test("same-name tool calls close by SDK callId rather than guessed order", () => {
  const events: RunTraceEvent[] = [];
  const agent = new Agent({ name: "TraceProbe", instructions: "完成任务", model: "fake" });
  const trace = new TraceCollector(
    { traceId: "attempt_parallel", role: "researcher", agent, task: "检索", input: "{}" },
    (event) => events.push(event),
  );

  trace.toolStarted("TraceProbe", "arxiv_search", "call-a");
  trace.toolStarted("TraceProbe", "arxiv_search", "call-b");
  trace.toolEnded("TraceProbe", "arxiv_search", "call-b");
  trace.toolEnded("TraceProbe", "arxiv_search", "call-a");
  trace.toolEnded("TraceProbe", "arxiv_search", null);

  const ended = events.filter((event) => event.kind === "tool_ended");
  assert.deepEqual(
    ended.map((event) => [event.ordinal, event.status]),
    [
      [2, "completed"],
      [1, "completed"],
      [null, "unknown"],
    ],
  );
});

test("runner hooks read the SDK tool call id from hook details", () => {
  const events: RunTraceEvent[] = [];
  const agent = new Agent({ name: "TraceProbe", instructions: "完成任务", model: "fake" });
  const trace = new TraceCollector(
    { traceId: "attempt_hook_call_id", role: "researcher", agent, task: "检索", input: "{}" },
    (event) => events.push(event),
  );
  const traces = new Map([["attempt_hook_call_id", trace]]);
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const runner = {
    on(event: string, listener: (...args: unknown[]) => void): void {
      listeners.set(event, listener);
    },
  };
  installRunnerTraceHooks(runner as unknown as Pick<Runner, "on">, traces);

  const context = { context: { trace_id: "attempt_hook_call_id" } } as RunContext<unknown>;
  const tool = { name: "arxiv_search" };
  listeners.get("agent_tool_start")?.(context, agent, tool, { toolCall: { callId: "sdk-call" } });
  listeners.get("agent_tool_end")?.(context, agent, tool, "result", { toolCall: { callId: "sdk-call" } });

  const ended = events.filter((event) => event.kind === "tool_ended");
  assert.deepEqual(
    ended.map((event) => [event.ordinal, event.status]),
    [[1, "completed"]],
  );
});

test("missing or unmatched tool call ids stay unknown without guessing an ordinal", () => {
  const events: RunTraceEvent[] = [];
  const agent = new Agent({ name: "TraceProbe", instructions: "完成任务", model: "fake" });
  const trace = new TraceCollector(
    { traceId: "attempt_missing_call_id", role: "researcher", agent, task: "检索", input: "{}" },
    (event) => events.push(event),
  );

  trace.toolStarted("TraceProbe", "arxiv_search", null);
  trace.toolEnded("TraceProbe", "arxiv_search", null);
  trace.toolStarted("TraceProbe", "arxiv_search", "known-call");
  trace.toolEnded("TraceProbe", "arxiv_search", "different-call");
  trace.ended("failed", "missing_call_id", {
    requests: null,
    input_tokens: null,
    output_tokens: null,
    total_tokens: null,
    tool_calls: null,
  });

  const ended = events.filter((event) => event.kind === "tool_ended");
  assert.deepEqual(
    ended.map((event) => [event.ordinal, event.status]),
    [
      [null, "unknown"],
      [null, "unknown"],
      [1, "unknown"],
      [2, "unknown"],
    ],
  );
});

test("trace close marks unresolved tools unknown and is idempotent", () => {
  const events: RunTraceEvent[] = [];
  const agent = new Agent({ name: "TraceProbe", instructions: "完成任务", model: "fake" });
  const trace = new TraceCollector(
    { traceId: "attempt_timeout", role: "researcher", agent, task: "检索", input: "{}" },
    (event) => events.push(event),
  );
  trace.toolStarted("TraceProbe", "arxiv_search", "call-open");
  const usage = { requests: null, input_tokens: null, output_tokens: null, total_tokens: null, tool_calls: null };

  trace.ended("failed", "timeout", usage);
  trace.ended("completed", "late", usage);

  const terminal = events.filter((event) => event.kind === "ended");
  assert.equal(terminal.length, 1);
  const unresolved = events.find((event) => event.kind === "tool_ended");
  assert.equal(unresolved?.kind, "tool_ended");
  if (unresolved?.kind === "tool_ended") {
    assert.equal(unresolved.ordinal, 1);
    assert.equal(unresolved.status, "unknown");
    assert.equal(unresolved.duration_ms, null);
  }
});

test("public trace projection keeps only safe scalar facts", () => {
  const event = projectRunEvent({
    id: 1,
    version: 1,
    kind: "sdk.trace.started",
    payload: {
      trace_id: "attempt_1:1",
      role: "reviewer",
      agent: "FinalReviewer",
      model: "qwen3.7-plus",
      task: "独立评审研究计划",
      input_encoding: "text",
      input_chars: 42,
      input_sha256: "a".repeat(64),
      input_fields: "goal,input_artifacts,question",
      structured_constraint: "review",
      available_tools: "arxiv_search,crossref_search",
      prompt: "不应出网",
      tool_arguments: { secret: "不应出网" },
    },
    created_at: "t",
  });

  assert.deepEqual(event.payload, {
    trace_id: "attempt_1:1",
    role: "reviewer",
    agent: "FinalReviewer",
    model: "qwen3.7-plus",
    task: "独立评审研究计划",
    input_encoding: "text",
    input_chars: 42,
    input_sha256: "a".repeat(64),
    input_fields: "goal,input_artifacts,question",
    structured_constraint: "review",
    available_tools: "arxiv_search,crossref_search",
  });
});

test("Qwen executor exposes the real Runner trace without enabling exporter tracing", async () => {
  const events: RunTraceEvent[] = [];
  const model: Model = {
    getResponse(): Promise<ModelResponse> {
      return Promise.resolve({
        usage: new Usage(),
        output: [
          {
            id: "message_1",
            type: "message",
            role: "assistant",
            status: "completed",
            content: [{ type: "output_text", text: "完成" }],
          },
        ],
      });
    },
    getStreamedResponse() {
      throw new Error("trace test does not stream");
    },
  };
  const execute = createQwenExecutor(undefined, { getModel: () => model } as ModelProvider);
  const agent = new Agent({ name: "TraceProbe", instructions: "完成任务", model: "fake" });

  assert.equal(
    await execute({
      runId: "run_1",
      taskId: "attempt_1",
      role: "reviewer",
      task: "独立评审",
      agent,
      input: '{"goal":"test"}',
      timeoutMs: 30_000,
      onTrace: (event) => events.push(event),
    }),
    "完成",
  );

  assert.deepEqual(
    events.map((event) => event.kind),
    ["started", "agent_started", "agent_ended", "ended"],
  );
  const started = events[0];
  assert.equal(started?.kind, "started");
  if (started?.kind === "started") {
    assert.equal(started.task, "独立评审");
    assert.equal(started.input_summary.top_level_fields[0], "goal");
  }
  const ended = events.at(-1);
  assert.equal(ended?.kind, "ended");
  if (ended?.kind === "ended") assert.equal(ended.outcome, "completed");
});

test("executor closes a failed trace with unknown usage instead of inventing zero", async () => {
  const events: RunTraceEvent[] = [];
  const model: Model = {
    getResponse(): Promise<ModelResponse> {
      return Promise.reject(Object.assign(new Error("bad request"), { status: 400, responseHeaders: {} }));
    },
    getStreamedResponse() {
      throw new Error("trace test does not stream");
    },
  };
  const execute = createQwenExecutor(undefined, { getModel: () => model } as ModelProvider);
  const agent = new Agent({ name: "TraceProbe", instructions: "完成任务", model: "fake" });

  await assert.rejects(
    execute({
      runId: "run_1",
      taskId: "attempt_1",
      role: "reviewer",
      task: "独立评审",
      agent,
      input: "{}",
      timeoutMs: 30_000,
      onTrace: (event) => events.push(event),
    }),
  );

  const ended = events.at(-1);
  assert.equal(ended?.kind, "ended");
  if (ended?.kind === "ended") {
    assert.equal(ended.outcome, "failed");
    assert.equal(ended.usage.total_tokens, null);
    assert.equal(ended.usage.tool_calls, null);
    assert.notEqual(ended.usage.total_tokens, 0);
  }
});

test("Harness sends SDK trace facts through the SQLite RunStore and public projection", async () => {
  const store = new SqliteStore(":memory:");
  const runtime = createDeterministicRuntime(store);
  const execute: StageExecutor = async (request) => {
    request.onTrace?.({
      kind: "started",
      trace_id: request.taskId ?? "attempt_unknown",
      role: request.role,
      agent: request.agent.name,
      model: typeof request.agent.model === "string" ? request.agent.model : null,
      task: request.task ?? request.role,
      input_summary: {
        encoding: "text",
        chars: request.input.length,
        sha256: "a".repeat(64),
        top_level_fields: ["goal", "input_artifacts", "question"],
      },
      structured_constraint: request.agent.outputSchemaName,
      available_tools: [],
    });
    return runtime.execute(request);
  };
  const harness = new Harness(store, execute, {
    createLedger: runtime.createLedger,
    verifyReferences: createDeterministicVerifier(),
  });
  const runId = harness.createRun("trace integration question");

  const outcome = await harness.execute(runId);
  assert.equal(outcome.status, "completed");
  const projected = projectRunSnapshot(store.snapshot(runId)!);
  const trace = projected.recent_events.find((event) => event.kind === "sdk.trace.started");
  assert.ok(trace);
  assert.equal(typeof trace.payload.input_chars, "number");
  assert.equal(trace.payload.input_sha256, "a".repeat(64));
  assert.equal(trace.payload.input_fields, "goal,input_artifacts,question");
  store.close();
});
