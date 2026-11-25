import type { ApiClient } from "./client";
import { withAuth } from "./client";

export type MillQuantity = {
  targetPapers: number;
  papersProduced: number;
  ok: boolean;
};

export type MillPaper = {
  id: string;
  ticketId: string;
  title: string;
  abstract: string;
  bodyMarkdown: string;
  evidenceIds: string[];
  createdAt: string;
};

export type MillSnapshot = {
  id?: string;
  status: "idle" | "running" | "completed" | "exhausted" | "stopped" | "failed";
  agenda?: { topic: string; items: Array<{ question: string; consumedAt: string | null }> };
  papers?: MillPaper[];
  tickets?: Array<{ ticketId: string; outcome: string; reason: string }>;
  quantity?: MillQuantity;
  maxTickets?: number;
  ticketsStarted?: number;
  lastError?: string | null;
};

export type StartMillBody = {
  topic: string;
  seedQuestions: string[];
  targetPapers: number;
  maxTickets: number;
};

export function getMillStatus(client: ApiClient): Promise<MillSnapshot> {
  return client.get<MillSnapshot>("/api/autoresearch/mill", withAuth(client));
}

export function startMill(client: ApiClient, body: StartMillBody): Promise<MillSnapshot> {
  return client.post<MillSnapshot>("/api/autoresearch/mill/start", body, withAuth(client));
}

export function stopMill(client: ApiClient): Promise<MillSnapshot> {
  return client.post<MillSnapshot>("/api/autoresearch/mill/stop", {}, withAuth(client));
}
