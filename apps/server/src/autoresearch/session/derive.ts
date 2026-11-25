import type { ModelMessage } from "ai";

import type { SessionEvent } from "./events.ts";

/** 从 Session log 投影模型历史（dsh：Model-visible means logged）。 */
export function deriveMessages(events: readonly SessionEvent[]): ModelMessage[] {
  const messages: ModelMessage[] = [];
  let systemParts: string[] = [];

  const flushSystem = () => {
    if (systemParts.length === 0) return;
    messages.push({ role: "system", content: systemParts.join("\n\n") });
    systemParts = [];
  };

  for (const event of events) {
    switch (event.type) {
      case "system/message":
        systemParts.push(event.text);
        break;
      case "user/message":
        flushSystem();
        messages.push({ role: "user", content: event.text });
        break;
      case "assistant/message":
        flushSystem();
        messages.push({ role: "assistant", content: event.text });
        break;
      case "tool/call":
      case "tool/result":
      case "worker/report":
      case "decision":
      case "turn/start":
      case "turn/end":
        // 工具与决策入日志供审计；当前工人执行用独立 generate，不把 raw tool 帧喂回主模型。
        break;
      default: {
        const _exhaustive: never = event;
        void _exhaustive;
      }
    }
  }
  flushSystem();
  return messages;
}
