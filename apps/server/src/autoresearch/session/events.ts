/** Session 事件词汇（形制学 dsh：durable facts；模型可见 ⇒ 必须入日志）。 */

import type { CritiqueResult, EvidenceHit } from "../types.ts";
import type { ResearchRole } from "../domain.ts";

export type SessionEvent =
  | { type: "turn/start"; turnId: string; at: string }
  | { type: "turn/end"; turnId: string; at: string }
  | { type: "system/message"; text: string; at: string }
  | { type: "user/message"; text: string; at: string }
  | { type: "assistant/message"; text: string; at: string }
  | {
      type: "tool/call";
      callId: string;
      name: string;
      input: unknown;
      at: string;
    }
  | {
      type: "tool/result";
      callId: string;
      name: string;
      output: unknown;
      at: string;
    }
  | {
      type: "worker/report";
      role: Exclude<ResearchRole, "main">;
      summary: string;
      evidence: EvidenceHit[];
      critique: CritiqueResult | null;
      at: string;
    }
  | {
      type: "decision";
      outcome: string;
      reason: string;
      at: string;
    };

export type SessionRecord = {
  id: string;
  role: ResearchRole;
  parentSessionId: string | null;
  events: SessionEvent[];
  createdAt: string;
};
