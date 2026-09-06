import styled from "@emotion/styled";
import { ROLE_LABEL, ROLE_ORDER } from "../../lib/types/constants";
import type { InspectorKind } from "../../lib/types/inspector";
import type { Artifact, Snapshot } from "../../lib/types/wire";
import { Button, colors, mono, Surface } from "../../styles";
import { ArtifactPanel } from "./ArtifactPanel";
import { AuditTrace } from "./AuditTrace";
import { FeedbackComposer } from "./FeedbackComposer";
import { FeedbackHistory } from "./FeedbackHistory";
import { SubagentLineage } from "./SubagentLineage";
import { RunControls } from "./RunControls";
import { Trajectory } from "./Trajectory";
import { getReferenceVerification, referenceVerificationLabel } from "./audit-trace";

export type RunWorkspaceProps = {
  snapshot: Snapshot;
  onRefetch: () => void;
  selectedArtifactId: string | null;
  onSelectArtifact: (id: string | null) => void;
  artifact: Artifact | null;
  artifactLoading: boolean;
  onInspectorChange?: (value: InspectorKind) => void;
};
const Canvas = styled.div`
  display: grid;
  gap: 16px;
`;
const Rail = styled.ol`
  min-height: 48px;
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 8px;
  margin: 0;
  padding: 8px 16px;
  border: 1px solid ${colors.border};
  border-radius: 8px;
  background: ${colors.surface};
  list-style: none;
  @media (max-width: 650px) {
    grid-template-columns: 1fr;
    gap: 4px;
  }
`;
const Step = styled.li<{ state: "done" | "active" | "pending" | "failed" }>`
  position: relative;
  text-align: center;
  color: ${({ state }) => (state === "pending" ? colors.faint : state === "failed" ? colors.danger : colors.ink)};
  font-size: 12px;
  &:not(:last-child)::after {
    content: "";
    position: absolute;
    left: 66%;
    right: -38%;
    top: 8px;
    height: 1px;
    background: ${({ state }) => (state === "done" ? colors.success : colors.border)};
  }
  @media (max-width: 650px) {
    display: grid;
    grid-template-columns: 24px 1fr;
    text-align: left;
    align-items: center;
    &:not(:last-child)::after {
      left: 7px;
      right: auto;
      top: 23px;
      bottom: -9px;
      width: 2px;
      height: auto;
    }
  }
`;
const Dot = styled.span<{ state: "done" | "active" | "pending" | "failed" }>`
  position: relative;
  z-index: 1;
  display: grid;
  place-items: center;
  width: 17px;
  height: 17px;
  margin: 0 auto 3px;
  border: 1px solid
    ${({ state }) => (state === "done" ? colors.success : state === "failed" ? colors.danger : state === "active" ? colors.accent : colors.border)};
  border-radius: 50%;
  background: white;
  color: ${({ state }) => (state === "done" ? colors.success : colors.accent)};
  font: 700 9px ${mono};
  @media (max-width: 650px) {
    margin: 0;
  }
`;
const Hero = styled(Surface)`
  min-height: min(566px, calc(100dvh - 284px));
  display: flex;
  flex-direction: column;
  padding: 24px;
  h2 {
    max-width: 680px;
    margin: 8px 0 16px;
    font-size: 24px;
    line-height: 1.2;
    letter-spacing: -0.02em;
  }
  p {
    margin: 0;
    color: ${colors.muted};
    line-height: 1.5;
  }
`;
const Eyebrow = styled.span`
  color: ${colors.muted};
  font-size: 12px;
  font-weight: 600;
`;
const Facts = styled.dl`
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin: 32px 0 0;
  div {
    padding: 16px;
    border: 1px solid ${colors.border};
    border-radius: 8px;
  }
  dt {
    color: ${colors.muted};
    font-size: 12px;
  }
  dd {
    margin: 4px 0 0;
    font-size: 20px;
    font-weight: 600;
  }
  @media (max-width: 760px) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
`;
const Actions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: auto;
  padding-top: 32px;
`;
const InspectorPane = styled.div`
  padding: 24px;
  display: grid;
  gap: 16px;
`;
const EvidenceCard = styled(Surface)`
  padding: 16px;
  h3 {
    margin: 0 0 8px;
    font-size: 14px;
  }
  p {
    margin: 0;
    color: ${colors.muted};
    font-size: 12px;
    line-height: 1.5;
  }
`;
const Technical = styled.details`
  border: 1px solid ${colors.border};
  border-radius: 8px;
  summary {
    padding: 14px 16px;
    cursor: pointer;
    font-weight: 600;
  }
  div {
    padding: 0 16px 16px;
    color: ${colors.muted};
    font: 11px ${mono};
    overflow-wrap: anywhere;
  }
