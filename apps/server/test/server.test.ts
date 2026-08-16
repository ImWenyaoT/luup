import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import { createDeterministicRuntime, createDeterministicVerifier } from "../src/executors/deterministic.ts";
import { Harness } from "../src/harness.ts";
import { createApp, runtimeMode } from "../src/server.ts";
import { SqliteStore } from "../src/store/store.ts";

async function listen(): Promise<{ base: string; server: Server; store: SqliteStore }> {
  const store = new SqliteStore(":memory:");
  const runtime = createDeterministicRuntime(store);
  const harness = new Harness(store, runtime.execute, {
    createLedger: runtime.createLedger,
    // 与 createDefaultApp 的确定性模式同形：引用验收也不打网络。
    verifyReferences: createDeterministicVerifier(),
  });
  const server = createApp({ store, harness });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address() as { port: number };
  return { base: `http://127.0.0.1:${address.port}`, server, store };
}

async function close(server: Server, store: SqliteStore): Promise<void> {
  await new Promise<void>((done) => server.close(() => done()));
  store.close();
}

/** 等 Run 走到终态。确定性运行时不打网络，几十毫秒就完。 */
async function settle(base: string, runId: string): Promise<any> {
  for (let tick = 0; tick < 200; tick += 1) {
    const snapshot = await (await fetch(`${base}/api/runs/${runId}`)).json();
    if (["completed", "review_rejected", "failed"].includes(snapshot.status)) return snapshot;
    await new Promise((done) => setTimeout(done, 25));
  }
  throw new Error("run did not settle");
}

