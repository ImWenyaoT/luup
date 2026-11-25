import type { ResearchRole } from "../domain.ts";
import { newId, nowIso } from "../domain.ts";
import type { SessionEvent, SessionRecord } from "./events.ts";

/** Append-only Session log。崩溃续跑（dsh repair）本里程碑不做；只保证记账可闭合。 */
export class SessionLog {
  readonly record: SessionRecord;

  constructor(role: ResearchRole, options: { parentSessionId?: string | null; id?: string; clock?: () => Date } = {}) {
    const clock = options.clock ?? (() => new Date());
    this.record = {
      id: options.id ?? newId(`sess_${role}`),
      role,
      parentSessionId: options.parentSessionId ?? null,
      events: [],
      createdAt: nowIso(clock),
    };
  }

  append(event: SessionEvent): void {
    this.record.events.push(event);
  }

  snapshot(): SessionRecord {
    return {
      ...this.record,
      events: [...this.record.events],
    };
  }
}
