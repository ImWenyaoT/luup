import styled from "@emotion/styled";
import type { Snapshot } from "../../lib/types/wire";
import { colors, mono } from "../../styles";
import { RunStatusBadge } from "../workspace/RunStatusBadge";
const Header = styled.header`
  min-height: 72px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  padding: 0;
  background: transparent;
  @media (max-width: 700px) {
    padding: 10px 12px;
  }
`;
const Question = styled.span`
  min-width: 180px;
  flex: 1;
  font-size: 24px;
  line-height: 1.2;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;
const Details = styled.details`
  font-size: 11px;
  color: ${colors.muted};
  summary {
    cursor: pointer;
    font-weight: 600;
  }
`;
const Facts = styled.div`
  position: absolute;
  right: 16px;
  z-index: 20;
  margin-top: 8px;
  padding: 10px;
  border: 1px solid ${colors.border};
  border-radius: 9px;
  background: white;
  box-shadow: 0 12px 30px rgba(16, 24, 40, 0.12);
  font-family: ${mono};
`;
export function RunHeader({ snapshot, sseConnected }: { snapshot: Snapshot; sseConnected?: boolean }) {
  return (
    <Header data-testid="run-header">
      <span data-testid="run-status-badge">
        <RunStatusBadge status={snapshot.status} />
      </span>
      {snapshot.error_code !== null && (
        <span style={{ fontFamily: mono, fontSize: 11, color: colors.danger }}>{snapshot.error_code}</span>
      )}
      <Question title={snapshot.question}>{snapshot.question}</Question>
      {sseConnected && <span style={{ fontSize: 10, color: colors.success }}>SSE</span>}
      <Details>
        <summary>技术详情</summary>
        <Facts>
          <div>run_id: {snapshot.id}</div>
          <div>version: {snapshot.version}</div>
        </Facts>
      </Details>
    </Header>
  );
}
