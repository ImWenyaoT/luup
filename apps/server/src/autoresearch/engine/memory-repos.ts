import type { ResearchTicket } from "../domain.ts";
import type { SessionLog } from "../session/log.ts";
import type { ResearchRepositories } from "./ports.ts";

/** 进程内仓储：第一刀；后续可换 SQLite 而不改 Engine。 */
export function createMemoryRepos(): ResearchRepositories {
  const tickets = new Map<string, ResearchTicket>();
  const sessions = new Map<string, SessionLog>();
  return {
    saveTicket(ticket) {
      tickets.set(ticket.id, structuredClone(ticket));
    },
    getTicket(id) {
      const ticket = tickets.get(id);
      return ticket ? structuredClone(ticket) : null;
    },
    saveSession(session) {
      sessions.set(session.record.id, session);
    },
    getSession(id) {
      return sessions.get(id) ?? null;
    },
  };
}
