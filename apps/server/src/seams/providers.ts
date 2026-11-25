/** Autoresearch 多 Provider 模型接线（ADR-0013）。
 *
 * 唯一读取 `LUUP_PROVIDER` / `OPENAI_*` / `DEEPSEEK_*` / `LUUP_API_KEY` /
 * `LUUP_BASE_URL` / `LUUP_MODEL_ID` 的点；legacy `QWEN_*` 仅作 openai-compatible
 * 过渡回退。换供应商只改本文件。
 */

import { createDeepSeek } from "@ai-sdk/deepseek";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";

import { StageError } from "../agent/failures.ts";

export type ProviderId = "openai" | "deepseek" | "openai-compatible";

export type ProviderOverride = {
  provider?: ProviderId;
  apiKey?: string;
  baseUrl?: string;
  modelId?: string;
  /** openai | openai-compatible 时：强制 Responses 或 Chat Completions。 */
  apiSurface?: "responses" | "chat";
};

let override: ProviderOverride = {};
let version = 0;

export function setProviderOverride(next: ProviderOverride): void {
  override = { ...override, ...next };
  version += 1;
}

export function clearProviderOverride(): void {
  override = {};
  version += 1;
}

export function providerConfigVersion(): number {
  return version;
}

function envProvider(): ProviderId {
  const raw = (override.provider || process.env.LUUP_PROVIDER || "").trim().toLowerCase();
  if (raw === "openai" || raw === "deepseek" || raw === "openai-compatible") return raw;
  if (process.env.DEEPSEEK_API_KEY) return "deepseek";
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.QWEN_API_KEY || process.env.LUUP_API_KEY) return "openai-compatible";
  return "openai";
}

function resolveApiKey(provider: ProviderId): string | undefined {
  if (override.apiKey) return override.apiKey;
  if (provider === "openai") return process.env.OPENAI_API_KEY || process.env.LUUP_API_KEY;
  if (provider === "deepseek") return process.env.DEEPSEEK_API_KEY || process.env.LUUP_API_KEY;
  return (
    process.env.LUUP_API_KEY || process.env.QWEN_API_KEY || process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY
  );
}

function resolveBaseUrl(provider: ProviderId): string | undefined {
  const fromOverride = override.baseUrl?.replace(/\/$/, "");
  if (fromOverride) return fromOverride;
  if (provider === "openai-compatible") {
    return (process.env.LUUP_BASE_URL || process.env.QWEN_BASE_URL || "").replace(/\/$/, "") || undefined;
  }
  if (provider === "deepseek") {
    return (process.env.DEEPSEEK_BASE_URL || "").replace(/\/$/, "") || undefined;
  }
  return (process.env.OPENAI_BASE_URL || "").replace(/\/$/, "") || undefined;
}

function defaultModelId(provider: ProviderId): string {
  if (provider === "deepseek") return "deepseek-v4-flash";
  if (provider === "openai-compatible") return "qwen3.8-max";
  return "gpt-5.4";
}

export function resolveModelId(provider: ProviderId = envProvider()): string {
  return override.modelId || process.env.LUUP_MODEL_ID || defaultModelId(provider);
}

function resolveApiSurface(provider: ProviderId): "responses" | "chat" {
  if (override.apiSurface) return override.apiSurface;
  const raw = (process.env.LUUP_API_SURFACE || "").trim().toLowerCase();
  if (raw === "chat" || raw === "responses") return raw;
  // openai 默认 Responses；兼容端点默认 chat（多数只实现 chat completions）。
  return provider === "openai" || provider === "deepseek" ? "responses" : "chat";
}

/** 给设置面 / readyz 的只读状态。密钥本体永不离开本模块。 */
export function providerConfigStatus(): {
  provider: ProviderId;
  credential: "override" | "environment" | "absent";
  model_id: string;
  base_url: string | null;
  api_surface: "responses" | "chat";
} {
  const provider = envProvider();
  const apiKey = resolveApiKey(provider);
  const credential = override.apiKey ? "override" : apiKey ? "environment" : "absent";
  return {
    provider,
    credential,
    model_id: resolveModelId(provider),
    base_url: resolveBaseUrl(provider) ?? null,
    api_surface: resolveApiSurface(provider),
  };
}

/** 构造 AI SDK LanguageModel。缺凭据抛 `missing_credential`。 */
export function createLanguageModel(options?: { modelId?: string }): LanguageModel {
  const provider = envProvider();
  const apiKey = resolveApiKey(provider);
  if (!apiKey) {
    throw new StageError(
      "missing_credential",
      `missing API key for provider=${provider} (set OPENAI_API_KEY / DEEPSEEK_API_KEY / LUUP_API_KEY)`,
    );
  }
  const modelId = options?.modelId || resolveModelId(provider);
  const baseURL = resolveBaseUrl(provider);
  const surface = resolveApiSurface(provider);

  if (provider === "deepseek") {
    const deepseek = createDeepSeek({
      apiKey,
      ...(baseURL ? { baseURL } : {}),
    });
    return surface === "chat" ? deepseek.chat(modelId) : deepseek.responses(modelId);
  }

  if (provider === "openai-compatible") {
    if (surface === "responses") {
      const openai = createOpenAI({
        apiKey,
        ...(baseURL ? { baseURL } : {}),
      });
      return openai.responses(modelId);
    }
    const compatible = createOpenAICompatible({
      name: "luup-compatible",
      apiKey,
      baseURL: baseURL || "https://api.openai.com/v1",
    });
    return compatible.chatModel(modelId);
  }

  // openai
  const openai = createOpenAI({
    apiKey,
    ...(baseURL ? { baseURL } : {}),
  });
  return surface === "chat" ? openai.chat(modelId) : openai.responses(modelId);
}