test("creates a run and drives it to completed", async () => {
  const { base, server, store } = await listen();
  const created = await fetch(`${base}/api/runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question: "冻结证据能降低无来源引用吗？" }),
  });
  assert.equal(created.status, 202);
  const snapshot = await created.json();
  assert.equal(snapshot.status, "running");

  const settled = await settle(base, snapshot.id);
  assert.equal(settled.status, "completed");
  assert.deepEqual(settled.artifacts.map((a: any) => a.type),
    ["research", "hypothesis", "evidence-review", "research-plan", "review"]);
  // 快照里不带 Artifact 正文，也不带任何内部字段
  assert.ok(!JSON.stringify(settled).includes("content_json"));
  assert.equal(settled.attempts.length, 5);

  const artifact = await (await fetch(`${base}/api/artifacts/${settled.final_artifact_id}`)).json();
  assert.equal(artifact.type, "research-plan");
  assert.equal(artifact.content.results.status, "pending_verification");
  // Artifact 详情也必须走运行时白名单，不能把内部追溯字段直接交给浏览器。
  const serializedArtifact = JSON.stringify(artifact);
  assert.ok(!serializedArtifact.includes("input_artifact_ids"));
  assert.ok(!serializedArtifact.includes("verification_evidence_ids"));
  await close(server, store);
});

test("keeps the legacy health probe alongside the API path", async () => {
  const { base, server, store } = await listen();
  for (const path of ["/health", "/api/health"]) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok" });
  }
  await close(server, store);
});

test("runs at most two distinct Runs at once", async () => {
  const store = new SqliteStore(":memory:");
  const releases: Array<() => void> = [];
  let active = 0;
  let maximum = 0;
  const harness = {
    createRun: (question: string) => store.createRun(question),
    execute: async (runId: string) => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active -= 1;
      store.finishRun(runId, "failed", { errorCode: "test_done" });
    },
  } as unknown as Harness;
  const server = createApp({ store, harness });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}`;

  await Promise.all(["one", "two", "three"].map((question) => fetch(`${base}/api/runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question }),
  })));
  assert.equal(active, 2);
  assert.equal(maximum, 2);
  releases.splice(0).forEach((release) => release());
  await new Promise((done) => setTimeout(done, 10));
  assert.equal(maximum, 2);
  releases.splice(0).forEach((release) => release());
  await new Promise((done) => setTimeout(done, 10));
  await close(server, store);
});

test("rejects an empty question and unknown ids", async () => {
  const { base, server, store } = await listen();
  const simpleWrite = await fetch(`${base}/api/runs`, {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: JSON.stringify({ question: "不应启动付费 Run" }),
  });
  assert.equal(simpleWrite.status, 415);
  assert.deepEqual(await simpleWrite.json(), { detail: "Content-Type 必须是 application/json。" });
  const bad = await fetch(`${base}/api/runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question: "   " }),
  });
  assert.equal(bad.status, 422);
  const tooLong = await fetch(`${base}/api/runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question: "问".repeat(4_001) }),
  });
  assert.equal(tooLong.status, 422);
  assert.deepEqual(await tooLong.json(), { detail: "question 不能超过 4000 个字符。" });
  const malformed = await fetch(`${base}/api/runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{",
  });
  assert.equal(malformed.status, 400);
  assert.deepEqual(await malformed.json(), { detail: "请求体必须是合法 JSON。" });
  const nullBody = await fetch(`${base}/api/runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "null",
  });
  assert.equal(nullBody.status, 400);
  assert.deepEqual(await nullBody.json(), { detail: "请求体必须是 JSON 对象。" });
  assert.equal((await fetch(`${base}/api/runs/deadbeef`)).status, 404);
  assert.equal((await fetch(`${base}/api/artifacts/deadbeef`)).status, 404);
  assert.equal((await fetch(`${base}/api/runs/deadbeef/events`)).status, 404);
  await close(server, store);
});

test("rejects an unknown runtime instead of silently selecting paid live mode", () => {
  assert.equal(runtimeMode(undefined), "live");
  assert.equal(runtimeMode("deterministic"), "deterministic");
  assert.throws(() => runtimeMode("determinstic"), /must be live or deterministic/);
});

test("unknown API routes stay JSON 404 when the SPA is enabled", async (t) => {
  const dist = mkdtempSync(join(tmpdir(), "luup-web-"));
  t.onTestFinished(() => rmSync(dist, { recursive: true, force: true }));
  writeFileSync(join(dist, "index.html"), "<main>Luup</main>");

  const store = new SqliteStore(":memory:");
  const runtime = createDeterministicRuntime(store);
  const harness = new Harness(store, runtime.execute, {
    createLedger: runtime.createLedger,
    // 与 createDefaultApp 的确定性模式同形：引用验收也不打网络。
    verifyReferences: createDeterministicVerifier(),
  });
  const server = createApp({ store, harness, webDist: dist });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}`;

  const api = await fetch(`${base}/api/typo`);
  assert.equal(api.status, 404);
  assert.match(api.headers.get("content-type") ?? "", /^application\/json/);
  assert.deepEqual(await api.json(), { detail: "Not Found" });
  assert.equal((await fetch(`${base}/api`)).status, 404);
  assert.equal(await (await fetch(`${base}/workspace`)).text(), "<main>Luup</main>");
  await close(server, store);
});

test("rejects a malformed request target without stopping the server", async () => {
  const { base, server, store } = await listen();
  const port = Number(new URL(base).port);
  const response = await new Promise<string>((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    let text = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => { text += chunk; });
    socket.on("end", () => resolve(text));
    socket.on("error", reject);
    socket.end("GET http://[ HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
  });

  assert.match(response, /^HTTP\/1\.1 400/);
  assert.equal((await fetch(`${base}/api/health`)).status, 200);
  await close(server, store);
});

test("does not expose internal exception details in a 500 response", async () => {
  const store = new SqliteStore(":memory:");
  const harness = {
    createRun: () => { throw new Error("/private/secret/runs.db"); },
  } as unknown as Harness;
  const server = createApp({ store, harness });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address() as { port: number };
  const response = await fetch(`http://127.0.0.1:${address.port}/api/runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question: "q" }),
  });

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { detail: "服务器内部错误。" });
  await close(server, store);
});

test("streams events over SSE and closes at the terminal state", async () => {
  const { base, server, store } = await listen();
  const created = await (await fetch(`${base}/api/runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question: "q" }),
  })).json();

  const response = await fetch(`${base}/api/runs/${created.id}/events`);
  assert.equal(response.headers.get("content-type"), "text/event-stream; charset=utf-8");
  const body = await response.text();

  // 流在 Run 到达终态时自己关掉，所以这里能读到结尾而不是永远挂着
  assert.match(body, /^id: \d+\nevent: /);
  assert.match(body, /event: artifact\.published/);
  assert.match(body, /event: run\.completed/);
  // sdk.output_rejected 属于隐藏事件；这条 Run 没有失败，顺带确认它没混进来
  assert.ok(!body.includes("sdk.output_rejected"));
  await close(server, store);
});

test("resumes from a cursor and validates it", async () => {
  const { base, server, store } = await listen();
  const created = await (await fetch(`${base}/api/runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question: "q" }),
  })).json();
  const settled = await settle(base, created.id);

  const tail = await (await fetch(`${base}/api/runs/${created.id}/events?after=${settled.version - 1}`)).text();
  const frames = tail.split("\n\n").filter((frame) => frame.startsWith("id: "));
  // 开区间：只拿到最后一帧
  assert.equal(frames.length, 1);
  assert.match(frames[0]!, /event: run\.completed/);

  // `parseInt("1e3")` 会得到 1，所以游标必须严格解析
  assert.equal((await fetch(`${base}/api/runs/${created.id}/events?after=1e3`)).status, 400);
  await close(server, store);
});

test("stops the SSE loop when the client disconnects", async () => {
  const { base, server, store } = await listen();
  const created = await (await fetch(`${base}/api/runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question: "q" }),
  })).json();
  await settle(base, created.id);

  // 终态之后再开一条流并立刻掐断。若循环不监听 close，这里会留下一个
  // 每 100ms 查一次库的死循环，server.close() 就永远等不到回调。
  const controller = new AbortController();
  const stream = fetch(`${base}/api/runs/${created.id}/events?after=0`, { signal: controller.signal });
  await new Promise((done) => setTimeout(done, 30));
  controller.abort();
  await stream.catch(() => undefined);

  await close(server, store);
});
