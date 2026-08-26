import type { Snapshot } from "../../lib/types/wire";
import { Badge } from "./Badge";
import {
  buildTraceGroups,
  display,
  listDisplay,
  numberValue,
  runStatusLabel,
  statusLabel,
  type TraceGroup,
} from "./audit-trace";

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

function payload(event: Snapshot["recent_events"][number] | null, key: string) {
  if (event === null) return null;
  return event.payload[key] ?? null;
}

function stringValue(event: Snapshot["recent_events"][number] | null, key: string): string | null {
  const value = payload(event, key);
  return typeof value === "string" && value.trim() !== "" ? value : null;
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
        <span className="font-mono text-[11px] text-neutral-500">role {display(payload(started, "role"))}</span>
        <Badge variant={outcome === "failed" ? "destructive" : outcome === "completed" ? "default" : "secondary"}>
          {statusLabel(outcome)}
        </Badge>
        <span className="font-mono text-[11px] text-neutral-500">{group.traceId ?? "trace 未知"}</span>
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
        <h4 className="font-mono text-[11px] uppercase tracking-widest text-neutral-500">工具生命周期</h4>
        {group.tools.length === 0 ? (
          <p className="text-xs text-neutral-500">无工具调用事实</p>
        ) : (
          <ul className="space-y-1">
            {group.tools.map((call, index) => (
              <li
                key={`${call.ordinal ?? "unknown"}-${call.tool ?? "unknown"}-${index}`}
                className="flex flex-wrap gap-x-2 text-xs"
              >
                <span className="font-mono">{call.tool ?? "工具未知"}</span>
                <span className="font-mono text-[11px] text-neutral-500">#{call.ordinal ?? "?"}</span>
                <span className={call.status === "failed" ? "text-red-600" : "text-neutral-500"}>
                  {statusLabel(call.status)}
                </span>
                <span className="font-mono text-[11px] text-neutral-500">
                  {call.durationMs === null ? "时长未知" : `${call.durationMs} ms`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-neutral-500">
        <span>{usageLabel(group)}</span>
        <span>trace events {display(numberValue(ended, "trace_events"))}</span>
        <span>tool calls {display(numberValue(ended, "usage_tool_calls"))}</span>
      </div>

      {group.callbackErrors.length > 0 && (
        <div className="mt-3 space-y-1 text-xs text-red-600">
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
      <dt className="text-neutral-500">{label}</dt>
      <dd className={mono ? "break-all font-mono text-[11px]" : "break-words"}>{value}</dd>
    </div>
  );
}

function UsageLedger({ events }: { events: readonly Snapshot["recent_events"][number][] }) {
  if (events.length === 0) return null;
  return (
    <div className="space-y-1 rounded-lg border border-dashed p-3 text-xs">
      <h3 className="font-mono text-[11px] uppercase tracking-widest text-neutral-500">sdk.usage 记账</h3>
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
    <section className="space-y-2" aria-labelledby="audit-trace-title" data-testid="audit-trace">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="audit-trace-title" className="font-mono text-xs uppercase tracking-widest text-neutral-500">
          审计轨迹 · Audit / Trace
        </h2>
        <Badge variant={snapshot.status === "failed" ? "destructive" : "secondary"}>
          {runStatusLabel(snapshot.status)}
        </Badge>
      </div>
      {groups.length === 0 ? (
        <div className="rounded-lg border border-dashed p-3 text-xs text-neutral-500">暂无公开 trace · 状态未知</div>
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
