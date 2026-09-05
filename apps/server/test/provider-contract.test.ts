import assert from "node:assert/strict";
import { Agent, tool } from "@openai/agents";
import { z } from "zod";
import { test } from "vitest";

import type { RunTraceEvent } from "../src/agent/run-trace.ts";
import { createQwenExecutor, type StageUsage } from "../src/executor.ts";
import { modelForRole, sharedModelSettings } from "../src/seams/model.ts";
import { providerFixture } from "./provider-fixture.ts";

async function runResponses(
  usages: unknown[],
  onTrace?: (event: RunTraceEvent) => void,
): Promise<StageUsage | undefined> {
  const requests = await providerFixture("configured-contract-model", (index) => ({
    body: {
      id: `resp_${index}`,
      object: "response",
      created_at: 0,
      status: "completed",
      usage: usages[index],
      output:
        index === usages.length - 1
          ? [
              {
                id: "msg_final",
                type: "message",
                role: "assistant",
                status: "completed",
                content: [{ type: "output_text", text: "ok", annotations: [] }],
              },
            ]
          : [
              {
                type: "function_call",
                id: `fc_${index}`,
                call_id: `call_${index}`,
                name: "probe",
                arguments: "{}",
                status: "completed",
              },
            ],
    },
  }));
  let spent: StageUsage | undefined;
  const output = await createQwenExecutor()({
    runId: "provider-contract",
    role: "reviewer",
    input: "{}",
    timeoutMs: 2_000,
    agent: new Agent({
      name: "probe",
      model: modelForRole(),
      modelSettings: sharedModelSettings,
      tools: [tool({ name: "probe", description: "Local test tool", parameters: z.object({}), execute: () => "done" })],
    }),
    onTrace,
    onUsage: (usage) => {
      spent = usage;
    },
  });
  assert.equal(output, "ok");
  assert.equal(requests.length, usages.length);
  for (const [index, request] of requests.entries()) {
    assert.equal(request.method, "POST");
    assert.equal(request.path, "/v1/responses");
    const body = JSON.parse(request.body) as {
      model: string;
      reasoning: unknown;
      tools: Array<{ type: string; name: string; parameters: Record<string, unknown>; strict: boolean }>;
      input: Array<{ type?: string; call_id?: string; output?: unknown }>;
    };
    assert.equal(body.model, "configured-contract-model");
    assert.deepEqual(body.reasoning, { effort: "none" });
    const probe = body.tools.find((item) => item.name === "probe");
    assert.ok(probe);
    assert.equal(probe.type, "function");
    assert.equal(probe.strict, true);
    const { type, properties, required, additionalProperties } = probe.parameters;
    assert.deepEqual(
      { type, properties, required, additionalProperties },
      { type: "object", properties: {}, required: [], additionalProperties: false },
    );
    if (index > 0) {
      const toolOutput = body.input.find(
        (item) => item.type === "function_call_output" && item.call_id === `call_${index - 1}`,
      );
      assert.ok(toolOutput, "the next Responses request must carry the actual tool result");
      assert.equal(toolOutput.output, "done");
    }
  }
  return spent;
}

const known = { input_tokens: 10, output_tokens: 4, total_tokens: 14 };

test("real Responses transport preserves known token counts", async () => {
  assert.deepEqual(await runResponses([known]), {
    requests: 1,
    inputTokens: 10,
    outputTokens: 4,
    totalTokens: 14,
    toolCalls: 0,
  });
});

test("missing Responses usage remains unknown instead of becoming SDK zeroes", async () => {
  assert.equal(await runResponses([undefined]), undefined);
});

test("partial Responses usage is not treated as a complete token fact", async () => {
  assert.equal(await runResponses([{ input_tokens: 10 }]), undefined);
});

test("mixed known and missing Responses usage retains known costs as incomplete", async () => {
  assert.deepEqual(await runResponses([known, undefined]), {
    requests: 2,
    inputTokens: 10,
    outputTokens: 4,
    totalTokens: 14,
    toolCalls: 1,
    incomplete: true,
  });
});

test("explicit zero Responses usage is a known fact", async () => {
  assert.deepEqual(await runResponses([{ input_tokens: 0, output_tokens: 0, total_tokens: 0 }]), {
    requests: 1,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    toolCalls: 0,
  });
});

test("incomplete provider costs stay unknown in the final trace", async () => {
  const events: RunTraceEvent[] = [];
  await runResponses([known, undefined], (event) => events.push(event));
  const end = events.find((event) => event.kind === "ended");
  assert.ok(end?.kind === "ended");
  assert.equal(end.usage.total_tokens, null);
  assert.equal(end.usage.input_tokens, null);
  assert.equal(end.usage.output_tokens, null);
});
