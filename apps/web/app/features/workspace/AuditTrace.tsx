import styled from "@emotion/styled";
import type { Snapshot } from "../../lib/types/wire";
import { colors, mono, SectionTitle } from "../../styles";
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

const Section = styled.section`
  display: grid;
  gap: 9px;
`;
const Heading = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
`;
const Card = styled.details`
  border: 1px solid ${colors.border};
  border-radius: 10px;
  background: white;
  padding: 12px;
`;
const Summary = styled.summary`
  display: flex;
  cursor: pointer;
  list-style: none;
  flex-wrap: wrap;
  align-items: center;
  gap: 7px;
  font-size: 11px;
`;
const Grid = styled.div`
  display: grid;
  gap: 12px;
  margin-top: 12px;
  font-size: 11px;
  @media (min-width: 620px) {
    grid-template-columns: 1fr 1fr;
  }
`;
const Facts = styled.dl`
  display: grid;
  gap: 4px;
  margin: 0;
`;
const FactRow = styled.div`
  display: grid;
  grid-template-columns: 82px minmax(0, 1fr);
  gap: 7px;
`;
const Term = styled.dt`
  color: ${colors.muted};
`;
const Value = styled.dd<{ technical?: boolean }>`
  margin: 0;
  overflow-wrap: anywhere;
  ${({ technical }) => (technical ? `font:10px ${mono};` : "")}
`;
const Block = styled.div`
  display: grid;
  gap: 5px;
  margin-top: 12px;
`;
const ToolList = styled.ul`
  display: grid;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
`;
const Tool = styled.li`
  display: flex;
  flex-wrap: wrap;
  gap: 5px 9px;
  font-size: 11px;
`;
const Meta = styled.span`
  color: ${colors.muted};
  font: 10px ${mono};
`;
const Ledger = styled.div`
  display: grid;
  gap: 5px;
  border: 1px dashed ${colors.border};
  border-radius: 10px;
  padding: 11px;
  font-size: 11px;
`;
const Empty = styled.div`
  border: 1px dashed ${colors.border};
  border-radius: 10px;
  padding: 11px;
  color: ${colors.muted};
  font-size: 11px;
