import { Agent } from "@openai/agents";

import { modelForRole, sharedModelSettings } from "../../seams/index.ts";
import { researchPlanSchema } from "../contracts.ts";
import { instructionsFrom } from "../instructions.ts";
import { createStructuredOutput, STRUCTURED_OUTPUT_INSTRUCTION, type StructuredOutput } from "./structured-output.ts";

/** 无检索面；合成工具只负责把 Proposal schema 错误逐条回灌给模型。 */
export default function defineResearchPlanner(): { agent: Agent<any, any>; capture: StructuredOutput } {
  const capture = createStructuredOutput(researchPlanSchema);
  const agent = new Agent({
    name: "ResearchPlanner",
    model: modelForRole(),
    instructions: [instructionsFrom(import.meta.dirname, "research-plan.md"), STRUCTURED_OUTPUT_INSTRUCTION].join(
      "\n\n",
    ),
    tools: [capture.tool],
    toolUseBehavior: capture.toolUseBehavior,
    modelSettings: sharedModelSettings,
  });
  return { agent, capture };
}
