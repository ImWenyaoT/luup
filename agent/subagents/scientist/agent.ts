import { defineAgent } from "eve";

import { ScientistOutputSchema } from "../../lib/contracts.ts";
import { QWEN_CONTEXT_WINDOW_TOKENS, qwenModel } from "../../lib/model.ts";

export default defineAgent({
  description:
    "Scientist. Searches and saves real arXiv evidence, derives a falsifiable hypothesis, and returns the complete " +
    "research plan plus its evidence cards. Revises the plan once when given a review.",
  model: qwenModel({ thinking: true }),
  modelContextWindowTokens: QWEN_CONTEXT_WINDOW_TOKENS,
  limits: { maxInputTokensPerSession: 3_000_000 },
  outputSchema: ScientistOutputSchema,
});
