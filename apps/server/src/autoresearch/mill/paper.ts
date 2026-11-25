import { newId, nowIso, type ResearchTicket } from "../domain.ts";
import type { PaperDraft } from "./types.ts";

/** 从 verified Ticket 铸 Paper 草稿（产量单元；质量门另开）。 */
export function mintPaperDraft(ticket: ResearchTicket, clock: () => Date = () => new Date()): PaperDraft {
  const title = deriveTitle(ticket.question, ticket.deliveryText ?? "");
  const abstract = (ticket.deliveryText ?? "").slice(0, 600).trim() || ticket.question;
  const sections = [
    `# ${title}`,
    "",
    `> Autoresearch paper draft · ticket \`${ticket.id}\` · ${nowIso(clock)}`,
    "",
    "## Abstract",
    "",
    abstract,
    "",
    "## Research question",
    "",
    ticket.question,
    "",
    "## Evidence",
    "",
    ...(ticket.evidence.length === 0
      ? ["_(no frozen evidence)_"]
      : ticket.evidence.map(
          (e) =>
            `- **${e.evidenceId}** [${e.source}] ${e.title}\n  - locator: ${e.locator}\n  - ${e.summary.slice(0, 400)}`,
        )),
    "",
    "## Critiques",
    "",
    ...(ticket.critiques.length === 0
      ? ["_(none)_"]
      : ticket.critiques.map((c) => `- **${c.verdict}**: ${c.rationale.slice(0, 500)}`)),
    "",
    "## Worker reports",
    "",
    ...ticket.assignments.map((a) => {
      const summary = a.report?.summary?.slice(0, 2000) ?? "(no report)";
      return `### ${a.role}\n\n${summary}`;
    }),
    "",
    "## Host decision",
    "",
    ticket.decisions.map((d) => `- ${d.outcome}: ${d.reason}`).join("\n") || "_(none)_",
  ];
  return {
    id: newId("paper"),
    ticketId: ticket.id,
    title,
    abstract,
    bodyMarkdown: sections.join("\n"),
    evidenceIds: ticket.evidence.map((e) => e.evidenceId),
    createdAt: nowIso(clock),
  };
}

function deriveTitle(question: string, delivery: string): string {
  const heading = delivery.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (heading) return heading.slice(0, 160);
  const q = question.trim().replace(/\s+/g, " ");
  return q.length > 100 ? `${q.slice(0, 97)}...` : q || "Untitled draft";
}

/** 从交付文本粗抽 follow-up 问题（确定性启发式；模型生成另开）。 */
export function extractFollowUps(deliveryText: string, limit = 2): string[] {
  const out: string[] = [];
  for (const line of deliveryText.split(/\n+/)) {
    const trimmed = line.trim();
    const m =
      trimmed.match(/^(?:[-*•]|\d+[.)])\s*(?:follow[- ]?ups?:?\s*)?(.+\?)\s*$/i) ??
      trimmed.match(/^follow[- ]?ups?:?\s*(.+\?)\s*$/i);
    if (m?.[1]) {
      const q = m[1].trim();
      if (q.length >= 12 && !out.includes(q)) out.push(q);
    }
    if (out.length >= limit) break;
  }
  return out.slice(0, limit);
}
