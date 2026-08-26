import type { Snapshot } from "../../lib/types/wire";

type PublicEvent = Snapshot["recent_events"][number];
type Scalar = string | number | boolean | null;

export type ToolCall = {
  agent: string | null;
  tool: string | null;
  ordinal: number | null;
  status: string | null;
  durationMs: number | null;
  ended: boolean;
};

export type TraceGroup = {
  key: string;
  traceId: string | null;
  started: PublicEvent | null;
  ended: PublicEvent | null;
  tools: ToolCall[];
  callbackErrors: PublicEvent[];
};

const TRACE_EVENT_KINDS = new Set([
  "sdk.trace.started",
  "sdk.trace.tool_started",
  "sdk.trace.tool_ended",
  "sdk.trace.ended",
  "sdk.trace.callback_error",
]);

function payload(event: PublicEvent | null, key: string): Scalar {
  if (event === null) return null;
  return event.payload[key] ?? null;
}

function stringValue(event: PublicEvent | null, key: string): string | null {
  const value = payload(event, key);
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

export function numberValue(event: PublicEvent | null, key: string): number | null {
  const value = payload(event, key);
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function traceIdOf(event: PublicEvent): string | null {
  return stringValue(event, "trace_id");
}

function eventKey(event: PublicEvent): string {
  return traceIdOf(event) ?? `unknown:${event.id}`;
}

function newGroup(event: PublicEvent): TraceGroup {
  return {
    key: eventKey(event),
    traceId: traceIdOf(event),
    started: null,
    ended: null,
    tools: [],
    callbackErrors: [],
  };
}

export function buildTraceGroups(events: readonly PublicEvent[]): TraceGroup[] {
  const groups = new Map<string, TraceGroup>();
  for (const event of events) {
    if (!TRACE_EVENT_KINDS.has(event.kind)) continue;
    const key = eventKey(event);
    const group = groups.get(key) ?? newGroup(event);
    const traceId = traceIdOf(event);
    if (group.traceId === null && traceId !== null) group.traceId = traceId;

    if (event.kind === "sdk.trace.started") group.started = event;
    else if (event.kind === "sdk.trace.ended") group.ended = event;
    else if (event.kind === "sdk.trace.callback_error") group.callbackErrors.push(event);
    else if (event.kind === "sdk.trace.tool_started") {
      group.tools.push({
        agent: stringValue(event, "agent"),
        tool: stringValue(event, "tool"),
        ordinal: numberValue(event, "ordinal"),
        status: null,
        durationMs: null,
        ended: false,
      });
    } else if (event.kind === "sdk.trace.tool_ended") {
      const ordinal = numberValue(event, "ordinal");
      const tool = stringValue(event, "tool");
      const open = group.tools.find(
        (call) => !call.ended && call.ordinal === ordinal && (tool === null || call.tool === tool),
      );
      if (open) {
        open.status = stringValue(event, "status");
        open.durationMs = numberValue(event, "duration_ms");
        open.ended = true;
      } else {
        group.tools.push({
          agent: stringValue(event, "agent"),
          tool,
          ordinal,
          status: stringValue(event, "status"),
          durationMs: numberValue(event, "duration_ms"),
          ended: true,
        });
      }
    }
    groups.set(key, group);
  }
  return [...groups.values()].sort((left, right) => {
    const leftId = left.started?.id ?? left.ended?.id ?? Number.MAX_SAFE_INTEGER;
    const rightId = right.started?.id ?? right.ended?.id ?? Number.MAX_SAFE_INTEGER;
    return leftId - rightId;
  });
}

export function display(value: Scalar): string {
  return value === null || value === "" ? "未知" : String(value);
}

export function listDisplay(value: Scalar): string {
  if (value === null) return "未知";
  if (value === "") return "无";
  return String(value);
}

export function statusLabel(status: string | null): string {
  switch (status) {
    case "completed":
      return "已完成 / completed";
    case "failed":
      return "失败 / failed";
    case "unknown":
      return "未知 / unknown";
    case null:
      return "未知";
    default:
      return "未知";
  }
}

export function runStatusLabel(status: Snapshot["status"]): string {
  switch (status) {
    case "running":
      return "进行中";
    case "completed":
      return "已完成";
    case "review_rejected":
      return "评审拒绝";
    case "failed":
      return "失败";
    default:
      return "未知";
  }
}
