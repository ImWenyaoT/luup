import { Agent } from "@openai/agents";

import { modelForRole, sharedModelSettings } from "../../seams/index.ts";
import type { EvidenceLedger } from "../evidence.ts";
import { reviewOutputSchema } from "../contracts.ts";
import { instructionsFrom } from "../instructions.ts";
import { createArxivSearchTool } from "../tools/arxiv-search.ts";
import { createCrossrefSearchTool } from "../tools/crossref-search.ts";
import { createStructuredOutput, STRUCTURED_OUTPUT_INSTRUCTION, type StructuredOutput } from "./structured-output.ts";

/** 只看冻结 Artifact，并拥有受限的独立反证检索面。 */
export function createReviewerSearchPermit(maxSearches = 2): () => void {
  let searches = 0;
  return () => {
    if (searches >= maxSearches) throw new Error("Reviewer search budget exhausted: use the evidence already returned");
    searches += 1;
  };
}

export default function defineFinalReviewer(ledger: EvidenceLedger): {
  agent: Agent<any, any>;
  capture: StructuredOutput;
} {
  const capture = createStructuredOutput(reviewOutputSchema);
  const permitSearch = createReviewerSearchPermit();
  const beforeSearch = () => {
    capture.assertOpen();
    permitSearch();
  };
  const agent = new Agent({
    name: "FinalReviewer",
    model: modelForRole(),
    instructions: [instructionsFrom(import.meta.dirname, "reviewer.md"), STRUCTURED_OUTPUT_INSTRUCTION].join("\n\n"),
    tools: [createArxivSearchTool(ledger, beforeSearch), createCrossrefSearchTool(ledger, beforeSearch), capture.tool],
    toolUseBehavior: capture.toolUseBehavior,
    modelSettings: { ...sharedModelSettings, parallelToolCalls: false },
  });
  return { agent, capture };
}
