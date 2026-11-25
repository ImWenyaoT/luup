import assert from "node:assert/strict";
import { test } from "vitest";
import { MockLanguageModelV4 } from "ai/test";

import { createAutoresearchAgents } from "../src/autoresearch/orchestrator.ts";

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

test("coordinator 可委派 literature_research；宿主 gate 在无证据时 fail-closed", async () => {
  const model = new MockLanguageModelV4({
    doGenerate: [
      // coordinator: call literature_research
      {
        content: [
          {
            type: "tool-call",
            toolCallId: "call-lit",
            toolName: "literature_research",
            input: JSON.stringify({ task: "Find pulsar formation papers" }),
          },
        ],
        finishReason: { unified: "tool-calls", raw: undefined },
        usage,
        warnings: [],
      },
      // literature subagent: final text (no tool — avoid network)
      {
        content: [{ type: "text", text: "No papers fetched in this mock." }],
        finishReason: { unified: "stop", raw: undefined },
        usage,
        warnings: [],
      },
      // coordinator after tool: call critique
      {
        content: [
          {
            type: "tool-call",
            toolCallId: "call-crit",
            toolName: "critique",
            input: JSON.stringify({ claim: "Pulsars form from core collapse." }),
          },
        ],
        finishReason: { unified: "tool-calls", raw: undefined },
        usage,
        warnings: [],
      },
      // structured critique (Output.object)
      {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              verdict: "insufficient",
              rationale: "no evidence frozen",
              gaps: ["no evidence frozen"],
            }),
          },
        ],
        finishReason: { unified: "stop", raw: undefined },
        usage,
        warnings: [],
      },
      // coordinator final draft (will be rejected by host gate in chat path)
      {
        content: [{ type: "text", text: "Draft report that must not merge." }],
        finishReason: { unified: "stop", raw: undefined },
        usage,
        warnings: [],
      },
    ],
  });

  const { coordinator, runtime, evaluateGate } = createAutoresearchAgents({
    model,
    browserRunner: async () => ({ ok: true, stdout: "", stderr: "", code: 0 }),
    coordinatorSteps: 6,
    literatureSteps: 2,
  });

  const result = await coordinator.generate({
    prompt: "How are pulsars formed?",
  });

  assert.match(result.text, /Draft report|must not merge/i);
  assert.equal(runtime.critiques.length, 1);
  assert.equal(runtime.critiques[0]?.verdict, "insufficient");
  const gate = evaluateGate();
  assert.equal(gate.ok, false);
  assert.ok(gate.reason === "no_evidence" || gate.reason === "critique_insufficient");
});
