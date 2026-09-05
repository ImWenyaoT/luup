import type { Agent } from "@openai/agents";

import type { EvidenceLedger } from "../evidence.ts";
import type { Role } from "../contracts.ts";
import defineEvidenceReview from "./evidence-review.ts";
import defineHypothesis from "./hypothesis-generation.ts";
import definePlanner from "./research-plan.ts";
import defineResearcher from "./researcher.ts";
import defineReviewer from "./reviewer.ts";
import type { StructuredOutput } from "./structured-output.ts";

export type Roles = {
  /** Record 强制五个角色和 Role 类型一致，漏一个会在编译期报错。 */
  agents: Record<Role, Agent<any, any>>;
  /** 每个角色独立的上报窗口，与 agents 的角色集合一致。 */
  captures: Record<Role, StructuredOutput>;
};

export function createRoles(ledger: EvidenceLedger): Roles {
  const researcher = defineResearcher(ledger);
  const hypothesis = defineHypothesis();
  const evidenceReview = defineEvidenceReview();
  const planner = definePlanner();
  const reviewer = defineReviewer(ledger);
  return {
    agents: {
      researcher: researcher.agent,
      "hypothesis-generation": hypothesis.agent,
      "evidence-review": evidenceReview.agent,
      "research-plan": planner.agent,
      reviewer: reviewer.agent,
    },
    captures: {
      researcher: researcher.capture,
      "hypothesis-generation": hypothesis.capture,
      "evidence-review": evidenceReview.capture,
      "research-plan": planner.capture,
      reviewer: reviewer.capture,
    },
  };
}