`;

function payload(event: Snapshot["recent_events"][number] | null, key: string) {
  return event?.payload[key] ?? null;
}
function stringValue(event: Snapshot["recent_events"][number] | null, key: string) {
  const value = payload(event, key);
  return typeof value === "string" && value.trim() ? value : null;
}
function usageLabel(group: TraceGroup) {
  const ended = group.ended;
  if (!ended) return "用量未知";
  const input = numberValue(ended, "usage_input_tokens"),
    output = numberValue(ended, "usage_output_tokens"),
    total = numberValue(ended, "usage_total_tokens");
  return input === null && output === null && total === null
    ? "用量未知"
    : `input ${display(input)} · output ${display(output)} · total ${display(total)}`;
}
function attemptLabel(traceId: string | null) {
  if (traceId === null) return "attempt 未知";
  const separator = traceId.lastIndexOf(":");
  return `attempt ${separator > 0 ? traceId.slice(0, separator) : traceId}`;
}
function Fact({ label, value, technical = false }: { label: string; value: string; technical?: boolean }) {
  return (
    <FactRow>
      <Term>{label}</Term>
      <Value technical={technical}>{value}</Value>
    </FactRow>
  );
}
function TraceCard({ group }: { group: TraceGroup }) {
  const { started, ended } = group;
  const agent = stringValue(started, "agent"),
    model = stringValue(started, "model"),
    outcome = stringValue(ended, "outcome"),
    inputFields = listDisplay(payload(started, "input_fields")),
    inputEncoding = display(payload(started, "input_encoding")),
    inputChars = numberValue(started, "input_chars"),
    inputHash = stringValue(started, "input_sha256"),
    hashPreview = inputHash === null ? "未知" : `${inputHash.slice(0, 12)}…`;
  return (
    <Card open>
      <Summary>
        <strong>{attemptLabel(group.traceId)}</strong>
        <Meta>role {display(payload(started, "role"))}</Meta>
        <Badge variant={outcome === "failed" ? "destructive" : outcome === "completed" ? "default" : "secondary"}>
          {statusLabel(outcome)}
        </Badge>
        <Meta>{group.traceId ?? "trace 未知"}</Meta>
      </Summary>
      <Grid>
        <Facts>
          <Fact label="Agent / 模型" value={`${display(agent)} / ${display(model)}`} />
          <Fact label="任务摘要" value={display(payload(started, "task"))} />
          <Fact label="结构化约束" value={display(payload(started, "structured_constraint"))} />
          <Fact label="可用工具" value={listDisplay(payload(started, "available_tools"))} />
        </Facts>
        <Facts>
          <Fact
            label="输入上下文"
            value={`${inputEncoding} · ${inputChars === null ? "未知" : `${inputChars} chars`}`}
          />
          <Fact label="输入字段" value={inputFields} />
          <Fact label="输入摘要 hash" value={hashPreview} technical />
          <Fact label="停止原因" value={display(payload(ended, "stop_reason"))} technical />
        </Facts>
      </Grid>
      <Block>
        <SectionTitle>工具生命周期</SectionTitle>
        {group.tools.length === 0 ? (
          <Meta>无工具调用事实</Meta>
        ) : (
          <ToolList>
            {group.tools.map((call, index) => (
              <Tool key={`${call.ordinal ?? "unknown"}-${call.tool ?? "unknown"}-${index}`}>
                <span style={{ fontFamily: mono }}>{call.tool ?? "工具未知"}</span>
                <Meta>#{call.ordinal ?? "?"}</Meta>
                <span style={{ color: call.status === "failed" ? colors.danger : colors.muted }}>
                  {statusLabel(call.status)}
                </span>
                <Meta>{call.durationMs === null ? "时长未知" : `${call.durationMs} ms`}</Meta>
              </Tool>
            ))}
          </ToolList>
        )}
      </Block>
      <Tool style={{ marginTop: 12 }}>
        <Meta>{usageLabel(group)}</Meta>
        <Meta>trace events {display(numberValue(ended, "trace_events"))}</Meta>
        <Meta>tool calls {display(numberValue(ended, "usage_tool_calls"))}</Meta>
      </Tool>
      {group.callbackErrors.length > 0 && (
        <Block style={{ color: colors.danger }}>
          <SectionTitle>旁路失败</SectionTitle>
          {group.callbackErrors.map((event) => (
            <div key={event.id}>
              {display(payload(event, "callback"))} · {display(payload(event, "error_type"))}
            </div>
          ))}
        </Block>
      )}
    </Card>
  );
}
function UsageLedger({ events }: { events: readonly Snapshot["recent_events"][number][] }) {
  if (!events.length) return null;
  return (
    <Ledger>
      <SectionTitle>sdk.usage 记账</SectionTitle>
      {events.map((event) => (
        <Tool key={event.id}>
          <span>{display(payload(event, "agent"))}</span>
          <Meta>input {display(payload(event, "input_tokens"))}</Meta>
          <Meta>output {display(payload(event, "output_tokens"))}</Meta>
          <Meta>total {display(payload(event, "total_tokens"))}</Meta>
        </Tool>
      ))}
    </Ledger>
  );
}
export function AuditTrace({ snapshot }: { snapshot: Snapshot }) {
  const groups = buildTraceGroups(snapshot.recent_events);
  const usageEvents = snapshot.recent_events.filter((e) => e.kind === "sdk.usage");
  return (
    <Section aria-labelledby="audit-trace-title" data-testid="audit-trace">
      <Heading>
        <SectionTitle id="audit-trace-title">审计轨迹 · Audit / Trace</SectionTitle>
        <Badge variant={snapshot.status === "failed" ? "destructive" : "secondary"}>
          {runStatusLabel(snapshot.status)}
        </Badge>
      </Heading>
      {groups.length === 0 ? (
        <Empty>暂无公开 trace · 状态未知</Empty>
      ) : (
        groups.map((group) => <TraceCard key={group.key} group={group} />)
      )}
      <UsageLedger events={usageEvents} />
    </Section>
  );
}
