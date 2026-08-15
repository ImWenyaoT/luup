import { Agent } from "@openai/agents";

import { modelForRole, sharedModelSettings } from "../../seams/index.ts";
import { hypothesisSchema } from "../contracts.ts";
import { instructionsFrom } from "../instructions.ts";

/** 零工具角色：只看冻结 Artifact，没有任何检索面。 */
export default function defineHypothesisScientist() {
  return new Agent({
    name: "HypothesisScientist",
    model: modelForRole(),
    instructions: instructionsFrom(import.meta.dirname, "hypothesis-generation.md"),
    tools: [],
    outputType: hypothesisSchema,
    modelSettings: sharedModelSettings,
  });
}
