import { createUIMessageStream, createUIMessageStreamResponse, type LanguageModel, type UIMessage } from "ai";

import { createLanguageModel, providerConfigStatus } from "../seams/providers.ts";
import { createResearchRuntime, type RunResearchResult } from "./runtime.ts";
import type { BrowserRunner } from "./tools/browser.ts";

export type AutoresearchChatDeps = {
  /** 测试注入：跳过 live provider / 控制 Engine。 */
  createEngine?: (input: { model: LanguageModel; browserRunner?: BrowserRunner }) => {
    runResearch: (question: string, options?: { abortSignal?: AbortSignal }) => Promise<RunResearchResult>;
  };
  resolveModel?: typeof createLanguageModel;
  browserRunner?: BrowserRunner;
  runtime?: "live" | "deterministic";
};

function lastUserText(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (!message || message.role !== "user") continue;
    const parts = message.parts ?? [];
    const text = parts
      .filter(
        (p): p is { type: "text"; text: string } =>
          p.type === "text" && typeof (p as { text?: unknown }).text === "string",
      )
      .map((p) => p.text)
      .join("\n")
      .trim();
    if (text) return text;
  }
  return "";
}

/** 处理 AI SDK UI chat：问题进 ResearchEngine；交付只认 Decision（ADR-0015）。 */
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

  const question = lastUserText(messages as UIMessage[]);
  if (!question) {
    return Response.json({ error: "empty_question" }, { status: 422 });
  }

  const resolveModel = deps.resolveModel ?? createLanguageModel;
  const model = resolveModel();
  const buildEngine =
    deps.createEngine ??
    ((input: { model: LanguageModel; browserRunner?: BrowserRunner }) =>
      createResearchRuntime({ model: input.model, browserRunner: input.browserRunner }));
  const engine = buildEngine({ model, browserRunner: deps.browserRunner });

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      writer.write({ type: "start" });
      try {
        const { deliveryText, ticket } = await engine.runResearch(question, {
          abortSignal: request.signal,
        });
        const textId = "engine-gated-delivery";
        writer.write({ type: "text-start", id: textId });
        writer.write({ type: "text-delta", id: textId, delta: deliveryText });
        writer.write({ type: "text-end", id: textId });
        writer.setOutcome({
          status: ticket.status === "verified" ? "completed" : "failed",
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const textId = "engine-error";
        const delivery = [
          "[host-gate] FAIL-CLOSED",
          `reason: engine_error`,
          `detail: ${message.slice(0, 500)}`,
          "",
          "ResearchEngine aborted before Decision. Forest hard gate rejected merge.",
        ].join("\n");
        writer.write({ type: "text-start", id: textId });
        writer.write({ type: "text-delta", id: textId, delta: delivery });
        writer.write({ type: "text-end", id: textId });
        writer.setOutcome({ status: "failed" });
      }
    },
  });

  return createUIMessageStreamResponse({ stream });
}
