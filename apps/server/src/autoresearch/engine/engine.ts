import { formatGateDelivery } from "../gate.ts";
import { newId, nowIso, type Assignment, type Decision, type ResearchTicket, type WorkerReport } from "../domain.ts";
import { SessionLog } from "../session/log.ts";
import type { EnginePorts } from "./ports.ts";

export type RunResearchResult = {
  ticket: ResearchTicket;
  deliveryText: string;
  sessions: SessionLog[];
};

/**
 * ResearchEngine：Ticket / Assignment / Report / Decision 的唯一写者
 *（形制学 dsh-superagent Engine；同步命令 + 端口回调）。
 */
export class ResearchEngine {
  readonly #ports: EnginePorts;

  constructor(ports: EnginePorts) {
    this.#ports = ports;
  }

  /** 主入口：开 Ticket → 工人 Assignment → Assessor Decision → 交付文本。 */
  async runResearch(question: string, options: { abortSignal?: AbortSignal } = {}): Promise<RunResearchResult> {
    const clock = this.#ports.clock ?? (() => new Date());
    const trimmed = question.trim();
    if (!trimmed) throw new Error("empty_question");

    const mainSession = new SessionLog("main", { clock });
    const ticket: ResearchTicket = {
      id: newId("ticket"),
      question: trimmed,
      status: "open",
      mainSessionId: mainSession.record.id,
      assignments: [],
      decisions: [],
      evidence: [],
      critiques: [],
      deliveryText: null,
      createdAt: nowIso(clock),
      finishedAt: null,
    };

    mainSession.append({
      type: "system/message",
      text: "Luup Autoresearch main session. Engine owns delivery; workers propose only.",
      at: nowIso(clock),
    });
    mainSession.append({ type: "user/message", text: trimmed, at: nowIso(clock) });
    this.#ports.repos.saveSession(mainSession);
    this.#ports.repos.saveTicket(ticket);
    this.#ports.emit?.({ type: "ticket.created", ticketId: ticket.id });

    const roles = ["literature", "web", "critic"] as const;
    for (const role of roles) {
      await this.#runAssignment(ticket, mainSession, role, options.abortSignal);
    }

    ticket.status = "awaiting_assess";
    this.#ports.repos.saveTicket(ticket);

    const gate = this.#ports.assessor.assess(ticket);
    const decision: Decision = {
      id: newId("decision"),
      ticketId: ticket.id,
      outcome: gate.ok ? "verified" : "fail_closed",
      reason: gate.reason,
      gate,
      at: nowIso(clock),
    };
    ticket.decisions.push(decision);
    ticket.status = gate.ok ? "verified" : "rejected";
    ticket.finishedAt = nowIso(clock);

    // 交付面 = 工人 propose 草稿（critic 已审过的那份），不含 critic 自身摘要。
    const draft =
      ticket.assignments
        .filter((a) => a.role !== "critic")
        .map((a) => a.report?.summary)
        .filter((s): s is string => Boolean(s))
        .join("\n\n---\n\n") || "(no worker summaries)";
    const deliveryText = formatGateDelivery(gate, draft);
    ticket.deliveryText = deliveryText;

    mainSession.append({
      type: "decision",
      outcome: decision.outcome,
      reason: decision.reason,
      at: decision.at,
    });
    mainSession.append({ type: "assistant/message", text: deliveryText, at: nowIso(clock) });
    this.#ports.repos.saveSession(mainSession);
    this.#ports.repos.saveTicket(ticket);
    this.#ports.emit?.({
      type: "decision.recorded",
      ticketId: ticket.id,
      detail: { outcome: decision.outcome, reason: decision.reason },
    });

    const sessions = [mainSession];
    for (const assignment of ticket.assignments) {
      const worker = this.#ports.repos.getSession(assignment.sessionId);
      if (worker) sessions.push(worker);
    }
    return { ticket, deliveryText, sessions };
  }

  async #runAssignment(
    ticket: ResearchTicket,
    mainSession: SessionLog,
    role: Assignment["role"],
    abortSignal?: AbortSignal,
  ): Promise<void> {
    const clock = this.#ports.clock ?? (() => new Date());
    const workerSession = new SessionLog(role, {
      parentSessionId: mainSession.record.id,
      clock,
    });
    const assignment: Assignment = {
      id: newId(`asg_${role}`),
      ticketId: ticket.id,
      role,
      status: "pending",
      sessionId: workerSession.record.id,
      report: null,
      error: null,
      startedAt: null,
      finishedAt: null,
    };
    ticket.assignments.push(assignment);
    this.#ports.repos.saveSession(workerSession);
    this.#ports.repos.saveTicket(ticket);
    this.#ports.emit?.({
      type: "assignment.started",
      ticketId: ticket.id,
      detail: { assignmentId: assignment.id, role },
    });

    assignment.status = "running";
    assignment.startedAt = nowIso(clock);
    this.#ports.repos.saveTicket(ticket);

    try {
      const report: WorkerReport = await this.#ports.executor.run({
        ticket,
        assignment,
        session: workerSession,
        model: this.#ports.model,
        browserRunner: this.#ports.browserRunner,
        abortSignal,
      });
      assignment.report = report;
      assignment.status = "completed";
      assignment.finishedAt = nowIso(clock);
      // Engine 合并冻结面：工人只能 propose
      ticket.evidence.push(...report.evidence);
      if (report.critique) ticket.critiques.push(report.critique);
      mainSession.append({
        type: "worker/report",
        role,
        summary: report.summary,
        evidence: report.evidence,
        critique: report.critique,
        at: report.at,
      });
      this.#ports.repos.saveSession(workerSession);
      this.#ports.repos.saveTicket(ticket);
      this.#ports.emit?.({
        type: "assignment.ended",
        ticketId: ticket.id,
        detail: { assignmentId: assignment.id, role, status: "completed" },
      });
    } catch (error) {
      assignment.status = "failed";
      assignment.error = error instanceof Error ? error.message : String(error);
      assignment.finishedAt = nowIso(clock);
      ticket.status = "failed";
      ticket.finishedAt = nowIso(clock);
      this.#ports.repos.saveTicket(ticket);
      this.#ports.emit?.({
        type: "assignment.ended",
        ticketId: ticket.id,
        detail: { assignmentId: assignment.id, role, status: "failed", error: assignment.error },
      });
      throw error;
    }
  }
}
