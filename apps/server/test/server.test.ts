import assert from "node:assert/strict";
import { test } from "vitest";

import { createDeterministicRuntime, createDeterministicVerifier } from "../src/executor-deterministic.ts";
import { Harness } from "../src/harness.ts";
import { createApp, runtimeMode, timingSafeTokenCompare, type LuupServer } from "../src/server.ts";
import { SqliteStore } from "../src/store/store.ts";

async function listen(): Promise<{ base: string; server: LuupServer; store: SqliteStore }> {
  const store = new SqliteStore(":memory:");
  const runtime = createDeterministicRuntime(store);
  const harness = new Harness(store, runtime.execute, {
    createLedger: runtime.createLedger,
    // 与 createDefaultApp 的确定性模式同形：引用验收也不打网络。
    verifyReferences: createDeterministicVerifier(),
  });
  const server = createApp({ store, harness, runtime: "deterministic" });
  await server.ready;
  return { base: server.url.origin, server, store };
}

async function close(server: LuupServer, store: SqliteStore): Promise<void> {
  await server.stop(true);
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
  assert.deepEqual(
    settled.artifacts.map((a: any) => a.type),
    ["research", "hypothesis", "evidence-review", "research-plan", "review"],
  );
  // 快照里不带 Artifact 正文，也不带任何内部字段
  assert.ok(!JSON.stringify(settled).includes("content_json"));
  assert.equal(settled.attempts.length, 5);

  const artifact = await (await fetch(`${base}/api/artifacts/${settled.final_artifact_id}`)).json();
  assert.equal(artifact.type, "research-plan");
  assert.equal(artifact.content.results.status, "pending_verification");
  assert.equal(artifact.content.results.validation_basis, "formula_derivation");
  assert.match(artifact.content.results.feasibility_argument, /r_gate < r_base/);
  // Artifact 详情也必须走运行时白名单，不能把内部追溯字段直接交给浏览器。
  const serializedArtifact = JSON.stringify(artifact);
  assert.ok(!serializedArtifact.includes("input_artifact_ids"));
  assert.ok(!serializedArtifact.includes("verification_evidence_ids"));

  const markdownResponse = await fetch(`${base}/api/artifacts/${settled.final_artifact_id}/markdown`);
  assert.equal(markdownResponse.status, 200);
  assert.equal(markdownResponse.headers.get("content-type"), "text/markdown; charset=utf-8");
  const markdown = await markdownResponse.text();
  for (const value of [
    "测量科研 Agent 的无来源引用率。",
    "冻结证据使引用可靠性可被检验。",
    "先冻结证据，再逐条核验引用是否落在冻结集合内。",
    "preregistered question set",
    "Frozen Research Artifacts",
    "降低无来源引用率并保持任务完成率。",
    "可审计证据门对科研 Agent 引用可靠性的影响",
    "本研究通过配对对照实验检验冻结证据 ID 对无来源引用率的影响。",
    "固定问题集与模型，做配对盲评。",
    "同一问题集下对比三组，报告置信区间。",
    "无来源引用率",
    "逐题比例差值预期低于基线组，并报告区间。",
    "Validation basis: formula_derivation",
    "Feasibility argument:",
    "r_gate < r_base",
  ]) {
    assert.ok(markdown.includes(value), `Markdown 缺少字段值：${value}`);
  }

  const researchId = settled.artifacts.find((item: any) => item.type === "research")!.id;
  assert.equal((await fetch(`${base}/api/artifacts/${researchId}/markdown`)).status, 404);
  assert.equal((await fetch(`${base}/api/artifacts/unknown/markdown`)).status, 404);
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

test("separates liveness from deterministic readiness", async () => {
  const previousRuntime = process.env.LUUP_RUNTIME;
  process.env.LUUP_RUNTIME = "deterministic";
  const { base, server, store } = await listen();
  try {
    const liveness = await fetch(`${base}/health`);
    assert.equal(liveness.status, 200);
    assert.deepEqual(await liveness.json(), { status: "ok" });

    const readiness = await fetch(`${base}/readyz`);
    assert.equal(readiness.status, 200);
    assert.deepEqual(await readiness.json(), {
      status: "ready",
      checks: { admission: "open", database: "ok", model: "configured", auth: "configured" },
    });

    const apiReadiness = await fetch(`${base}/api/readyz`);
    assert.equal(apiReadiness.status, 200);
  } finally {
    await close(server, store);
    if (previousRuntime === undefined) delete process.env.LUUP_RUNTIME;
    else process.env.LUUP_RUNTIME = previousRuntime;
  }
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
  const server = createApp({ store, harness, runtime: "deterministic" });
  await server.ready;
  const base = server.url.origin;

  await Promise.all(
    ["one", "two", "three"].map((question) =>
      fetch(`${base}/api/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question }),
      }),
    ),
  );
  assert.equal(active, 2);
  assert.equal(maximum, 2);
  releases.splice(0).forEach((release) => release());
  await new Promise((done) => setTimeout(done, 10));
  assert.equal(maximum, 2);
  releases.splice(0).forEach((release) => release());
  await new Promise((done) => setTimeout(done, 10));
  await close(server, store);
});

test("reports an unexpected background failure and settles a still-running Run", async () => {
  const store = new SqliteStore(":memory:");
  const errors: Array<[string, unknown]> = [];
  const harness = {
    createRun: (question: string) => store.createRun(question),
    execute: async () => {
      throw new Error("executor exploded");
    },
  } as unknown as Harness;
  const server = createApp({
    store,
    harness,
    runtime: "deterministic",
    reportError: (message, error) => errors.push([message, error]),
  });
  await server.ready;
  const base = server.url.origin;
  const created = await (
    await fetch(`${base}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "q" }),
    })
  ).json();

  const settled = await settle(base, created.id);
  assert.equal(settled.status, "failed");
  assert.equal(settled.error_code, "runtime_error");
  assert.equal(errors[0]?.[0], "background run failed");
  assert.match(String(errors[0]?.[1]), /executor exploded/);
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

test("authenticated researcher feedback is queued once and invalid requests fail closed", async () => {
  const previousToken = process.env.LUUP_API_TOKEN;
  process.env.LUUP_API_TOKEN = "test-token";
  const store = new SqliteStore(":memory:");
  const runId = store.createRun("q");
  const planner = store.startAttempt(runId, "research-plan");
  store.publishArtifact(runId, planner, { artifact_type: "research-plan" } as any, [], 0);
  store.startAttempt(runId, "reviewer");
  const server = createApp({ store, harness: {} as Harness, runtime: "deterministic" });
  await server.ready;
  try {
    const endpoint = `${server.url.origin}/api/runs/${runId}/feedback`;
    assert.equal(
      (
        await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ feedback_id: "human-1", feedback: "补充回退条件" }),
        })
      ).status,
      401,
    );
    const accepted = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-token" },
      body: JSON.stringify({ feedback_id: "human-1", feedback: "补充回退条件" }),
    });
    assert.equal(accepted.status, 202);
    assert.deepEqual(await accepted.json(), { status: "queued", feedback_id: "human-1", round: 1 });
    const duplicate = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-token" },
      body: JSON.stringify({ feedback_id: "human-1", feedback: "重复" }),
    });
    assert.equal(duplicate.status, 409);
    const missing = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-token" },
      body: JSON.stringify({ feedback_id: "human-2" }),
    });
    assert.equal(missing.status, 422);
    const wrongToken = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer wrong-token" },
      body: JSON.stringify({ feedback_id: "human-1", feedback: "无效令牌" }),
    });
    assert.equal(wrongToken.status, 401);
  } finally {
    await server.stop(true);
    store.close();
    if (previousToken === undefined) delete process.env.LUUP_API_TOKEN;
    else process.env.LUUP_API_TOKEN = previousToken;
  }
});

