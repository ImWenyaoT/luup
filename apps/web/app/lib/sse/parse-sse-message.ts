import type { RunEvent } from "../types/wire";
import { RUN_EVENT_KINDS } from "./events";

const KNOWN_KINDS = new Set<string>(RUN_EVENT_KINDS);

class SseProtocolError extends Error {
  override readonly name = "SseProtocolError";
}

export function parseSseMessage(data: string, kind?: string): RunEvent {
  if (kind && !KNOWN_KINDS.has(kind)) throw new SseProtocolError(`未知 SSE event kind：${kind}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch (cause) {
    throw new SseProtocolError("SSE data 不是有效 JSON", { cause });
  }
  if (typeof parsed !== "object" || parsed === null) throw new SseProtocolError("SSE data 必须是对象");
  const event = parsed as Partial<RunEvent>;
  if (typeof event.id !== "number" || typeof event.version !== "number") {
    throw new SseProtocolError("SSE data 缺少数字 id/version");
  }
  if (typeof event.kind !== "string" || typeof event.created_at !== "string") {
    throw new SseProtocolError("SSE data 缺少 kind/created_at");
  }
  if (kind && event.kind !== kind) throw new SseProtocolError(`SSE event kind 不一致：${kind} != ${event.kind}`);
  if (typeof event.payload !== "object" || event.payload === null || Array.isArray(event.payload)) {
    throw new SseProtocolError("SSE payload 必须是对象");
  }
  return event as RunEvent;
}
