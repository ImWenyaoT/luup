import { Agent } from "@openai/agents";

import { modelForRole, sharedModelSettings } from "../../seams/index.ts";
import { evidenceReviewSchema } from "../contracts.ts";
import { instructionsFrom } from "../instructions.ts";
import { createStructuredOutput, STRUCTURED_OUTPUT_INSTRUCTION, type StructuredOutput } from "./structured-output.ts";

/** 只看冻结 Artifact，没有检索面；产物经合成工具交给本地 schema 验收。 */
export default function defineCriticalReviewer(): { agent: Agent<any, any>; capture: StructuredOutput } {
  const capture = createStructuredOutput(evidenceReviewSchema);
  const agent = new Agent({
    name: "CriticalReviewer",
    model: modelForRole(),
    instructions: [instructionsFrom(import.meta.dirname, "evidence-review.md"), STRUCTURED_OUTPUT_INSTRUCTION].join(
      "\n\n",
    ),
    tools: [capture.tool],
    toolUseBehavior: capture.toolUseBehavior,
    modelSettings: sharedModelSettings,
  });
  return { agent, capture };
}
