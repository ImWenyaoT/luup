import assert from "node:assert/strict";
import { afterEach, beforeEach, onTestFinished, test } from "vitest";
import { MockLanguageModelV4 } from "ai/test";

import { createAutoresearchAgents } from "../src/autoresearch/orchestrator.ts";
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

test("POST /api/autoresearch/chat 在 deterministic 下可流式响应", async () => {
  const store = new SqliteStore(":memory:");
  const harness = new Harness(store, async () => {
    throw new Error("unused");
  });
  const model = new MockLanguageModelV4({
    doGenerate: [
      {
        content: [{ type: "text", text: "Hello from coordinator mock." }],
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
      createAgents: createAutoresearchAgents,
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
  // 宿主硬闸：无证据时交付 FAIL-CLOSED，而不是裸 draft
  assert.match(text, /host-gate|FAIL-CLOSED|no_evidence/i);
});
