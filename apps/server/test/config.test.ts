import assert from "node:assert/strict";
import { afterEach, beforeEach, onTestFinished, test } from "vitest";

import { Harness } from "../src/harness.ts";
import {
  clearModelOverride,
  modelConfigStatus,
  modelConfigVersion,
  modelForRole,
  qwenModelProvider,
  setModelOverride,
} from "../src/seams/model.ts";
import { createApp } from "../src/server.ts";
import { SqliteStore } from "../src/store/store.ts";

/** 配置面契约：环境变量是默认，web 覆盖是进程内状态，key 永不回显。 */

const ENV_KEYS = ["QWEN_API_KEY", "QWEN_BASE_URL", "LUUP_MODEL_ID"] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  clearModelOverride();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  clearModelOverride();
});

test("凭据状态三态：absent → environment → override，覆盖优先", () => {
  assert.equal(modelConfigStatus().credential, "absent");
  process.env.QWEN_API_KEY = "sk-from-env";
  assert.equal(modelConfigStatus().credential, "environment");
  setModelOverride({ apiKey: "sk-from-web" });
  assert.equal(modelConfigStatus().credential, "override");
  clearModelOverride();
  assert.equal(modelConfigStatus().credential, "environment");
});

test("覆盖后 provider 不再要求环境变量；模型 id 覆盖优先于两个环境变量名", () => {
  assert.throws(() => qwenModelProvider(), /QWEN_API_KEY/);
  setModelOverride({ apiKey: "sk-from-web" });
  assert.ok(qwenModelProvider());

  process.env.LUUP_MODEL_ID = "env-model";
  assert.equal(modelForRole(), "env-model");
  setModelOverride({ apiKey: "sk-from-web", modelId: "web-model" });
  assert.equal(modelForRole(), "web-model");
});

test("默认模型使用 qwen3.8-max，provider 固定走 Responses API", async () => {
  assert.equal(modelForRole(), "qwen3.8-max");
  setModelOverride({ apiKey: "sk-from-web" });
  const model = await qwenModelProvider().getModel(modelForRole());
  assert.equal(model.constructor.name, "QwenResponsesModel");
});

test("配置版本随每次写入递增——executor 靠它决定重建 Runner", () => {
  const before = modelConfigVersion();
  setModelOverride({ apiKey: "sk-1" });
  setModelOverride({ apiKey: "sk-2" });
  assert.equal(modelConfigVersion(), before + 2);
});

async function app(t: { onTestFinished: typeof onTestFinished }) {
  const store = new SqliteStore(":memory:");
  const harness = new Harness(store, async () => {
    throw new Error("unused");
  });
  const server = createApp({ store, harness, runtime: "deterministic" });
  await server.ready;
  t.onTestFinished(async () => {
    await server.stop(true);
    store.close();
  });
  return server.url.origin;
}

test("GET /api/config 报状态不报密钥", async () => {
  const t = { onTestFinished };
  process.env.QWEN_API_KEY = "sk-secret-value";
  const base = await app(t);
  const res = await fetch(`${base}/api/config`);
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.ok(!text.includes("sk-secret-value"), "key 泄露进了配置响应");
  const body = JSON.parse(text);
  assert.equal(body.credential, "environment");
  assert.equal(typeof body.model_id, "string");
  assert.equal(typeof body.base_url, "string");
  assert.ok(["live", "deterministic"].includes(body.runtime));
});

test("PUT /api/config 设置进程内覆盖，响应与后续 GET 都不含 key", async () => {
  const t = { onTestFinished };
  const base = await app(t);
  const res = await fetch(`${base}/api/config`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ api_key: "sk-web-secret", model_id: "qwen-test" }),
  });
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.ok(!text.includes("sk-web-secret"), "key 回显进了 PUT 响应");
  assert.equal(JSON.parse(text).credential, "override");
  assert.equal(modelForRole(), "qwen-test");

  const status = (await (await fetch(`${base}/api/config`)).json()) as { credential: string };
  assert.equal(status.credential, "override");
});

test("PUT /api/config 拒绝坏输入：非 JSON 类型、坏 base_url、空 key", async () => {
  const t = { onTestFinished };
  const base = await app(t);
  const plain = await fetch(`${base}/api/config`, { method: "PUT", body: "x" });
  assert.equal(plain.status, 415);
  const badUrl = await fetch(`${base}/api/config`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ base_url: "not-a-url" }),
  });
  assert.equal(badUrl.status, 422);
  const emptyKey = await fetch(`${base}/api/config`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ api_key: "   " }),
  });
  assert.equal(emptyKey.status, 422);
});

test("PUT /api/config 识别整行环境变量误粘贴与非法字符", async () => {
  const t = { onTestFinished };
  const base = await app(t);
  const envLine = await fetch(`${base}/api/config`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ api_key: "QWEN_API_KEY=sk-real-value" }),
  });
  assert.equal(envLine.status, 422);
  assert.match(((await envLine.json()) as { detail: string }).detail, /环境变量/);

  const withSpace = await fetch(`${base}/api/config`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ api_key: "sk-abc def" }),
  });
  assert.equal(withSpace.status, 422);

  // 合法的 base64 padding 与 sk- 前缀不能被误杀。
  const padded = await fetch(`${base}/api/config`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ api_key: "sk-ABCD==" }),
  });
  assert.equal(padded.status, 200);
});
