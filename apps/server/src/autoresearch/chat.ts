import { createAgentUIStreamResponse, type UIMessage } from "ai";

import { createLanguageModel, providerConfigStatus } from "../seams/providers.ts";
import { createAutoresearchAgents, type BrowserRunner } from "./index.ts";

export type AutoresearchChatDeps = {
  /** 测试注入：跳过 live provider。 */
  createAgents?: typeof createAutoresearchAgents;
  resolveModel?: typeof createLanguageModel;
  browserRunner?: BrowserRunner;
  runtime?: "live" | "deterministic";
};

/** 处理 AI SDK UI chat 请求 → coordinator agent stream。 */
export async function handleAutoresearchChat(
  request: Request,
  deps: AutoresearchChatDeps = {},
  /** Elysia 已解析的 body；传入可避免 Request 流被二次消费。 */
  preParsedBody?: unknown,
): Promise<Response> {
  const runtime = deps.runtime ?? (process.env.LUUP_RUNTIME === "deterministic" ? "deterministic" : "live");
  if (runtime === "live" && providerConfigStatus().credential === "absent") {
    return Response.json(
      {
        error: "missing_model_credentials",
        detail: "Configure OPENAI_API_KEY / DEEPSEEK_API_KEY / LUUP_API_KEY or PUT /api/config.",
      },
      { status: 503 },
    );
  }

  let body: unknown = preParsedBody;
  if (body === undefined) {
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "invalid_json" }, { status: 400 });
    }
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }
  const messages = (body as { messages?: unknown }).messages;
  if (!Array.isArray(messages)) {
    return Response.json({ error: "messages_required" }, { status: 422 });
  }

  const resolveModel = deps.resolveModel ?? createLanguageModel;
  const buildAgents = deps.createAgents ?? createAutoresearchAgents;
  const model = resolveModel();
  const { coordinator } = buildAgents({
    model,
    browserRunner: deps.browserRunner,
  });

  return createAgentUIStreamResponse({
    agent: coordinator,
    uiMessages: messages as UIMessage[],
    abortSignal: request.signal,
  });
}
