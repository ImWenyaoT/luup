import type { RunEvent } from "../types/wire";
import { RUN_EVENT_KINDS } from "./events";

const KNOWN_KINDS = new Set<string>(RUN_EVENT_KINDS);

export function parseSseMessage(data: string, kind?: string): RunEvent | null {
  if (kind && !KNOWN_KINDS.has(kind)) return null;
  try {
    const parsed = JSON.parse(data) as RunEvent;
    if (typeof parsed !== "object" || parsed === null) return null;
    if (typeof parsed.id !== "number" || typeof parsed.version !== "number") return null;
    if (typeof parsed.kind !== "string" || typeof parsed.created_at !== "string") return null;
    if (typeof parsed.payload !== "object" || parsed.payload === null || Array.isArray(parsed.payload)) return null;
    return parsed;
  } catch {
    return null;
  }
}
