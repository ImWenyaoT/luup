import { Agent } from "@openai/agents";

import { modelForRole, sharedModelSettings } from "../../seams/index.ts";
import { researchPlanSchema } from "../contracts.ts";
import { instructionsFrom } from "../instructions.ts";

/** 零工具角色：只看冻结 Artifact，没有任何检索面。 */
export default function defineResearchPlanner() {
  return new Agent({
    name: "ResearchPlanner",
    model: modelForRole(),
    instructions: instructionsFrom(import.meta.dirname, "research-plan.md"),
    tools: [],
    outputType: researchPlanSchema,
    modelSettings: sharedModelSettings,
  });
}
