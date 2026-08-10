/**
 * Shared Qwen (Alibaba Bailian / DashScope) model factory for every luup agent.
 *
 * Wire facts this file encodes (all verified against the live endpoint):
 * - The workspace endpoint speaks the OpenAI **Responses** protocol at
 *   `POST {QWEN_BASE_URL}/responses`, so agents get an `OpenAIResponsesModel`
 *   built on an `openai` client with a custom baseURL — never chat completions
 *   (criteria D2: 不换协议).
 * - `qwen3.7-plus` has thinking **on** by default and reasoning can be >90% of
 *   the output tokens. The switch that actually works is the Bailian-specific
 *   body field `enable_thinking` (the OpenAI-standard `reasoning.effort` is
 *   silently ignored by this endpoint). It is not part of the standard
 *   Responses request schema, so we inject it through a `fetch` compatibility
 *   wrapper — the same single place that logs requests and tees usage.
 * - `thinking_budget` is accepted but must be a positive integer, so it cannot
 *   be used to reach zero reasoning; only `enable_thinking:false` can.
 *
 * @openai/agents wiring:
 * - Every agent receives an explicit `Model` instance from {@link qwenModel};
 *   per SDK semantics this bypasses the default provider entirely, so the
 *   OPENAI_API_KEY-based defaults never engage.
 * - Tracing is disabled process-wide below: the meta package installs an
 *   OpenAI tracing exporter as an import side effect, and without an
 *   OPENAI_API_KEY it logs an error on every flush.
 * - Clients are constructed lazily on first use: entrypoints (scripts, web
 *   API child processes) load `.env` at startup, and lazy construction means
 *   module import order cannot race ahead of that.
 */
import OpenAI from "openai";
import { OpenAIResponsesModel, setTracingDisabled } from "@openai/agents";
import type { Model } from "@openai/agents";
import { resolveRunDir } from "./runContext.ts";

setTracingDisabled(true);

/**
 * Context window for the qwen3.x `-plus` / `-max` line. Bailian does not expose
 * this through the OpenAI-compatible `/models` route. With eve gone this no
 * longer feeds a framework knob; it is the sizing basis for the per-agent
 * `maxTurns` caps (see agent/agent.ts: 轮数上限 × 窗口 ≈ 原 token 熔断额度).
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
 * the SDK's standard body. Also the single place that can log the resolved
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

/**
 * 懒构造的 openai client，`enable_thinking` 两档各一个（开关烤在 fetch 包装里）。
 * 懒 = 第一次真正要用时才读 QWEN_* 环境变量，入口脚本先 `loadEnvFile` 再跑即可；
 * 静态装配（selftest-agents，不发请求）在无 .env 环境下也能构造 agent。
 */
const clients = new Map<string, OpenAI>();

export function qwenClient(thinking: boolean): OpenAI {
  const key = thinking ? "thinking" : "plain";
  let c = clients.get(key);
  if (!c) {
    c = new OpenAI({
      baseURL: process.env.QWEN_BASE_URL ?? "",
      apiKey: process.env.QWEN_API_KEY ?? "",
      fetch: createCompatFetch(thinking),
    });
    clients.set(key, c);
  }
  return c;
}

/**
 * 档位决策（纯函数，selftest-rescue 直接测它）：
 * 救援通道专用覆盖 —— 批跑对 status=failed 的题重跑一轮时，run-batch.ts 用
 * `--rescue-model=<id>` 把档位经 LUUP_MODEL_ID 注入子进程，整条流水线随之升档。
 * 只盖**默认档** —— 显式传入的 modelId（judge 自己定档，见 scripts/judgeClient.ts）
 * 优先，救援轮不会顺手改判分器。
 */
export function resolveQwenModelId(opts: QwenModelOptions = {}): string {
  return opts.modelId ?? (process.env.LUUP_MODEL_ID?.trim() || QWEN_DEFAULT_MODEL_ID);
}

/**
 * The Qwen model every luup agent should use.
 *
 * @example
 * new Agent({
 *   name: "literature",
 *   model: qwenModel(),                   // fast, no chain of thought
 * });
 */
export function qwenModel(opts: QwenModelOptions = {}): Model {
  const { thinking = false } = opts;
  return new OpenAIResponsesModel(qwenClient(thinking), resolveQwenModelId(opts));
}
