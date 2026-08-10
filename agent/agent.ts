import { defineAgent } from "eve";

import { QWEN_CONTEXT_WINDOW_TOKENS, qwenModel } from "./lib/model.ts";

export default defineAgent({
  model: qwenModel(),
  modelContextWindowTokens: QWEN_CONTEXT_WINDOW_TOKENS,
  compaction: { thresholdPercent: 0.8 },
  limits: {
    maxInputTokensPerSession: 8_000_000,
    maxOutputTokensPerSession: 800_000,
    sessionTimeoutMs: 60 * 60 * 1000,
  },
});
