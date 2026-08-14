import { Agent } from "@openai/agents";

import { modelForRole, sharedModelSettings } from "../../seams/index.ts";
import { evidenceReviewSchema } from "../contracts.ts";
import { instructionsFrom } from "../instructions.ts";

/** 零工具角色：只看冻结 Artifact，没有任何检索面。 */
export default function defineCriticalReviewer() {
  return new Agent({
    name: "CriticalReviewer",
    model: modelForRole(),
    instructions: instructionsFrom(import.meta.dirname, "evidence-review.md"),
    tools: [],
    outputType: evidenceReviewSchema,
    modelSettings: sharedModelSettings,
  });
}