test("timingSafeTokenCompare performs constant-time comparison against tokens", () => {
  assert.equal(timingSafeTokenCompare("Bearer secret-123", "Bearer secret-123"), true);
  assert.equal(timingSafeTokenCompare("Bearer secret-123", "Bearer secret-456"), false);
  assert.equal(timingSafeTokenCompare("Bearer short", "Bearer very-long-secret-key-12345"), false);
  assert.equal(timingSafeTokenCompare("", "Bearer secret"), false);
  assert.equal(timingSafeTokenCompare("Bearer secret", ""), false);
});

test("rejects an unknown runtime instead of silently selecting paid live mode", () => {
  assert.equal(runtimeMode(undefined), "live");
  assert.equal(runtimeMode("deterministic"), "deterministic");
  assert.throws(() => runtimeMode("determinstic"), /must be live or deterministic/);
});

test("unknown API routes stay JSON 404", async () => {
  const store = new SqliteStore(":memory:");
  const runtime = createDeterministicRuntime(store);
  const harness = new Harness(store, runtime.execute, {
    createLedger: runtime.createLedger,
    // 与 createDefaultApp 的确定性模式同形：引用验收也不打网络。
    verifyReferences: createDeterministicVerifier(),
  });
  const server = createApp({ store, harness, runtime: "deterministic" });
  await server.ready;
  const base = server.url.origin;

  const api = await fetch(`${base}/api/typo`);
  assert.equal(api.status, 404);
  assert.match(api.headers.get("content-type") ?? "", /^application\/json/);
  assert.deepEqual(await api.json(), { detail: "Not Found" });
  assert.equal((await fetch(`${base}/api`)).status, 404);
  assert.equal((await fetch(`${base}/workspace`)).status, 404);
  await close(server, store);
});

