/** Deterministic WorkerExecutor：零 LLM 调用，给 LUUP_RUNTIME=deterministic / e2e 用。 */

import { nowIso, type WorkerReport } from "../domain.ts";
import type { ExecutorLaunchInput, WorkerExecutor } from "../engine/ports.ts";

/** 工人全 stub；Critic 默认 insufficient → 宿主硬闸 FAIL-CLOSED（无真证据时）。 */
export function createDeterministicWorkerExecutor(): WorkerExecutor {
  return {
    async run(input: ExecutorLaunchInput): Promise<WorkerReport> {
      const { assignment, session, ticket } = input;
      const turnId = `turn_${assignment.id}`;
      const at = nowIso();
      session.append({ type: "turn/start", turnId, at });
      session.append({
        type: "user/message",
        text: `[deterministic] ${assignment.role}: ${ticket.question}`,
        at,
      });

      if (assignment.role === "critic") {
        const drafts = ticket.assignments
          .filter((a) => a.role !== "critic" && a.report?.summary)
          .map((a) => a.report!.summary.slice(0, 200))
          .join(" | ");
        const critique = {
          verdict: "insufficient" as const,
          rationale: `[deterministic] Critic saw drafts (${drafts.length} chars) but runtime forbids live tools/evidence.`,
          gaps: ["deterministic_runtime", "no_live_evidence"],
        };
        const summary = `verdict=${critique.verdict}\n${critique.rationale}`;
        session.append({ type: "assistant/message", text: summary, at });
        session.append({
          type: "worker/report",
          role: "critic",
          summary,
          evidence: [],
          critique,
          at,
        });
        session.append({ type: "turn/end", turnId, at });
        return {
          assignmentId: assignment.id,
          role: "critic",
          summary,
          evidence: [],
          critique,
          at,
        };
      }

      const summary = `[deterministic] ${assignment.role} stub — no live tools. Question: ${ticket.question.slice(0, 240)}`;
      session.append({ type: "assistant/message", text: summary, at });
      session.append({
        type: "worker/report",
        role: assignment.role,
        summary,
        evidence: [],
        critique: null,
        at,
      });
      session.append({ type: "turn/end", turnId, at });
      return {
        assignmentId: assignment.id,
        role: assignment.role,
        summary,
        evidence: [],
        critique: null,
        at,
      };
    },
  };
}
