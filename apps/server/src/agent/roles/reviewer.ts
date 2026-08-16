import { Agent } from "@openai/agents";

import { modelForRole, sharedModelSettings } from "../../seams/index.ts";
import type { EvidenceLedger } from "../evidence.ts";
import { reviewSchema } from "../contracts.ts";
import { instructionsFrom } from "../instructions.ts";
import { createArxivSearchTool } from "../tools/arxiv-search.ts";
import { createCrossrefSearchTool } from "../tools/crossref-search.ts";

/** 只看冻结 Artifact，并拥有受限的独立反证检索面。 */
export default function defineFinalReviewer(ledger: EvidenceLedger) {
  return new Agent({
    name: "FinalReviewer",
    model: modelForRole(),
    instructions: instructionsFrom(import.meta.dirname, "reviewer.md"),
    tools: [createArxivSearchTool(ledger), createCrossrefSearchTool(ledger)],
    outputType: reviewSchema,
    modelSettings: sharedModelSettings,
  });
}