`;

function roleState(snapshot: Snapshot, role: (typeof ROLE_ORDER)[number]) {
  "use no memo";
  const attempts = snapshot.attempts.filter((a) => a.role === role);
  const last = attempts.at(-1);
  if (last?.status === "failed") return "failed" as const;
  if (last?.status === "completed") return "done" as const;
  if (last?.status === "running" || snapshot.current_role === role) return "active" as const;
  return "pending" as const;
}

const STATUS_COPY: Record<Snapshot["status"], { eyebrow: string; description: string }> = {
  running: {
    eyebrow: "研究进行中",
    description: "研究流水线正在推进。你可以继续浏览题库，或在 Inspector 中查看当前证据与执行细节。",
  },
  completed: {
    eyebrow: "最终研究报告",
    description: "运行已经完成。研究正文、证据链和审计事实分别收纳在 Inspector 中。",
  },
  review_rejected: {
    eyebrow: "评审未通过",
    description: "运行已经到达终态，但独立评审未接受当前结果。审计事实与已冻结产物仍可在 Inspector 中查看。",
  },
  failed: {
    eyebrow: "运行失败",
    description: "运行已经到达失败终态。失败事实与已冻结产物仍可在 Inspector 中查看。",
  },
};

export function RunWorkspace({ snapshot, onInspectorChange, onRefetch }: RunWorkspaceProps) {
  const statusCopy =
    snapshot.status === "failed" && snapshot.error_code === "interrupted"
      ? { eyebrow: "已停止", description: "研究已停止，已冻结产物与执行记录仍可查看。" }
      : STATUS_COPY[snapshot.status];
  const verification = getReferenceVerification(snapshot.recent_events);
  return (
    <Canvas data-testid="run-workspace">
      <Rail aria-label="研究进度">
        {ROLE_ORDER.map((role, index) => {
          const state = roleState(snapshot, role);
          return (
            <Step key={role} state={state}>
              <Dot state={state}>{state === "done" ? "✓" : index + 1}</Dot>
              <span>{ROLE_LABEL[role]}</span>
            </Step>
          );
        })}
      </Rail>
      <RunControls key={snapshot.id} snapshot={snapshot} onRefetch={onRefetch} />
      <Hero>
        <Eyebrow>{statusCopy.eyebrow}</Eyebrow>
        <h2>{snapshot.question}</h2>
        <p>{statusCopy.description}</p>
        <Facts>
          <div>
            <dt>证据</dt>
            <dd>{snapshot.tool_evidence.length}</dd>
          </div>
          <div>
            <dt>产物</dt>
            <dd>{snapshot.artifacts.length}</dd>
          </div>
          <div>
            <dt>角色尝试</dt>
            <dd>{snapshot.attempts.length}</dd>
          </div>
          <div>
            <dt>引用验收</dt>
            <dd>{referenceVerificationLabel(verification)}</dd>
          </div>
        </Facts>
        <Actions>
          <Button tone="primary" onClick={() => onInspectorChange?.("artifacts")}>
            查看冻结产物
          </Button>
          <Button onClick={() => onInspectorChange?.("process")}>查看执行轨迹</Button>
        </Actions>
      </Hero>
    </Canvas>
  );
}

export function RunInspector({
  kind,
  snapshot,
  onRefetch,
  selectedArtifactId,
  onSelectArtifact,
  artifact,
  artifactLoading,
}: RunWorkspaceProps & { kind: InspectorKind }) {
  return (
    <InspectorPane>
      {kind === "artifacts" ? (
        <>
          {snapshot.tool_evidence.slice(0, 3).map((evidence) => (
            <EvidenceCard key={evidence.id}>
              <h3>{evidence.tool_name}</h3>
              <p>{evidence.output.result_summary ?? evidence.query}</p>
            </EvidenceCard>
          ))}
          {!snapshot.tool_evidence.length && (
            <EvidenceCard>
              <h3>证据尚未生成</h3>
              <p>运行推进后，冻结证据会出现在这里。</p>
            </EvidenceCard>
          )}
          <ArtifactPanel
            snapshot={snapshot}
            selectedArtifactId={selectedArtifactId}
            onSelectArtifact={onSelectArtifact}
            artifact={artifact}
            artifactLoading={artifactLoading}
          />
          <Technical>
            <summary>技术详情</summary>
            <div>
              run_id: {snapshot.id}
              <br />
              version: {snapshot.version}
              <br />
              omitted_evidence: {snapshot.omitted_evidence_count}
            </div>
          </Technical>
        </>
      ) : kind === "process" ? (
        <>
          <SubagentLineage snapshot={snapshot} />
          <Trajectory snapshot={snapshot} />
          <FeedbackComposer snapshot={snapshot} onSubmitted={onRefetch} />
          <FeedbackHistory snapshot={snapshot} />
          <AuditTrace snapshot={snapshot} />
        </>
      ) : null}
    </InspectorPane>
  );
}
