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
import { Trajectory } from "./Trajectory";

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
  max-width: 980px;
  margin: 0 auto;
  display: grid;
  gap: 24px;
  padding: clamp(8px, 3vw, 30px) 0;
`;
const Rail = styled.ol`
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 0;
  margin: 0;
  padding: 0;
  list-style: none;
  @media (max-width: 650px) {
    grid-template-columns: 1fr;
    gap: 8px;
  }
`;
const Step = styled.li<{ state: "done" | "active" | "pending" | "failed" }>`
  position: relative;
  text-align: center;
  color: ${({ state }) => (state === "pending" ? colors.faint : state === "failed" ? colors.danger : colors.ink)};
  font-size: 11px;
  &:not(:last-child)::after {
    content: "";
    position: absolute;
    left: 58%;
    right: -42%;
    top: 11px;
    height: 2px;
    background: ${({ state }) => (state === "done" ? colors.success : colors.border)};
  }
  @media (max-width: 650px) {
    display: grid;
    grid-template-columns: 28px 1fr;
    text-align: left;
    align-items: center;
    &:not(:last-child)::after {
      left: 11px;
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
  width: 23px;
  height: 23px;
  margin: 0 auto 7px;
  border: 2px solid
    ${({ state }) => (state === "done" ? colors.success : state === "failed" ? colors.danger : state === "active" ? colors.accent : colors.border)};
  border-radius: 50%;
  background: white;
  color: ${({ state }) => (state === "done" ? colors.success : colors.accent)};
  font: 700 10px ${mono};
  @media (max-width: 650px) {
    margin: 0;
  }
`;
const Hero = styled(Surface)`
  padding: clamp(20px, 4vw, 42px);
  p {
    margin: 0;
    color: ${colors.muted};
    line-height: 1.7;
  }
`;
const Actions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 24px;
`;
const InspectorPane = styled.div`
  padding: 14px;
  display: grid;
  gap: 18px;
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

export function RunWorkspace({ snapshot, onInspectorChange }: RunWorkspaceProps) {
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
      <Hero>
        <p>
          {snapshot.status === "running"
            ? "研究流水线正在推进。你可以继续浏览题库，或在 Inspector 中查看当前证据与执行细节。"
            : "运行已经到达终态。研究正文、证据链和审计事实分别收纳在 Inspector 中。"}
        </p>
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
        <ArtifactPanel
          snapshot={snapshot}
          selectedArtifactId={selectedArtifactId}
          onSelectArtifact={onSelectArtifact}
          artifact={artifact}
          artifactLoading={artifactLoading}
        />
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
