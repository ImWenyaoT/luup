import type { ResearchTicket } from "../domain.ts";
import { evaluateAutoresearchGate } from "../gate.ts";
import type { AutoresearchRuntime } from "../types.ts";
import type { Assessor } from "./ports.ts";

/** 森林 Assessor：只看冻结证据 + critique，不问模型「过不过」。 */
export function createForestAssessor(): Assessor {
  return {
    assess(ticket: ResearchTicket) {
      const runtime: AutoresearchRuntime = {
        evidence: ticket.evidence,
        critiques: ticket.critiques,
        browserCommands: [],
      };
      return evaluateAutoresearchGate(runtime);
    },
  };
}
