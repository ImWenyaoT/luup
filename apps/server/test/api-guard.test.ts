import assert from "node:assert/strict";
import { test } from "bun:test";

import { createApp } from "../src/server.ts";
import { SqliteStore } from "../src/store/store.ts";

function withEnv(name: string, value: string | undefined): () => void {
  const previous = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  return () => {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  };
}

test("an opt-in API token protects paid run creation", async () => {
  const restore = withEnv("LUUP_API_TOKEN", "test-token");
  const store = new SqliteStore(":memory:");
  let created = 0;
  const harness = {
    createRun: (question: string) => {
      created += 1;
      return store.createRun(question);
    },
    execute: async () => undefined,
  };
  const server = createApp({ store, harness: harness as any });
  try {
    const missing = await fetch(`${server.url.origin}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "不应启动付费 Run" }),
    });
    assert.equal(missing.status, 401);
    assert.equal(created, 0);

    const accepted = await fetch(`${server.url.origin}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-token" },
      body: JSON.stringify({ question: "允许启动的 Run" }),
    });
    assert.equal(accepted.status, 202);
    assert.equal(created, 1);
  } finally {
    await server.stop(true);
    store.close();
    restore();
  }
});

test("live mode fails closed when the API token is missing", async () => {
  const restoreRuntime = withEnv("LUUP_RUNTIME", "live");
  const restoreToken = withEnv("LUUP_API_TOKEN", undefined);
  const store = new SqliteStore(":memory:");
  let created = 0;
  const harness = {
    createRun: () => {
      created += 1;
      return "unreachable";
    },
    execute: async () => undefined,
  };
  const server = createApp({ store, harness: harness as any });
  try {
    const response = await fetch(`${server.url.origin}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "不得在漏配 token 时创建付费 Run" }),
    });
    assert.equal(response.status, 401);
    assert.equal(created, 0);
  } finally {
    await server.stop(true);
    store.close();
    restoreToken();
    restoreRuntime();
  }
});

test("live mode refuses a Run before creation when model credentials are absent", async () => {
  const restoreRuntime = withEnv("LUUP_RUNTIME", "live");
  const restoreToken = withEnv("LUUP_API_TOKEN", "test-token");
  const restoreKey = withEnv("QWEN_API_KEY", undefined);
  const store = new SqliteStore(":memory:");
  let created = 0;
  const harness = {
    createRun: () => {
      created += 1;
      return "unreachable";
    },
    execute: async () => undefined,
  };
  const server = createApp({ store, harness: harness as any });
  try {
    const response = await fetch(`${server.url.origin}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-token" },
      body: JSON.stringify({ question: "不得在缺凭据时创建 Run" }),
    });
    assert.equal(response.status, 503);
    assert.equal(created, 0);
  } finally {
    await server.stop(true);
    store.close();
    restoreKey();
    restoreToken();
    restoreRuntime();
  }
});

test("the paid run queue has a finite opt-in bound", async () => {
  const restoreRuntime = withEnv("LUUP_RUNTIME", "deterministic");
  const restore = withEnv("LUUP_MAX_QUEUED_RUNS", "1");
  const store = new SqliteStore(":memory:");
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const harness = {
    createRun: (question: string) => store.createRun(question),
    execute: async () => blocked,
  };
  const server = createApp({ store, harness: harness as any });
  try {
    const request = (question: string) =>
      fetch(`${server.url.origin}/api/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question }),
      });
    assert.equal((await request("第一个 Run")).status, 202);
    assert.equal((await request("第二个 Run")).status, 429);
    release();
  } finally {
    release();
    await server.stop(true);
    store.close();
    restore();
    restoreRuntime();
  }
});
