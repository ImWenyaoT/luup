import { Badge } from "@/components/ui/badge";
import type { Snapshot } from "./types";

type PublicEvent = Snapshot["recent_events"][number];
type Scalar = string | number | boolean | null;

type ToolCall = {
  agent: string | null;
  tool: string | null;
  ordinal: number | null;
  status: string | null;
  durationMs: number | null;
  ended: boolean;
};

type TraceGroup = {
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

function numberValue(event: PublicEvent | null, key: string): number | null {
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
  return { key: eventKey(event), traceId: traceIdOf(event), started: null, ended: null, tools: [], callbackErrors: [] };
}

function buildTraceGroups(events: readonly PublicEvent[]): TraceGroup[] {
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

function display(value: Scalar): string {
  return value === null || value === "" ? "未知" : String(value);
}

function listDisplay(value: Scalar): string {
  if (value === null) return "未知";
  if (value === "") return "无";
  return String(value);
}

function statusLabel(status: string | null): string {
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

function runStatusLabel(status: Snapshot["status"]): string {
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

function usageLabel(group: TraceGroup): string {
  const ended = group.ended;
  if (ended === null) return "用量未知";
  const input = numberValue(ended, "usage_input_tokens");
  const output = numberValue(ended, "usage_output_tokens");
  const total = numberValue(ended, "usage_total_tokens");
  if (input === null && output === null && total === null) return "用量未知";
  return `input ${display(input)} · output ${display(output)} · total ${display(total)}`;
}

function attemptLabel(traceId: string | null): string {
  if (traceId === null) return "attempt 未知";
  const separator = traceId.lastIndexOf(":");
  return `attempt ${separator > 0 ? traceId.slice(0, separator) : traceId}`;
}

function TraceCard({ group }: { group: TraceGroup }) {
  const started = group.started;
  const ended = group.ended;
  const agent = stringValue(started, "agent");
  const model = stringValue(started, "model");
  const outcome = stringValue(ended, "outcome");
  const inputFields = listDisplay(payload(started, "input_fields"));
  const inputEncoding = display(payload(started, "input_encoding"));
  const inputChars = numberValue(started, "input_chars");
  const inputHash = stringValue(started, "input_sha256");
  const hashPreview = inputHash === null ? "未知" : `${inputHash.slice(0, 12)}…`;

  return (
    <details open className="rounded-lg border p-3">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 text-xs">
        <span className="font-medium">{attemptLabel(group.traceId)}</span>
        <span className="font-mono text-[11px] text-muted-foreground">role {display(payload(started, "role"))}</span>
        <Badge variant={outcome === "failed" ? "destructive" : outcome === "completed" ? "default" : "secondary"}>
          {statusLabel(outcome)}
        </Badge>
        <span className="font-mono text-[11px] text-muted-foreground">{group.traceId ?? "trace 未知"}</span>
      </summary>

      <div className="mt-3 grid gap-3 text-xs md:grid-cols-2">
        <dl className="space-y-1">
          <Fact label="Agent / 模型" value={`${display(agent)} / ${display(model)}`} />
          <Fact label="任务摘要" value={display(payload(started, "task"))} />
          <Fact label="结构化约束" value={display(payload(started, "structured_constraint"))} />
          <Fact label="可用工具" value={listDisplay(payload(started, "available_tools"))} />
        </dl>
        <dl className="space-y-1">
          <Fact
            label="输入上下文"
            value={`${inputEncoding} · ${inputChars === null ? "未知" : `${inputChars} chars`}`}
          />
          <Fact label="输入字段" value={inputFields} />
          <Fact label="输入摘要 hash" value={hashPreview} mono />
          <Fact label="停止原因" value={display(payload(ended, "stop_reason"))} mono />
        </dl>
      </div>

      <div className="mt-3 space-y-1">
        <h4 className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">工具生命周期</h4>
        {group.tools.length === 0 ? (
          <p className="text-xs text-muted-foreground">无工具调用事实</p>
        ) : (
          <ul className="space-y-1">
            {group.tools.map((call, index) => (
              <li
                key={`${call.ordinal ?? "unknown"}-${call.tool ?? "unknown"}-${index}`}
                className="flex flex-wrap gap-x-2 text-xs"
              >
                <span className="font-mono">{call.tool ?? "工具未知"}</span>
                <span className="font-mono text-muted-foreground">#{call.ordinal ?? "?"}</span>
                <span className={call.status === "failed" ? "text-destructive" : "text-muted-foreground"}>
                  {statusLabel(call.status)}
                </span>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {call.durationMs === null ? "时长未知" : `${call.durationMs} ms`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-muted-foreground">
        <span>{usageLabel(group)}</span>
        <span>trace events {display(numberValue(ended, "trace_events"))}</span>
        <span>tool calls {display(numberValue(ended, "usage_tool_calls"))}</span>
      </div>

      {group.callbackErrors.length > 0 && (
        <div className="mt-3 space-y-1 text-xs text-destructive">
          <h4 className="font-mono text-[11px] uppercase tracking-widest">旁路失败</h4>
          {group.callbackErrors.map((event) => (
            <div key={event.id}>
              {display(payload(event, "callback"))} · {display(payload(event, "error_type"))}
            </div>
          ))}
        </div>
      )}
    </details>
  );
}

function Fact({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={mono ? "break-all font-mono text-[11px]" : "break-words"}>{value}</dd>
    </div>
  );
}

function UsageLedger({ events }: { events: readonly PublicEvent[] }) {
  if (events.length === 0) return null;
  return (
    <div className="space-y-1 rounded-lg border border-dashed p-3 text-xs">
      <h3 className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">sdk.usage 记账</h3>
      {events.map((event) => (
        <div key={event.id} className="flex flex-wrap gap-x-3 font-mono text-[11px]">
          <span>{display(payload(event, "agent"))}</span>
          <span>input {display(payload(event, "input_tokens"))}</span>
          <span>output {display(payload(event, "output_tokens"))}</span>
          <span>total {display(payload(event, "total_tokens"))}</span>
        </div>
      ))}
    </div>
  );
}

export function AuditTrace({ snapshot }: { snapshot: Snapshot }) {
  const groups = buildTraceGroups(snapshot.recent_events);
  const usageEvents = snapshot.recent_events.filter((event) => event.kind === "sdk.usage");

  return (
    <section className="space-y-2" aria-labelledby="audit-trace-title">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="audit-trace-title" className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          审计轨迹 · Audit / Trace
        </h2>
        <Badge variant={snapshot.status === "failed" ? "destructive" : "secondary"}>
          {runStatusLabel(snapshot.status)}
        </Badge>
      </div>
      {groups.length === 0 ? (
        <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
          暂无公开 trace · 状态未知
        </div>
      ) : (
        <div className="space-y-2">
          {groups.map((group) => (
            <TraceCard key={group.key} group={group} />
          ))}
        </div>
      )}
      <UsageLedger events={usageEvents} />
    </section>
  );
}
