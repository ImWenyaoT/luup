/** 连续战役（永动机）领域类型。 */

export type AgendaItem = {
  id: string;
  question: string;
  source: "seed" | "follow_up" | "manual";
  createdAt: string;
  consumedAt: string | null;
};

export type ResearchAgenda = {
  topic: string;
  items: AgendaItem[];
};

export type PaperDraft = {
  id: string;
  ticketId: string;
  title: string;
  abstract: string;
  bodyMarkdown: string;
  evidenceIds: string[];
  createdAt: string;
};

export type MillTicketRecord = {
  ticketId: string;
  question: string;
  outcome: "verified" | "fail_closed" | "error";
  reason: string;
  paperId: string | null;
  at: string;
};

export type MillStatus = "idle" | "running" | "completed" | "exhausted" | "stopped" | "failed";

export type QuantityGate = {
  targetPapers: number;
  papersProduced: number;
  ok: boolean;
};

export type MillSnapshot = {
  id: string;
  status: MillStatus;
  agenda: ResearchAgenda;
  papers: PaperDraft[];
  tickets: MillTicketRecord[];
  quantity: QuantityGate;
  maxTickets: number;
  ticketsStarted: number;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
  lastError: string | null;
};

export type StartMillInput = {
  topic: string;
  seedQuestions: string[];
  /** 产量目标：至少产出这么多 verified Paper。 */
  targetPapers: number;
  /** 安全上界：最多开多少张 Ticket（防失控烧钱）。 */
  maxTickets: number;
};
