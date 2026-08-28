import styled from "@emotion/styled";
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
  color: ${({ failed }) => (failed ? colors.danger : colors.muted)};
`;

export function SubagentLineage({ snapshot }: { snapshot: Snapshot }) {
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
              <Result failed={subagent.status === "failed"}>
                <div>{STATUS_LABEL[subagent.status]}</div>
                {subagent.stop_reason !== null && <Meta>{subagent.stop_reason}</Meta>}
              </Result>
            </Item>
          ))}
        </List>
      </Tree>
    </Section>
  );
}
