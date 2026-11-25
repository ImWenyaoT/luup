import { convertToModelMessages, createUIMessageStream, createUIMessageStreamResponse, type UIMessage } from "ai";

import { createLanguageModel, providerConfigStatus } from "../seams/providers.ts";
import { formatGateDelivery } from "./gate.ts";
import { createAutoresearchAgents, type BrowserRunner } from "./index.ts";

export type AutoresearchChatDeps = {
  /** 测试注入：跳过 live provider。 */
  createAgents?: typeof createAutoresearchAgents;
  resolveModel?: typeof createLanguageModel;
  browserRunner?: BrowserRunner;
  runtime?: "live" | "deterministic";
};

/** 处理 AI SDK UI chat 请求 → coordinator 跑完后由宿主硬闸决定交付文本。 */
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
  const { coordinator, evaluateGate } = buildAgents({
    model,
    browserRunner: deps.browserRunner,
  });

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      writer.write({ type: "start" });

      const result = await coordinator.generate({
        messages: await convertToModelMessages(messages as UIMessage[], {
          ignoreIncompleteToolCalls: true,
        }),
        abortSignal: request.signal,
      });

      // 宿主硬闸：gate 不过则不交付 coordinator draft（ADR-0012 / ADR-0013）。
      const gate = evaluateGate();
      const delivery = formatGateDelivery(gate, result.text);
      const textId = "host-gated-delivery";
      writer.write({ type: "text-start", id: textId });
      writer.write({ type: "text-delta", id: textId, delta: delivery });
      writer.write({ type: "text-end", id: textId });
      writer.setOutcome({ status: gate.ok ? "completed" : "failed" });
    },
  });

  return createUIMessageStreamResponse({ stream });
}
