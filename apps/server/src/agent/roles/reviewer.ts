import { Agent } from "@openai/agents";

import { modelForRole, sharedModelSettings } from "../../seams/index.ts";
import { reviewSchema } from "../contracts.ts";
import { instructionsFrom } from "../instructions.ts";

/** 零工具角色：只看冻结 Artifact，没有任何检索面。 */
export default function defineFinalReviewer() {
  return new Agent({
    name: "FinalReviewer",
    model: modelForRole(),
    instructions: instructionsFrom(import.meta.dirname, "reviewer.md"),
    tools: [],
    outputType: reviewSchema,
    modelSettings: sharedModelSettings,
  });
}
