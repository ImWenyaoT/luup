import styled from "@emotion/styled";
import { useEffect, useState } from "react";
import { ROLE_LABEL } from "../../lib/types/constants";
import type { Snapshot } from "../../lib/types/wire";
import { colors, mono, SectionTitle } from "../../styles";

const STATUS_LABEL = { running: "进行中", completed: "已完成", failed: "失败" } as const;
const Section = styled.section`
  display: grid;
  gap: 9px;
`;
const Tree = styled.div`
  border-left: 2px solid ${colors.border};
  padding-left: 12px;
`;
const Control = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: baseline;
  font-size: 12px;
`;
const Id = styled.span`
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: ${colors.muted};
  font: 10px ${mono};
`;
const List = styled.ol`
  display: grid;
  gap: 6px;
  margin: 9px 0 0;
  padding: 0;
  list-style: none;
`;
const Item = styled.li`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
  border-left: 1px solid ${colors.border};
  padding-left: 10px;
  font-size: 12px;
`;
const Role = styled.span`
  font-weight: 600;
`;
const Meta = styled.span`
  margin-left: 7px;
  color: ${colors.muted};
  font: 10px ${mono};
`;
const Result = styled.div<{ failed: boolean }>`
  text-align: right;
  overflow-wrap: anywhere;
  color: ${({ failed }) => (failed ? colors.danger : colors.muted)};
`;

function duration(start: string, end: string | null, now: number): string {
  const elapsed = (end ? Date.parse(end) : now) - Date.parse(start);
  return Number.isFinite(elapsed) ? `${Math.max(0, Math.floor(elapsed / 1000))} 秒` : "未知";
}

export function SubagentLineage({ snapshot }: { snapshot: Snapshot }) {
  const [now, setNow] = useState(() => Date.now());
  const active = snapshot.subagents.some((item) => item.status === "running");
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return (
    <Section aria-labelledby="subagent-lineage-title" data-testid="subagent-lineage">
      <SectionTitle id="subagent-lineage-title">Subagents · {snapshot.subagents.length}</SectionTitle>
      <Tree>
        <Control>
          <Role>控制面</Role>
          <Id>{snapshot.id}</Id>
        </Control>
        <List>
          {snapshot.subagents.map((subagent) => (
            <Item key={subagent.id}>
              <div>
                <Role>{ROLE_LABEL[subagent.role]}</Role>
                <Meta>
                  {subagent.role} #{subagent.ordinal}
                </Meta>
                <Id title={subagent.id}>
                  {subagent.id} · {subagent.mode}
                </Id>
              </div>
              <Result failed={subagent.status === "failed" && subagent.stop_reason !== "interrupted"}>
                <div>{subagent.stop_reason === "interrupted" ? "已停止" : STATUS_LABEL[subagent.status]}</div>
                <div>耗时 {duration(subagent.started_at, subagent.finished_at, now)}</div>
                <div>
                  {subagent.tool_calls == null ? "工具调用次数未知" : `已观测 ${subagent.tool_calls} 次工具调用`}
                </div>
                {(subagent.recent_activity ?? []).map((activity, index) => (
                  <div key={`${activity.created_at}:${index}`}>
                    <time dateTime={activity.created_at}>{activity.created_at.slice(11, 19)}</time> · {activity.tool} ·{" "}
                    {{ started: "开始", completed: "完成", unknown: "状态未知" }[activity.status]}
                  </div>
                ))}
                {subagent.stop_reason !== null && subagent.stop_reason !== "interrupted" && (
                  <Meta>{subagent.stop_reason}</Meta>
                )}
              </Result>
            </Item>
          ))}
        </List>
      </Tree>
    </Section>
  );
}