test("does not expose internal exception details in a 500 response", async () => {
  const store = new SqliteStore(":memory:");
  const harness = {
    createRun: () => {
      throw new Error("/private/secret/runs.db");
    },
  } as unknown as Harness;
  const server = createApp({ store, harness, runtime: "deterministic" });
  await server.ready;
  const response = await fetch(`${server.url.origin}/api/runs`, {
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
  const created = await (
    await fetch(`${base}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "q" }),
    })
  ).json();

  const response = await fetch(`${base}/api/runs/${created.id}/events`);
  assert.equal(response.headers.get("content-type"), "text/event-stream; charset=utf-8");
  assert.equal(response.headers.get("cache-control"), "no-cache, no-transform");
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
  const created = await (
    await fetch(`${base}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "q" }),
    })
  ).json();
  const settled = await settle(base, created.id);

  const tail = await (await fetch(`${base}/api/runs/${created.id}/events?after=${settled.version - 1}`)).text();
  const frames = tail.split("\n\n").filter((frame) => frame.startsWith("id: "));
  // 开区间：只拿到最后一帧
  assert.equal(frames.length, 1);
  assert.match(frames[0]!, /event: run\.completed/);

  // `parseInt("1e3")` 会得到 1，所以游标必须严格解析
  assert.equal((await fetch(`${base}/api/runs/${created.id}/events?after=1e3`)).status, 400);
  // 超过 JS 安全整数的游标无法可靠地对应 SQLite version，必须拒绝而不是舍入后重放错位。
  assert.equal((await fetch(`${base}/api/runs/${created.id}/events?after=9007199254740992`)).status, 400);
  await close(server, store);
});

test("SSE replay 失败时报告诊断并发送可识别的错误帧", async () => {
  const source = new SqliteStore(":memory:");
  const runId = source.createRun("q");
  let failReplay = true;
  const errors: Array<[string, unknown]> = [];
  const store = {
    snapshot: (id: string) => source.snapshot(id),
    eventsAfter: (id: string, after: number) => {
      if (failReplay) throw new Error("corrupt event payload");
      return source.eventsAfter(id, after);
    },
  } as unknown as SqliteStore;
  const harness = {} as Harness;
  const server = createApp({
    store,
    harness,
    runtime: "deterministic",
    reportError: (message, error) => errors.push([message, error]),
  });
  await server.ready;

  const response = await fetch(`${server.url.origin}/api/runs/${runId}/events`);
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.match(body, /event: stream\.error/);
  assert.match(body, /"code":"stream_error"/);
  assert.equal(errors[0]?.[0], "SSE stream failed");
  assert.match(String(errors[0]?.[1]), /corrupt event payload/);
  failReplay = false;
  await server.stop(true);
  source.close();
});

test("stops the SSE loop when the client disconnects", async () => {
  const { base, server, store } = await listen();
  const created = await (
    await fetch(`${base}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "q" }),
    })
  ).json();
  await settle(base, created.id);

  // 终态之后再开一条流并立刻掐断。若循环不监听 close，这里会留下一个
  // 每 100ms 查一次库的死循环，server.stop(true) 就永远无法完成。
  const controller = new AbortController();
  const stream = fetch(`${base}/api/runs/${created.id}/events?after=0`, { signal: controller.signal });
  await new Promise((done) => setTimeout(done, 30));
  controller.abort();
  await stream.catch(() => undefined);

  await close(server, store);
});
