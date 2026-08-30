import type { RunEvent } from "../types/wire";
import { TERMINAL_SSE_EVENT_KINDS, UI_SSE_EVENT_KINDS } from "./events";
import { parseSseMessage } from "./parse-sse-message";

export type RunEventSubscription = {
  close(): void;
  readonly runId: string;
  readonly afterVersion: number;
};

export type SubscribeRunEventsOptions = {
  baseUrl?: string;
  eventSourceFactory?: (url: string) => EventSource;
  onParsed?: (event: RunEvent) => void;
  onOpen?: () => void;
  onError?: (error: Error) => void;
};

export function subscribeRunEvents(
  runId: string,
  afterVersion: number,
  onTick: () => void,
  options: SubscribeRunEventsOptions = {},
): RunEventSubscription {
  const baseUrl = options.baseUrl ?? "";
  const factory = options.eventSourceFactory ?? ((url: string) => new EventSource(url));
  const url = `${baseUrl}/api/runs/${encodeURIComponent(runId)}/events?after=${afterVersion}`;
  const source = factory(url);
  let closed = false;

  const close = (): void => {
    if (closed) return;
    closed = true;
    source.close();
  };

  const handle = (event: Event): void => {
    if (closed) return;
    const message = event as MessageEvent<string>;
    let parsed: RunEvent;
    try {
      parsed = parseSseMessage(message.data, event.type);
    } catch (cause) {
      options.onError?.(cause instanceof Error ? cause : new Error(String(cause)));
      return;
    }
    options.onParsed?.(parsed);
    onTick();
    if ((TERMINAL_SSE_EVENT_KINDS as readonly string[]).includes(event.type)) close();
  };

  for (const kind of UI_SSE_EVENT_KINDS) {
    source.addEventListener(kind, handle);
  }
  source.addEventListener("open", () => options.onOpen?.());
  source.addEventListener("error", () => options.onError?.(new Error(`Run ${runId} 的 SSE 连接中断`)));

  return { runId, afterVersion, close };
}
