import { z } from "zod";

import {
  FIELD_PATTERN,
  ID_PATTERN,
  type CaseEvent,
  type RepresentativeCaseExport,
} from "./representative-case-types.ts";

export function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function unique(items: readonly string[]): string[] {
  return [...new Set(items)].sort();
}

const safeIdSchema = z.string().regex(ID_PATTERN);
const safeReasonCodeSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,100}$/);
export const nonNegativeIntSchema = z.number().int().min(0);

export function parseSafeId(value: unknown): string | null {
  const parsed = safeIdSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function parseNullableId(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return parseSafeId(value);
}

export function parseReasonCode(value: unknown, reasons: string[], reason: string): string | null {
  if (value === null || value === undefined) return null;
  const parsed = safeReasonCodeSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  reasons.push(reason);
  return null;
}

export function parseNullableNonNegativeInt(value: unknown, reasons: string[], reason: string): number | null {
  if (value === null || value === undefined) return null;
  const parsed = nonNegativeIntSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  reasons.push(reason);
  return null;
}

export function parseNullableInt(value: unknown, reasons: string[], reason: string): number | null {
  if (value === null || value === undefined) return null;
  const parsed = z.number().int().safeParse(value);
  if (parsed.success) return parsed.data;
  reasons.push(reason);
  return null;
}

export function parseChangedFieldsList(value: unknown, reasons: string[]): string[] {
  if (value === null || value === undefined || value === "") return [];
  if (typeof value !== "string") {
    reasons.push("changed_fields_unknown");
    return [];
  }
  const fields = value
    .split(",")
    .map((field) => field.trim())
    .filter(Boolean);
  const valid = fields.filter((field) => FIELD_PATTERN.test(field));
  if (valid.length !== fields.length) reasons.push("changed_fields_unknown");
  return [...new Set(valid)].sort();
}

export function readEvents(value: unknown, reasons: string[]): CaseEvent[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) {
    reasons.push("events_malformed");
    return [];
  }
  const events: CaseEvent[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.kind !== "string") {
      reasons.push("event_malformed");
      continue;
    }
    events.push({ kind: item.kind, payload: isRecord(item.payload) ? item.payload : {} });
  }
  return events;
}

export function lastEvent(events: readonly CaseEvent[], kind: string, round?: number): CaseEvent | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!;
    if (event.kind === kind && (round === undefined || event.payload.round === round)) return event;
  }
  return null;
}

export function readArtifacts(value: unknown, reasons: string[]): RepresentativeCaseExport["artifacts"] {
  const result: RepresentativeCaseExport["artifacts"] = {
    research: [],
    hypothesis: [],
    evidence_review: [],
    research_plan: [],
    review: [],
    unknown: [],
  };
  if (!Array.isArray(value)) {
    reasons.push("artifacts_unknown");
    return result;
  }
  for (const item of value) {
    if (!isRecord(item)) {
      reasons.push("malformed_artifact_metadata");
      continue;
    }
    const id = parseSafeId(item.id);
    const type = typeof item.type === "string" ? item.type : null;
    if (id === null || type === null) {
      reasons.push("malformed_artifact_metadata");
      continue;
    }
    const key = type === "evidence-review" ? "evidence_review" : type === "research-plan" ? "research_plan" : type;
    if (
      key === "research" ||
      key === "hypothesis" ||
      key === "evidence_review" ||
      key === "research_plan" ||
      key === "review"
    ) {
      result[key].push(id);
    } else {
      result.unknown.push(id);
    }
  }
  for (const key of ["research", "hypothesis", "evidence_review", "research_plan", "review"] as const) {
    result[key].sort();
  }
  result.unknown.sort();
  return result;
}
