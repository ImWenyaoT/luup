import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "vitest";

import {
  clearProviderOverride,
  createLanguageModel,
  providerConfigStatus,
  resolveModelId,
  setProviderOverride,
} from "../src/seams/providers.ts";

const ENV_KEYS = [
  "LUUP_PROVIDER",
  "LUUP_MODEL_ID",
  "LUUP_API_KEY",
  "LUUP_BASE_URL",
  "LUUP_API_SURFACE",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "DEEPSEEK_API_KEY",
  "DEEPSEEK_BASE_URL",
  "QWEN_API_KEY",
  "QWEN_BASE_URL",
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  clearProviderOverride();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  clearProviderOverride();
});

test("缺凭据 → missing_credential", () => {
  assert.equal(providerConfigStatus().credential, "absent");
  assert.throws(() => createLanguageModel(), /missing API key/);
});

test("OPENAI_API_KEY 选 openai + responses 默认模型", () => {
  process.env.OPENAI_API_KEY = "sk-openai";
  const status = providerConfigStatus();
  assert.equal(status.provider, "openai");
  assert.equal(status.credential, "environment");
  assert.equal(status.api_surface, "responses");
  assert.equal(resolveModelId(), "gpt-5.4");
  assert.ok(createLanguageModel());
});

test("DEEPSEEK_API_KEY 选 deepseek responses", () => {
  process.env.DEEPSEEK_API_KEY = "sk-deepseek";
  const status = providerConfigStatus();
  assert.equal(status.provider, "deepseek");
  assert.equal(status.api_surface, "responses");
  assert.equal(resolveModelId(), "deepseek-v4-flash");
  assert.ok(createLanguageModel());
});

test("覆盖优先：provider + model + surface", () => {
  process.env.OPENAI_API_KEY = "sk-openai";
  setProviderOverride({
    provider: "openai-compatible",
    apiKey: "sk-compat",
    baseUrl: "https://example.com/v1",
    modelId: "custom-model",
    apiSurface: "chat",
  });
  const status = providerConfigStatus();
  assert.equal(status.provider, "openai-compatible");
  assert.equal(status.credential, "override");
  assert.equal(status.model_id, "custom-model");
  assert.equal(status.api_surface, "chat");
  assert.equal(status.base_url, "https://example.com/v1");
  assert.ok(createLanguageModel());
});
