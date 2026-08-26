import { useRunEvents } from "../../hooks/useRunEvents";
import type { Artifact, Snapshot } from "../../lib/types/wire";
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
};

export function RunWorkspace({
  snapshot,
  onRefetch,
  selectedArtifactId,
  onSelectArtifact,
  artifact,
  artifactLoading,
}: RunWorkspaceProps) {
  useRunEvents(snapshot.id, snapshot, onRefetch);

  return (
    <div className="space-y-5" data-testid="run-workspace">
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-12">
        <div className="space-y-4 lg:col-span-5">
          <SubagentLineage snapshot={snapshot} />
          <AuditTrace snapshot={snapshot} />
          <Trajectory snapshot={snapshot} />
          <FeedbackComposer snapshot={snapshot} onSubmitted={onRefetch} />
          <FeedbackHistory snapshot={snapshot} />
        </div>

        <div className="space-y-4 lg:col-span-7 lg:sticky lg:top-2">
          <ArtifactPanel
            snapshot={snapshot}
            selectedArtifactId={selectedArtifactId}
            onSelectArtifact={(id) => onSelectArtifact(id)}
            artifact={artifact}
            artifactLoading={artifactLoading}
          />
        </div>
      </div>
    </div>
  );
}
