import assert from "node:assert/strict";
import { test } from "vitest";

import { evaluateAutoresearchGate, formatGateDelivery, parseCritiqueText } from "../src/autoresearch/gate.ts";
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

test("parseCritiqueText 只认显式 verdict 行，不扫 rationale", () => {
  assert.equal(parseCritiqueText("Verdict: supports\n- gap a").verdict, "supports");
  assert.equal(
    parseCritiqueText("Verdict: insufficient\nThe available evidence does not support the claim.").verdict,
    "insufficient",
  );
  assert.equal(parseCritiqueText("Verdict: supports\nNo contradictions were found.").verdict, "supports");
  // 无显式行 → fail-closed 默认 insufficient
  assert.equal(parseCritiqueText("This contradicts the claim").verdict, "insufficient");
});

test("formatGateDelivery 否决时不交出 draft", () => {
  const rejected = formatGateDelivery(
    {
      ok: false,
      reason: "critique_insufficient",
      critique: { verdict: "insufficient", rationale: "thin", gaps: ["need more"] },
      evidenceCount: 1,
    },
    "SECRET DRAFT that must not leak",
  );
  assert.doesNotMatch(rejected, /SECRET DRAFT/);
  assert.match(rejected, /FAIL-CLOSED/);

  const accepted = formatGateDelivery(
    {
      ok: true,
      reason: "verified",
      critique: { verdict: "supports", rationale: "ok", gaps: [] },
      evidenceCount: 2,
    },
    "Deliverable report",
  );
  assert.match(accepted, /Deliverable report/);
  assert.match(accepted, /host-gate.*verified/);
});
