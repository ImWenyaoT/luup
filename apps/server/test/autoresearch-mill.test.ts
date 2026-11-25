import assert from "node:assert/strict";
import { onTestFinished, test } from "vitest";

import { ResearchMill } from "../src/autoresearch/mill/mill.ts";
import { MillRegistry } from "../src/autoresearch/mill/registry.ts";
import type { RunResearchResult } from "../src/autoresearch/runtime.ts";
import type { ResearchTicket } from "../src/autoresearch/domain.ts";
import { Harness } from "../src/harness.ts";
import { createApp } from "../src/server.ts";
import { SqliteStore } from "../src/store/store.ts";

function verifiedResult(question: string, n: number): RunResearchResult {
  const ticket: ResearchTicket = {
    id: `ticket_v_${n}`,
    question,
    status: "verified",
    mainSessionId: `sess_main_${n}`,
    assignments: [],
    decisions: [
      {
        id: `dec_${n}`,
        ticketId: `ticket_v_${n}`,
        outcome: "verified",
        reason: "verified",
        gate: { ok: true, reason: "verified", critique: null, evidenceCount: 1 },
        at: new Date().toISOString(),
      },
    ],
    evidence: [
      {
        evidenceId: `ev_${n}`,
        source: "arxiv",
        query: question,
        title: `Paper ${n}`,
        locator: `arxiv:0000.0000${n}`,
        url: null,
        summary: "Evidence summary",
      },
    ],
    critiques: [{ verdict: "supports", rationale: "ok", gaps: [] }],
    deliveryText: `Verified draft ${n}\n\n- What is the next open question after result ${n}?`,
    createdAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
  };
  return { ticket, deliveryText: ticket.deliveryText!, sessions: [] };
}

function rejectedResult(question: string, n: number): RunResearchResult {
  const ticket: ResearchTicket = {
    id: `ticket_r_${n}`,
    question,
    status: "rejected",
    mainSessionId: `sess_main_r_${n}`,
    assignments: [],
    decisions: [
      {
        id: `dec_r_${n}`,
        ticketId: `ticket_r_${n}`,
        outcome: "fail_closed",
        reason: "no_evidence",
        gate: { ok: false, reason: "no_evidence", critique: null, evidenceCount: 0 },
        at: new Date().toISOString(),
      },
    ],
    evidence: [],
    critiques: [],
    deliveryText: "[host-gate] FAIL-CLOSED",
    createdAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
  };
  return { ticket, deliveryText: ticket.deliveryText!, sessions: [] };
}

test("ResearchMill：产量门达标才 completed", async () => {
  let calls = 0;
  const mill = new ResearchMill({
    engine: {
      async runResearch(question) {
        calls += 1;
        // 第 1 张拒，后两张过 → 目标 2 篇
        if (calls === 1) return rejectedResult(question, calls);
        return verifiedResult(question, calls);
      },
    },
  });

  mill.start({
    topic: "pulsar formation",
    seedQuestions: ["How do pulsars form?"],
    targetPapers: 2,
    maxTickets: 6,
  });
  const snap = await mill.waitUntilSettled();
  assert.equal(snap.status, "completed");
  assert.equal(snap.quantity.papersProduced, 2);
  assert.equal(snap.quantity.ok, true);
  assert.ok(snap.papers.every((p) => p.bodyMarkdown.includes("#")));
  assert.ok(calls >= 3);
});

test("ResearchMill：票用尽未达产量 → exhausted", async () => {
  const mill = new ResearchMill({
    engine: {
      async runResearch(question) {
        return rejectedResult(question, 1);
      },
    },
  });
  mill.start({
    topic: "x",
    seedQuestions: ["q1?"],
    targetPapers: 2,
    maxTickets: 2,
  });
  const snap = await mill.waitUntilSettled();
  assert.equal(snap.status, "exhausted");
  assert.equal(snap.quantity.ok, false);
  assert.equal(snap.quantity.papersProduced, 0);
});

test("POST /api/autoresearch/mill/start 可启动并读到产量", async () => {
  const store = new SqliteStore(":memory:");
  const harness = new Harness(store, async () => {
    throw new Error("unused");
  });
  let n = 0;
  const registry = new MillRegistry({
    runtime: "deterministic",
    createMill: () =>
      new ResearchMill({
        engine: {
          async runResearch(question) {
            n += 1;
            return verifiedResult(question, n);
          },
        },
      }),
  });
  const server = createApp({
    store,
    harness,
    runtime: "deterministic",
    mill: { registry },
  });
  await server.ready;
  onTestFinished(async () => {
    await server.stop(true);
    store.close();
  });

  const start = await fetch(`${server.url.origin}/api/autoresearch/mill/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      topic: "quantum gravity phenomenology",
      seedQuestions: ["What near-term experiment constrains quantum gravity?"],
      targetPapers: 1,
      maxTickets: 3,
    }),
  });
  assert.equal(start.status, 202);
  const started = (await start.json()) as { status: string };
  assert.equal(started.status, "running");

  // 轮询直到 settle
  let status = "running";
  for (let i = 0; i < 40; i += 1) {
    const res = await fetch(`${server.url.origin}/api/autoresearch/mill`);
    const body = (await res.json()) as { status: string; quantity?: { papersProduced: number; ok: boolean } };
    status = body.status;
    if (status !== "running" && status !== "idle") {
      assert.equal(body.quantity?.papersProduced, 1);
      assert.equal(body.quantity?.ok, true);
      break;
    }
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.equal(status, "completed");
});
