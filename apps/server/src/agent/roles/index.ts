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
  /** researcher 的上报面。它与上面那个 researcher Agent 是同一份状态，不能分开创建。 */
  capture: StructuredOutput;
  /** ResearchPlan 的独立上报窗口，不能与 researcher 共用状态。 */
  planCapture: StructuredOutput;
  /** Reviewer 的上报窗口；检索台账仍由同一个 ledger 持有。 */
  reviewCapture: StructuredOutput;
};

export function createRoles(ledger: EvidenceLedger): Roles {
  const researcher = defineResearcher(ledger);
  const planner = definePlanner();
  const reviewer = defineReviewer(ledger);
  return {
    agents: {
      researcher: researcher.agent,
      "hypothesis-generation": defineHypothesis(),
      "evidence-review": defineEvidenceReview(),
      "research-plan": planner.agent,
      reviewer: reviewer.agent,
    },
    capture: researcher.capture,
    planCapture: planner.capture,
    reviewCapture: reviewer.capture,
  };
}
