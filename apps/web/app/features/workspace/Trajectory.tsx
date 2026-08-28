import styled from "@emotion/styled";
import { useState } from "react";
import { ROLE_LABEL } from "../../lib/types/constants";
import type { Evidence, Role, Snapshot } from "../../lib/types/wire";
import { Button, colors, mono, SectionTitle } from "../../styles";
import { buildSegments, EVIDENCE_FAILURE, preview, railTone, segmentDuration, type RailTone } from "./trajectoryUtils";

const Section = styled.section`
  display: grid;
  gap: 9px;
`;
const Heading = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
`;
const List = styled.ol`
  display: grid;
  gap: 5px;
  margin: 0;
  padding: 0;
  list-style: none;
`;
const Segment = styled.li<{ tone: RailTone; pending: boolean }>`
  border-left: 2px solid
    ${({ tone }) => (tone === "failed" ? colors.danger : tone === "running" ? colors.accent : tone === "completed" ? colors.faint : "transparent")};
  padding-left: 10px;
  opacity: ${({ pending }) => (pending ? 0.55 : 1)};
`;
const SegmentButton = styled.button`
  display: flex;
  min-height: 40px;
  width: 100%;
  flex-wrap: wrap;
  align-items: center;
  gap: 3px 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  padding: 3px;
  text-align: left;
  &:hover:not(:disabled) {
    background: #f2f4f7;
  }
`;
const RoleName = styled.span`
  font-size: 12px;
  font-weight: 600;
`;
const Meta = styled.span`
  color: ${colors.muted};
  font: 10px ${mono};
`;
const Failure = styled(Meta)`
  color: ${colors.danger};
`;
const Duration = styled(Meta)`
  margin-left: auto;
  font-variant-numeric: tabular-nums;
`;
const Summary = styled.div`
  padding: 0 0 4px 3px;
  color: ${colors.muted};
  font-size: 10px;
`;
const EvidenceList = styled.div`
  display: grid;
  gap: 5px;
  padding: 0 0 4px 3px;
`;
const EvidenceGrid = styled.div`
  display: grid;
  min-height: 38px;
  grid-template-columns: minmax(100px, 0.38fr) auto minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  font-size: 11px;
`;
const Truncate = styled.span`
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;
const Citations = styled.div`
  display: grid;
  gap: 2px;
  border-left: 1px solid ${colors.border};
  padding-left: 10px;
  font-size: 11px;
  a {
    color: ${colors.accent};
    text-decoration: underline;
    text-underline-offset: 2px;
  }
`;

export function Trajectory({ snapshot }: { snapshot: Snapshot }) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<Role>>(new Set());
  const segments = buildSegments(snapshot);
  const allCollapsed = segments.every((s) => collapsed.has(s.role));
  const toggle = (role: Role) =>
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(role)) next.delete(role);
      else next.add(role);
      return next;
    });
  return (
    <Section data-testid="trajectory">
      <Heading>
        <SectionTitle>执行轨迹 · {snapshot.tool_evidence.length} 次检索</SectionTitle>
        <Button compact onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(segments.map((s) => s.role)))}>
          {allCollapsed ? "全部展开" : "全部折叠"}
        </Button>
      </Heading>
      <List>
        {segments.map((segment) => (
          <SegmentRow
            key={segment.role}
            segment={segment}
            currentRole={snapshot.current_role}
            collapsed={collapsed.has(segment.role)}
            onToggle={() => toggle(segment.role)}
          />
        ))}
      </List>
    </Section>
  );
}

function SegmentRow({
  segment,
  currentRole,
  collapsed,
  onToggle,
}: {
  segment: ReturnType<typeof buildSegments>[number];
  currentRole: Role | null;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const { role, attempts, evidence } = segment;
  const last = attempts.at(-1);
  const corrections = attempts.reduce((sum, item) => sum + item.corrections, 0);
  const citations = evidence.reduce((sum, item) => sum + item.output.citations.length, 0);
  const duration = segmentDuration(attempts);
  const pending = !attempts.length;
  const running = last?.status === "running";
  return (
    <Segment tone={railTone(segment, currentRole)} pending={pending}>
      <SegmentButton onClick={onToggle} aria-expanded={!collapsed} disabled={pending}>
        <RoleName>{ROLE_LABEL[role]}</RoleName>
        <Meta>{role}</Meta>
        {pending && <Meta>待执行</Meta>}
        {attempts.length > 1 && <Meta>×{attempts.length}</Meta>}
        {corrections > 0 && <Meta title={`${corrections} 次纠错`}>↻{corrections}</Meta>}
        {last?.failure_code != null && <Failure>{last.failure_code}</Failure>}
        <Duration>{running ? "进行中" : (duration ?? "")}</Duration>
      </SegmentButton>
      {!pending && collapsed && (
        <Summary>
          … {evidence.length ? `${evidence.length} 次检索 · ${citations} 条引用` : `${attempts.length} 次尝试`}
          {corrections > 0 && ` · ↻${corrections} 纠错`}
        </Summary>
      )}
      {!pending && !collapsed && evidence.length > 0 && (
        <EvidenceList>
          {evidence.map((item) => (
            <EvidenceRow key={item.id} evidence={item} />
          ))}
        </EvidenceList>
      )}
    </Segment>
  );
}

function EvidenceRow({ evidence }: { evidence: Evidence }) {
  const failed = EVIDENCE_FAILURE.has(evidence.status);
  const summary = evidence.output.result_summary;
  const full = `${evidence.tool_name} ${evidence.query} → ${failed ? evidence.status : (summary ?? "无输出")}`;
  return (
    <div>
      <EvidenceGrid title={full}>
        <Truncate>
          <span style={{ fontFamily: mono }}>{evidence.tool_name}</span>{" "}
          <span style={{ color: colors.muted }}>{evidence.query}</span>
        </Truncate>
        <Meta>→</Meta>
        {failed ? (
          <Failure>{evidence.status}</Failure>
        ) : summary ? (
          <Truncate style={{ color: colors.muted }}>
            {evidence.status === "partial" && <Meta>partial · </Meta>}
            {preview(summary)}
          </Truncate>
        ) : (
          <Meta>{evidence.status === "empty" ? "空结果" : "无输出"}</Meta>
        )}
      </EvidenceGrid>
      {evidence.output.citations.length > 0 && (
        <Citations>
          {evidence.output.citations.map((c) => (
            <div key={c.locator}>
              <Meta>{c.locator}</Meta>
              {" · "}
              {c.url === null ? (
                c.title
              ) : (
                <a href={c.url} target="_blank" rel="noreferrer">
                  {c.title}
                </a>
              )}
            </div>
          ))}
        </Citations>
      )}
    </div>
  );
}
