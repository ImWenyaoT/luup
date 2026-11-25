import { Output, ToolLoopAgent, generateText, isStepCount } from "ai";
import { z } from "zod";

import { CRITIC_INSTRUCTIONS, LITERATURE_INSTRUCTIONS, WEB_INSTRUCTIONS } from "../prompts.ts";
import { nowIso, type WorkerReport } from "../domain.ts";
import { createBrowserTools } from "../tools/browser.ts";
import { createLiteratureTools } from "../tools/literature.ts";
import type { AutoresearchRuntime, CritiqueResult } from "../types.ts";
import type { ExecutorLaunchInput, WorkerExecutor } from "../engine/ports.ts";

const critiqueSchema = z.object({
  verdict: z.enum(["supports", "contradicts", "insufficient"]),
  rationale: z.string().min(1),
  gaps: z.array(z.string()).default([]),
});

function emptyRuntime(): AutoresearchRuntime {
  return { evidence: [], critiques: [], browserCommands: [] };
}

/** WorkerExecutor：每个 Assignment 独占 Session + 工具面（形制学 superagent DshExecutor）。 */
export function createWorkerExecutor(): WorkerExecutor {
  return {
    async run(input: ExecutorLaunchInput): Promise<WorkerReport> {
      const { assignment, session, model, browserRunner, abortSignal, ticket } = input;
      const turnId = `turn_${assignment.id}`;
      const atStart = nowIso();
      session.append({ type: "turn/start", turnId, at: atStart });
      session.append({
        type: "user/message",
        text: [
          `Research question: ${ticket.question}`,
          `Assignment role: ${assignment.role}`,
          "Complete your specialized work. Cite only tool-returned evidence ids.",
        ].join("\n"),
        at: atStart,
      });

      if (assignment.role === "critic") {
        const evidenceBlock =
          ticket.evidence.length === 0
            ? "(no frozen evidence)"
            : ticket.evidence
                .map((e) => `- ${e.evidenceId} [${e.source}] ${e.locator}: ${e.title}\n  ${e.summary.slice(0, 280)}`)
                .join("\n");
        // propose → critique：审的是工人草稿，不是原问题。
        const proposedDraft =
          ticket.assignments
            .filter((a) => a.role !== "critic" && a.report?.summary)
            .map((a) => `### ${a.role}\n${a.report!.summary}`)
            .join("\n\n") || "(no worker drafts yet)";
        const prompt = [
          "Frozen evidence (authoritative; do not invent more):",
          evidenceBlock,
          "",
          "Proposed worker drafts to critique (do not trust; verify against evidence):",
          proposedDraft,
          "",
          `Original research question: ${ticket.question}`,
          "",
          "Return structured output only: verdict ∈ supports|contradicts|insufficient, rationale, gaps[].",
        ].join("\n");
        const result = await generateText({
          model,
          system: CRITIC_INSTRUCTIONS,
          prompt,
          output: Output.object({ schema: critiqueSchema }),
          abortSignal,
        });
        const critique: CritiqueResult = {
          verdict: result.output.verdict,
          rationale: result.output.rationale,
          gaps: result.output.gaps ?? [],
        };
        const summary = `verdict=${critique.verdict}\n${critique.rationale}`;
        session.append({ type: "assistant/message", text: summary, at: nowIso() });
        session.append({
          type: "worker/report",
          role: "critic",
          summary,
          evidence: [],
          critique,
          at: nowIso(),
        });
        session.append({ type: "turn/end", turnId, at: nowIso() });
        return {
          assignmentId: assignment.id,
          role: "critic",
          summary,
          evidence: [],
          critique,
          at: nowIso(),
        };
      }

      const runtime = emptyRuntime();
      const tools =
        assignment.role === "literature" ? createLiteratureTools(runtime) : createBrowserTools(runtime, browserRunner);
      const instructions = assignment.role === "literature" ? LITERATURE_INSTRUCTIONS : WEB_INSTRUCTIONS;
      const agent = new ToolLoopAgent({
        model,
        instructions,
        tools,
        stopWhen: isStepCount(assignment.role === "literature" ? 8 : 10),
      });
      const result = await agent.generate({
        prompt: ticket.question,
        abortSignal,
      });
      session.append({ type: "assistant/message", text: result.text, at: nowIso() });
      session.append({
        type: "worker/report",
        role: assignment.role,
        summary: result.text,
        evidence: [...runtime.evidence],
        critique: null,
        at: nowIso(),
      });
      session.append({ type: "turn/end", turnId, at: nowIso() });
      return {
        assignmentId: assignment.id,
        role: assignment.role,
        summary: result.text,
        evidence: [...runtime.evidence],
        critique: null,
        at: nowIso(),
      };
    },
  };
}
