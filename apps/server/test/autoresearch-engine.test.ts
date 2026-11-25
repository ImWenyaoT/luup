import assert from "node:assert/strict";
import { test } from "vitest";
import { MockLanguageModelV4 } from "ai/test";

import { createResearchRuntime } from "../src/autoresearch/runtime.ts";
import { deriveMessages } from "../src/autoresearch/session/derive.ts";

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

test("ResearchEngine：工人 Session + Assessor Decision；无证据 fail-closed", async () => {
  const model = new MockLanguageModelV4({
    doGenerate: [
      // literature worker
      {
        content: [{ type: "text", text: "Literature stub: no fetch." }],
        finishReason: { unified: "stop", raw: undefined },
        usage,
        warnings: [],
      },
      // web worker
      {
        content: [{ type: "text", text: "Web stub: no browse." }],
        finishReason: { unified: "stop", raw: undefined },
        usage,
        warnings: [],
      },
      // critic structured
      {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              verdict: "insufficient",
              rationale: "no evidence frozen",
              gaps: ["no evidence"],
            }),
          },
        ],
        finishReason: { unified: "stop", raw: undefined },
        usage,
        warnings: [],
      },
    ],
  });

  const events: Array<{ type: string; ticketId: string }> = [];
  const engine = createResearchRuntime({
    model,
    browserRunner: async () => ({ ok: true, stdout: "", stderr: "", code: 0 }),
    emit: (e) => {
      events.push({ type: e.type, ticketId: e.ticketId });
    },
  });

  const { ticket, deliveryText, sessions } = await engine.runResearch("How are pulsars formed?");

  assert.equal(ticket.status, "rejected");
  assert.equal(ticket.assignments.length, 3);
  assert.ok(ticket.assignments.every((a) => a.status === "completed"));
  assert.equal(ticket.decisions.length, 1);
  assert.equal(ticket.decisions[0]?.outcome, "fail_closed");
  assert.match(deliveryText, /FAIL-CLOSED|no_evidence|critique_insufficient/i);
  assert.ok(sessions.length >= 4); // main + 3 workers
  assert.ok(events.some((e) => e.type === "ticket.created"));
  assert.ok(events.some((e) => e.type === "decision.recorded"));

  const main = sessions.find((s) => s.record.role === "main");
  assert.ok(main);
  const projected = deriveMessages(main!.snapshot().events);
  assert.ok(projected.some((m) => m.role === "user"));
  assert.ok(projected.some((m) => m.role === "assistant"));
});

test("ResearchEngine：有证据 + supports → verified 交付 draft", async () => {
  const model = new MockLanguageModelV4({
    doGenerate: [
      {
        content: [{ type: "text", text: "Lit ok." }],
        finishReason: { unified: "stop", raw: undefined },
        usage,
        warnings: [],
      },
      {
        content: [{ type: "text", text: "Web ok." }],
        finishReason: { unified: "stop", raw: undefined },
        usage,
        warnings: [],
      },
      {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              verdict: "supports",
              rationale: "evidence aligns",
              gaps: [],
            }),
          },
        ],
        finishReason: { unified: "stop", raw: undefined },
        usage,
        warnings: [],
      },
    ],
  });

  const engine = createResearchRuntime({
    model,
    browserRunner: async () => ({ ok: true, stdout: "", stderr: "", code: 0 }),
  });

  // 注入冻结证据：在 Assessor 之前由 executor 合并；这里用自定义 executor 替身更干净
  // — 直接跑完后手动不够，因为 gate 看 ticket.evidence。改用 ports 覆盖 executor。
  const { createWorkerExecutor } = await import("../src/autoresearch/executor/workers.ts");
  const base = createWorkerExecutor();
  const engineWithEvidence = createResearchRuntime({
    model,
    browserRunner: async () => ({ ok: true, stdout: "", stderr: "", code: 0 }),
    ports: {
      executor: {
        async run(input) {
          const report = await base.run(input);
          if (input.assignment.role === "literature") {
            return {
              ...report,
              evidence: [
                {
                  evidenceId: "ev_test_1",
                  source: "arxiv" as const,
                  query: "pulsar formation",
                  locator: "arxiv:0000.00000",
                  title: "Mock pulsar paper",
                  url: null,
                  summary: "Core collapse forms neutron stars.",
                },
              ],
            };
          }
          return report;
        },
      },
    },
  });

  const { ticket, deliveryText } = await engineWithEvidence.runResearch("Pulsar formation?");
  assert.equal(ticket.status, "verified");
  assert.equal(ticket.decisions[0]?.outcome, "verified");
  assert.match(deliveryText, /host-gate.*verified/i);
  assert.doesNotMatch(deliveryText, /FAIL-CLOSED/);
  void engine;
});
