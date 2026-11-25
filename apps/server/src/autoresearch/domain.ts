/** Autoresearch 领域模型（形制学 dsh-superagent：Ticket / Assignment / Report / Decision）。 */

import type { AutoresearchGate, CritiqueResult, EvidenceHit } from "./types.ts";

export type ResearchRole = "main" | "literature" | "web" | "critic";

export type DecisionOutcome = "accept" | "reject" | "verified" | "fail_closed";

export type Decision = {
  id: string;
  ticketId: string;
  outcome: DecisionOutcome;
  reason: string;
  gate: AutoresearchGate | null;
  at: string;
};

export type WorkerReport = {
  assignmentId: string;
  role: Exclude<ResearchRole, "main">;
  summary: string;
  evidence: EvidenceHit[];
  critique: CritiqueResult | null;
  at: string;
};

export type AssignmentStatus = "pending" | "running" | "completed" | "failed";

export type Assignment = {
  id: string;
  ticketId: string;
  role: Exclude<ResearchRole, "main">;
  status: AssignmentStatus;
  sessionId: string;
  report: WorkerReport | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
};

export type TicketStatus = "open" | "awaiting_assess" | "verified" | "rejected" | "failed";

export type ResearchTicket = {
  id: string;
  question: string;
  status: TicketStatus;
  mainSessionId: string;
  assignments: Assignment[];
  decisions: Decision[];
  evidence: EvidenceHit[];
  critiques: CritiqueResult[];
  deliveryText: string | null;
  createdAt: string;
  finishedAt: string | null;
};

export function nowIso(clock: () => Date = () => new Date()): string {
  return clock().toISOString();
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
}
