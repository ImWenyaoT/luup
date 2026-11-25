import assert from "node:assert/strict";
import { test } from "vitest";

import { deriveMessages } from "../src/autoresearch/session/derive.ts";
import { SessionLog } from "../src/autoresearch/session/log.ts";

test("SessionLog 追加事件；deriveMessages 只投影对话面", () => {
  const log = new SessionLog("literature", { id: "sess_lit_test" });
  log.append({ type: "system/message", text: "You are literature.", at: "2026-01-01T00:00:00.000Z" });
  log.append({ type: "user/message", text: "Find papers on pulsars.", at: "2026-01-01T00:00:01.000Z" });
  log.append({
    type: "tool/call",
    callId: "c1",
    name: "arxiv_search",
    input: { q: "pulsar" },
    at: "2026-01-01T00:00:02.000Z",
  });
  log.append({
    type: "tool/result",
    callId: "c1",
    name: "arxiv_search",
    output: { hits: 1 },
    at: "2026-01-01T00:00:03.000Z",
  });
  log.append({ type: "assistant/message", text: "Found one paper.", at: "2026-01-01T00:00:04.000Z" });
  log.append({
    type: "decision",
    outcome: "accept",
    reason: "n/a",
    at: "2026-01-01T00:00:05.000Z",
  });

  const messages = deriveMessages(log.snapshot().events);
  assert.equal(messages.length, 3);
  assert.equal(messages[0]?.role, "system");
  assert.equal(messages[1]?.role, "user");
  assert.equal(messages[2]?.role, "assistant");
  const systemText = typeof messages[0]?.content === "string" ? messages[0].content : "";
  const assistantText = typeof messages[2]?.content === "string" ? messages[2].content : "";
  assert.match(systemText, /literature/);
  assert.match(assistantText, /Found one paper/);
});
