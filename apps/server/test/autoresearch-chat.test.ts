import assert from "node:assert/strict";
import { afterEach, beforeEach, onTestFinished, test } from "vitest";
import { MockLanguageModelV4 } from "ai/test";

import { createResearchRuntime } from "../src/autoresearch/runtime.ts";
import { Harness } from "../src/harness.ts";
import { clearProviderOverride } from "../src/seams/providers.ts";
import { createApp } from "../src/server.ts";
import { SqliteStore } from "../src/store/store.ts";

const usage = {
  inputTokens: { total: 3, noCache: 3, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 2, text: 2, reasoning: undefined },
};

beforeEach(() => {
  clearProviderOverride();
  delete process.env.OPENAI_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  delete process.env.LUUP_API_KEY;
});

afterEach(() => {
  clearProviderOverride();
});

test("POST /api/autoresearch/chat 走 ResearchEngine；无证据 FAIL-CLOSED", async () => {
  const store = new SqliteStore(":memory:");
  const harness = new Harness(store, async () => {
    throw new Error("unused");
  });
  const model = new MockLanguageModelV4({
    doGenerate: [
      {
        content: [{ type: "text", text: "Lit mock." }],
        finishReason: { unified: "stop", raw: undefined },
        usage,
        warnings: [],
      },
      {
        content: [{ type: "text", text: "Web mock." }],
        finishReason: { unified: "stop", raw: undefined },
        usage,
        warnings: [],
      },
      {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              verdict: "insufficient",
              rationale: "no evidence",
              gaps: ["none"],
            }),
          },
        ],
        finishReason: { unified: "stop", raw: undefined },
        usage,
        warnings: [],
      },
    ],
  });
  const server = createApp({
    store,
    harness,
    runtime: "deterministic",
    autoresearch: {
      resolveModel: () => model,
      createEngine: ({ model: m, browserRunner }) =>
        createResearchRuntime({
          model: m,
          browserRunner: browserRunner ?? (async () => ({ ok: true, stdout: "", stderr: "", code: 0 })),
        }),
      browserRunner: async () => ({ ok: true, stdout: "", stderr: "", code: 0 }),
    },
  });
  await server.ready;
  onTestFinished(async () => {
    await server.stop(true);
    store.close();
  });

  const res = await fetch(`${server.url.origin}/api/autoresearch/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: "ping" }] }],
    }),
  });
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.ok(text.length > 0);
  assert.match(text, /host-gate|FAIL-CLOSED|no_evidence|critique_insufficient/i);
  assert.match(text, /engine-gated-delivery/);
});
