import assert from "node:assert/strict";
import { test } from "vitest";

import { evaluateAutoresearchGate, parseCritiqueText } from "../src/autoresearch/gate.ts";
import type { AutoresearchRuntime } from "../src/autoresearch/types.ts";

function runtime(partial: Partial<AutoresearchRuntime> = {}): AutoresearchRuntime {
  return { evidence: [], critiques: [], browserCommands: [], ...partial };
}

test("无证据 fail-closed", () => {
  const gate = evaluateAutoresearchGate(runtime());
  assert.equal(gate.ok, false);
  assert.equal(gate.reason, "no_evidence");
});

test("有证据但无 critique → missing_critique", () => {
  const gate = evaluateAutoresearchGate(
    runtime({
      evidence: [
        {
          evidenceId: "ev_0001",
          source: "arxiv",
          query: "pulsar",
          title: "A paper",
          locator: "arxiv:1",
          url: null,
          summary: "s",
        },
      ],
    }),
  );
  assert.equal(gate.ok, false);
  assert.equal(gate.reason, "missing_critique");
});

test("contradicts 挡 merge", () => {
  const gate = evaluateAutoresearchGate(
    runtime({
      evidence: [
        {
          evidenceId: "ev_0001",
          source: "arxiv",
          query: "q",
          title: "t",
          locator: "arxiv:1",
          url: null,
          summary: "s",
        },
      ],
      critiques: [{ verdict: "contradicts", rationale: "nope", gaps: ["gap"] }],
    }),
  );
  assert.equal(gate.ok, false);
  assert.equal(gate.reason, "critique_contradicts");
});

test("supports 才 ok", () => {
  const gate = evaluateAutoresearchGate(
    runtime({
      evidence: [
        {
          evidenceId: "ev_0001",
          source: "web",
          query: "q",
          title: "t",
          locator: "web:https://example.com",
          url: "https://example.com",
          summary: "s",
        },
      ],
      critiques: [{ verdict: "supports", rationale: "ok", gaps: [] }],
    }),
  );
  assert.equal(gate.ok, true);
  assert.equal(gate.reason, "verified");
});

test("parseCritiqueText 识别 verdict", () => {
  assert.equal(parseCritiqueText("Verdict: supports\n- gap a").verdict, "supports");
  assert.equal(parseCritiqueText("This contradicts the claim").verdict, "contradicts");
  assert.equal(parseCritiqueText("insufficient evidence").verdict, "insufficient");
});
