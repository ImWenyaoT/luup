import type { Agent } from "@openai/agents";

import type { EvidenceLedger } from "../evidence.ts";
import type { Role } from "../contracts.ts";
import defineEvidenceReview from "./evidence-review.ts";
import defineHypothesis from "./hypothesis-generation.ts";
import definePlanner from "./research-plan.ts";
import defineResearcher from "./researcher.ts";
import defineReviewer from "./reviewer.ts";

/** Record 强制五个角色和 Role 类型一致，漏一个会在编译期报错。 */
export function createRoles(ledger: EvidenceLedger): Record<Role, Agent<any, any>> {
  return {
    "researcher": defineResearcher(ledger),
    "hypothesis-generation": defineHypothesis(),
    "evidence-review": defineEvidenceReview(),
    "research-plan": definePlanner(),
    "reviewer": defineReviewer(),
  };
}
