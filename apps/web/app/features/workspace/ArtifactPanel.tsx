import type { Artifact, Snapshot } from "../../lib/types/wire";
import { ArtifactView } from "./ArtifactView";

export type ArtifactPanelProps = {
  snapshot: Snapshot;
  selectedArtifactId: string | null;
  onSelectArtifact: (id: string) => void;
  artifact: Artifact | null;
  artifactLoading: boolean;
};

export function ArtifactPanel({
  snapshot,
  selectedArtifactId,
  onSelectArtifact,
  artifact,
  artifactLoading,
}: ArtifactPanelProps) {
  if (snapshot.artifacts.length === 0) return null;

  return (
    <div className="space-y-4" data-testid="artifact-panel">
      <div className="rounded-lg border border-neutral-200 bg-white p-3 shadow-sm">
        <div className="flex items-center justify-between pb-2">
          <h2 className="font-mono text-xs font-semibold uppercase tracking-widest text-neutral-500">冻结产物</h2>
          <span className="font-mono text-[10px] text-neutral-500">共 {snapshot.artifacts.length} 份文件</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {snapshot.artifacts.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectArtifact(item.id)}
              className={`h-6 rounded px-2 font-mono text-xs ${
                item.id === selectedArtifactId || item.id === snapshot.final_artifact_id
                  ? "bg-neutral-900 text-white"
                  : "border border-neutral-300 hover:bg-neutral-50"
              }`}
            >
              {item.type}
            </button>
          ))}
        </div>
      </div>

      {artifactLoading && selectedArtifactId && (
        <p className="text-sm text-neutral-500" data-testid="artifact-loading">
          加载产物…
        </p>
      )}

      {artifact && <ArtifactView artifact={artifact} />}

      {!selectedArtifactId && !artifactLoading && (
        <div className="rounded-lg border border-dashed border-neutral-300 bg-neutral-50 p-8 text-center text-xs text-neutral-500">
          点击上方按钮查看详细科学假设或研究计划
        </div>
      )}
    </div>
  );
}
