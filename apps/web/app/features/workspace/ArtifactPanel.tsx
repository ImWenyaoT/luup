import type { Artifact, Snapshot } from "../../lib/types/wire";
import styled from "@emotion/styled";
import { Button, colors, SectionTitle, Surface } from "../../styles";
import { ArtifactView } from "./ArtifactView";

export type ArtifactPanelProps = {
  snapshot: Snapshot;
  selectedArtifactId: string | null;
  onSelectArtifact: (id: string) => void;
  artifact: Artifact | null;
  artifactLoading: boolean;
};
const Header = styled(Surface)`
  padding: 12px;
  display: grid;
  gap: 10px;
`;
const HeaderRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: ${colors.muted};
  font-size: 10px;
`;
const Tabs = styled.div`
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding-bottom: 2px;
`;
const Empty = styled.div`
  padding: 32px 16px;
  border: 1px dashed ${colors.border};
  border-radius: 10px;
  text-align: center;
  color: ${colors.muted};
  font-size: 12px;
`;

export function ArtifactPanel({
  snapshot,
  selectedArtifactId,
  onSelectArtifact,
  artifact,
  artifactLoading,
}: ArtifactPanelProps) {
  if (snapshot.artifacts.length === 0) return null;

  return (
    <div data-testid="artifact-panel">
      <Header>
        <HeaderRow>
          <SectionTitle>冻结产物</SectionTitle>
          <span>共 {snapshot.artifacts.length} 份文件</span>
        </HeaderRow>
        <Tabs>
          {snapshot.artifacts.map((item) => (
            <Button
              compact
              key={item.id}
              type="button"
              onClick={() => onSelectArtifact(item.id)}
              tone={item.id === selectedArtifactId || item.id === snapshot.final_artifact_id ? "primary" : "quiet"}
            >
              {item.type}
            </Button>
          ))}
        </Tabs>
      </Header>

      {artifactLoading && selectedArtifactId && (
        <p style={{ color: colors.muted, fontSize: 12 }} data-testid="artifact-loading">
          加载产物…
        </p>
      )}

      {artifact && <ArtifactView artifact={artifact} />}

      {!selectedArtifactId && !artifactLoading && <Empty>点击上方按钮查看详细科学假设或研究计划</Empty>}
    </div>
  );
}
