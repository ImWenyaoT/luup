import { ROLE_ORDER } from "../../lib/types/constants";
import type { Attempt, Evidence, Role, Snapshot } from "../../lib/types/wire";

/** 双阈值截断：先粗切压空白，再截到预览长度；详情（title 属性）永远给全量。 */
export function preview(text: string, limit = 240): string {
  const collapsed = text.slice(0, 2048).replace(/\s+/g, " ").trim();
  return collapsed.length <= limit ? collapsed : `${collapsed.slice(0, limit)}…`;
}

export type TrajectorySegment = {
  role: Role;
  attempts: Attempt[];
  evidence: Evidence[];
};

export function buildSegments(snapshot: Snapshot): TrajectorySegment[] {
  return ROLE_ORDER.map((role) => {
    const attempts = snapshot.attempts.filter((item) => item.role === role);
    const ids = new Set(attempts.map((item) => item.id));
    return {
      role,
      attempts,
      evidence: snapshot.tool_evidence.filter((item) => ids.has(item.attempt_id)),
    };
  });
}

function attemptSeconds(attempt: Attempt): number | null {
  if (attempt.finished_at === null) return null;
  const ms = Date.parse(attempt.finished_at) - Date.parse(attempt.started_at);
  return Number.isFinite(ms) && ms >= 0 ? ms / 1000 : null;
}

export function segmentDuration(attempts: Attempt[]): string | null {
  if (attempts.length === 0) return null;
  let total = 0;
  for (const attempt of attempts) {
    const value = attemptSeconds(attempt);
    if (value === null) return null;
    total += value;
  }
  return `${total.toFixed(1)}s`;
}

export const EVIDENCE_FAILURE: ReadonlySet<string> = new Set([
  "failed",
  "timeout",
  "rate_limited",
  "source_unavailable",
  "refused",
]);

export type RailTone = "failed" | "running" | "completed" | "pending";
export function railTone(segment: TrajectorySegment, currentRole: Role | null): RailTone {
  const last = segment.attempts.at(-1);
  if (last?.status === "failed") return "failed";
  if (last?.status === "running" || segment.role === currentRole) return "running";
  if (last?.status === "completed") return "completed";
  return "pending";
}
