/**
 * Shared Qwen (Alibaba Bailian / DashScope) model factory for every luup agent.
 *
 * Wire facts this file encodes (all verified against the live endpoint):
 * - The workspace endpoint speaks the OpenAI **Responses** protocol at
 *   `POST {QWEN_BASE_URL}/responses`, so we use `@ai-sdk/openai`'s
 *   `.responses()` variant rather than chat completions.
 * - `qwen3.7-plus` has thinking **on** by default and reasoning can be >90% of
 *   the output tokens. The switch that actually works is the Bailian-specific
 *   body field `enable_thinking` (the OpenAI-standard `reasoning.effort` is
 *   silently ignored by this endpoint). Since it is not part of the AI SDK's
 *   Responses request schema, we inject it through a `fetch` compatibility
 *   wrapper.
 * - `thinking_budget` is accepted but must be a positive integer, so it cannot
 *   be used to reach zero reasoning; only `enable_thinking:false` can.
 *
 * eve constraints respected here (see the eve capability map):
 * - The model instance is constructed in a module imported by `agent.ts`, so the
 *   compiler can record a module source ref.
 * - No `throw` at module top level: `agent.ts` is really executed at build time,
 *   where credentials may be absent.
 */
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { resolveRunDir } from "./runContext.ts";

/**
 * Context window for the qwen3.x `-plus` / `-max` line. Bailian does not expose
 * this through the OpenAI-compatible `/models` route and these models are absent
 * from the AI Gateway catalog, so every `defineAgent` must pass it explicitly or
 * compilation fails.
 */
export const QWEN_CONTEXT_WINDOW_TOKENS = 131_072;

/**
 * Default model id. Deliberately not read from `.env` (only key + base URL are).
 *
 * 模型选型分权（2026-08-09）：代际追最新（用户定）；档位由裁决（理论+实践）定。
 * 3.8 代端点仅有 -max 档：默认档回落 3.7-plus（成本），3.8-max 留作两个 gigachad
 * 场景——①M9/M10 评分 judge（校准检出率说话）②批跑失败题救援升档。sanity 三项
 * （responses / enable_thinking / function tool）已实测通过；全链路 full-run eval
 * 见 runs/ 相应记录。换代纪律：ch6 model-swap，先过评估再切换。
 */
export const QWEN_DEFAULT_MODEL_ID = "qwen3.7-plus";

export type QwenModelOptions = {
  /**
   * Keep the model's chain of thought. Off by default: reasoning inflates
   * output tokens roughly 7x on this endpoint.
   */
  thinking?: boolean;
  /** Override the model id. Defaults to {@link QWEN_DEFAULT_MODEL_ID}. */
  modelId?: string;
};

/** Set `LUUP_LOG_MODEL_REQUESTS=1` to print one line per upstream model call. */
function requestLoggingEnabled(): boolean {
  return process.env.LUUP_LOG_MODEL_REQUESTS === "1";
}

/**
 * Rewrites the outgoing Responses request so Bailian-only knobs ride along with
 * the AI SDK's standard body. Also the single place that can log the resolved
 * URL, which is how we prove requests land on `/responses`.
 */
function createCompatFetch(thinking: boolean): typeof globalThis.fetch {
  return async (input, init) => {
    let nextInit = init;

    if (typeof init?.body === "string") {
      try {
        const body = JSON.parse(init.body) as Record<string, unknown>;
        // Bailian-specific: the only switch that actually gates reasoning.
        body.enable_thinking = thinking;
        nextInit = { ...init, body: JSON.stringify(body) };
      } catch {
        // Non-JSON body (file upload etc.) — pass it through untouched.
      }
    }

    if (requestLoggingEnabled()) {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      console.error(
        `[luup:model] ${nextInit?.method ?? "POST"} ${url} enable_thinking=${thinking}`,
      );
    }

    const response = await globalThis.fetch(input as RequestInfo, nextInit);

    if (requestLoggingEnabled() && !response.ok) {
      const clone = response.clone();
      console.error(
        `[luup:model] <- ${response.status} ${await clone.text().catch(() => "")}`,
      );
    }

    if (response.ok) void teeUsage(response.clone(), thinking);

    return response;
  };
}

/**
 * criteria E3/D1：token 用量落盘凭证。从响应（SSE 或 JSON）里取最后一个 `"usage":{...}`
 * 对象，append 到 run 目录的 `usage.jsonl`。失败静默——用量记录绝不能影响主链路。
 *
 * run 目录走 `runContext.resolveRunDir()`，**不自己读 `process.env.LUUP_RUN_DIR`**：
 * 上一版是全仓唯一一个绕过 runContext 的读者，于是没设该环境变量的路径（eval 直调）
 * 一行用量都不落 —— D1 凭证面缺失的根因。resolveRunDir 的回退目录是进程内一次性的，
 * 同一进程的所有调用因此仍然汇到同一份 usage.jsonl。
 */
async function teeUsage(clone: Response, thinking: boolean): Promise<void> {
  try {
    const runDir = resolveRunDir();
    const text = await clone.text();
    const key = '"usage":';
    const at = text.lastIndexOf(key);
    if (at === -1) return;
    // 从 usage 值起点做括号配对，容忍嵌套的 *_tokens_details
    const start = text.indexOf("{", at + key.length);
    if (start === -1) return;
    let depth = 0;
    let end = -1;
    for (let i = start; i < text.length; i++) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}" && --depth === 0) {
        end = i;
        break;
      }
    }
    if (end === -1) return;
    const usage = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    const { appendFileSync, mkdirSync } = await import("node:fs");
    const { join } = await import("node:path");
    mkdirSync(runDir, { recursive: true });
    appendFileSync(
      join(runDir, "usage.jsonl"),
      `${JSON.stringify({ at: new Date().toISOString(), thinking, usage })}\n`,
      "utf8",
    );
  } catch {
    // 用量凭证尽力而为，绝不抛。
  }
}

function createProvider(thinking: boolean) {
  return createOpenAI({
    // Becomes `routing.provider` in the compiled manifest; keeps routing
    // `external`, i.e. never through the Vercel AI Gateway.
    name: "dashscope",
    baseURL: process.env.QWEN_BASE_URL ?? "",
    apiKey: process.env.QWEN_API_KEY ?? "",
    fetch: createCompatFetch(thinking),
  });
}

// Two providers, because `enable_thinking` is baked into the fetch wrapper.
const thinkingProvider = createProvider(true);
const nonThinkingProvider = createProvider(false);

/**
 * The Qwen model every luup agent should use.
 *
 * @example
 * defineAgent({
 *   model: qwenModel(),                   // fast, no chain of thought
 *   modelContextWindowTokens: QWEN_CONTEXT_WINDOW_TOKENS,
 * });
 */
export function qwenModel(opts: QwenModelOptions = {}): LanguageModel {
  const { thinking = false, modelId = QWEN_DEFAULT_MODEL_ID } = opts;
  const provider = thinking ? thinkingProvider : nonThinkingProvider;
  return provider.responses(modelId);
}
