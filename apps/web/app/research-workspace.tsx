"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styled from "@emotion/styled";
import { useRouter, useSearchParams } from "next/navigation";

import { useRun } from "./hooks/useRun";
import { useStickyArtifactErrors } from "./hooks/useStickyArtifactErrors";
import { AppShell } from "./features/shell/AppShell";
import { QuestionSidebar } from "./features/shell/QuestionSidebar";
import { RunHeader } from "./features/shell/RunHeader";
import { ResearchQuestionInput } from "./features/shell/ResearchQuestionInput";
import { WelcomePanel } from "./features/shell/WelcomePanel";
import { readRunId, writeRunSearchParams } from "./features/shell/url-run";
import { RunInspector, RunWorkspace } from "./features/workspace/RunWorkspace";
import { colors } from "./styles";
import { useRunEvents } from "./hooks/useRunEvents";
import { useRunWorkingSet } from "./hooks/useRunWorkingSet";
import { useWebMCP } from "./hooks/useWebMCP";
import type { InspectorKind } from "./lib/types/inspector";
import type { Science125Question, Snapshot } from "./lib/types/wire";

export default function Home() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const runId = readRunId(searchParams);

  const { state, refetch, createAndNavigate } = useRun(runId);
  const [creationError, setCreationError] = useState<string | null>(null);
  const [dismissedRunError, setDismissedRunError] = useState(false);
  const [selectedQuestion, setSelectedQuestion] = useState<Science125Question | null>(null);
  const [inspector, setInspector] = useState<InspectorKind>(null);
  const inspectorRunRef = useRef<string | null>(null);
  const { tabs: runTabs, openRun, closeRun, persistenceError, clearPersistenceError } = useRunWorkingSet();
  const runScopeRef = useRef(runId);

  const displayedSnapshotRef = useRef<Snapshot | undefined>(undefined);

  const rawSnapshot =
    state.status === "ready" ? state.snapshot : state.status === "error" ? state.lastSnapshot : undefined;

  let snapshot: Snapshot | undefined;
  if (!runId) {
    snapshot = undefined;
    displayedSnapshotRef.current = undefined;
  } else if (rawSnapshot?.id === runId) {
    snapshot = rawSnapshot;
    displayedSnapshotRef.current = rawSnapshot;
  } else {
    snapshot = displayedSnapshotRef.current?.id === runId ? displayedSnapshotRef.current : undefined;
  }

  const {
    selectedArtifactId,
    selectedArtifact,
    artifactLoading,
    artifactFetchError,
    stickyError,
    selectArtifact,
    prepareBeforeNewRun,
    clearAll: clearStickyArtifactState,
    clearSelection: clearArtifactSelection,
    dismissStickyError,
  } = useStickyArtifactErrors({ runId, snapshot });

  const resetRunScopedState = useCallback(() => {
    clearStickyArtifactState();
    setDismissedRunError(false);
    setInspector(null);
  }, [clearStickyArtifactState]);

  const navigateToRun = useCallback(
    (id: string | null) => {
      if (id === runId) return;
      resetRunScopedState();
      const next = new URLSearchParams(searchParams.toString());
      const values = writeRunSearchParams(id);
      if (values.run) next.set("run", values.run);
      else next.delete("run");
      router.replace(next.size > 0 ? `/?${next.toString()}` : "/");
    },
    [resetRunScopedState, router, runId, searchParams],
  );

  const handleCloseRun = useCallback(
    (id: string) => {
      const nextRunId = closeRun(id, runId);
      if (id === runId) navigateToRun(nextRunId);
    },
    [closeRun, navigateToRun, runId],
  );

  useEffect(() => {
    if (runScopeRef.current === runId) return;
    runScopeRef.current = runId;
    resetRunScopedState();
  }, [resetRunScopedState, runId]);

  useEffect(() => {
    if (snapshot) openRun({ id: snapshot.id, label: snapshot.question });
  }, [openRun, snapshot?.id, snapshot?.question]);

  const handleSelectArtifact = useCallback(
    (id: string | null) => {
      selectArtifact(id);
      if (id) setCreationError(null);
    },
    [selectArtifact],
  );

  const startResearch = useCallback(
    async (question: string) => {
      setCreationError(null);
      try {
        await prepareBeforeNewRun();
        const id = await createAndNavigate(question);
        clearArtifactSelection();
        navigateToRun(id);
        setInspector(null);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        setCreationError(message);
      }
    },
    [clearArtifactSelection, createAndNavigate, navigateToRun, prepareBeforeNewRun],
  );

  const handleNewResearch = useCallback(() => {
    navigateToRun(null);
    clearStickyArtifactState();
    setSelectedQuestion(null);
    setCreationError(null);
    setDismissedRunError(false);
    setInspector(null);
  }, [clearStickyArtifactState, navigateToRun]);

  useEffect(() => {
    if (state.status === "ready") {
      setDismissedRunError(false);
    }
  }, [state.status]);

  const runErrorMessage = runId && state.status === "error" && !state.lastSnapshot ? state.error.message : null;

  const refetchErrorMessage =
    runId && state.status === "error" && state.lastSnapshot && !dismissedRunError ? state.error.message : null;

  const artifactErrorMessage = stickyError ?? artifactFetchError?.message ?? null;

  const displayError = creationError ?? artifactErrorMessage ?? refetchErrorMessage ?? persistenceError;

  const { connected: sseConnected } = useRunEvents(snapshot?.id ?? null, snapshot ?? null, () => void refetch());

  useEffect(() => {
    if (!snapshot || inspectorRunRef.current === snapshot.id) return;
    inspectorRunRef.current = snapshot.id;
    if (typeof window.matchMedia === "function" && window.matchMedia("(min-width: 1200px)").matches) {
      setInspector("artifacts");
    }
  }, [snapshot?.id]);

  useWebMCP({
    runId,
    status: state.status,
    snapshot,
    runs: runTabs,
    inspector,
    selectedArtifactId,
    artifactLoading,
    error: displayError ?? runErrorMessage,
    navigateToRun,
    setInspector,
    selectArtifact: handleSelectArtifact,
  });

  return (
    <AppShell
      runId={runId}
      onRunIdChange={navigateToRun}
      onStartResearch={startResearch}
      onNewResearch={handleNewResearch}
      runs={runTabs}
      onCloseRun={handleCloseRun}
      sidebar={
        <QuestionSidebar
          selectedQuestion={selectedQuestion}
          onSelect={setSelectedQuestion}
          onStartRun={(q) => void startResearch(q.question)}
          disabled={state.status === "loading"}
        />
      }
      header={snapshot ? <RunHeader snapshot={snapshot} sseConnected={sseConnected} /> : undefined}
      footer={
        snapshot ? (
          <ResearchQuestionInput
            variant="footer"
            onSubmit={startResearch}
            disabled={state.status === "loading" || Boolean(selectedArtifactId && artifactLoading)}
            selectedQuestion={selectedQuestion}
          />
        ) : undefined
      }
      inspector={inspector}
      onInspectorChange={setInspector}
      inspectorContent={
        snapshot ? (
          <RunInspector
            kind={inspector}
            snapshot={snapshot}
            onRefetch={() => void refetch()}
            selectedArtifactId={selectedArtifactId}
            onSelectArtifact={handleSelectArtifact}
            artifact={selectedArtifact}
            artifactLoading={artifactLoading}
          />
        ) : null
      }
    >
      <Page>
        {displayError && (
          <AlertRow role="alert" data-testid="error-banner">
            <span>{displayError}</span>
            <button
              type="button"
              onClick={() => {
                if (creationError) setCreationError(null);
                else if (artifactErrorMessage) dismissStickyError();
                else if (refetchErrorMessage) setDismissedRunError(true);
                else clearPersistenceError();
              }}
            >
              关闭
            </button>
          </AlertRow>
        )}

        {!snapshot && (
          <WelcomePanel
            onStartResearch={startResearch}
            disabled={state.status === "loading"}
            selectedQuestion={selectedQuestion}
          />
        )}

        {runId && state.status === "loading" && (
          <p style={{ color: colors.muted }} data-testid="run-loading">
            加载运行…
          </p>
        )}

        {runErrorMessage && <ErrorPanel data-testid="run-error">{runErrorMessage}</ErrorPanel>}

        {snapshot && (
          <RunWorkspace
            snapshot={snapshot}
            onRefetch={() => void refetch()}
            selectedArtifactId={selectedArtifactId}
            onSelectArtifact={handleSelectArtifact}
            artifact={selectedArtifact}
            artifactLoading={artifactLoading}
            onInspectorChange={setInspector}
          />
        )}
      </Page>
    </AppShell>
  );
}

const Page = styled.div`
  max-width: 1080px;
  margin: 0 auto;
  display: grid;
  gap: 16px;
`;
const ErrorPanel = styled.div`
  border: 1px solid #fda29b;
  border-radius: 9px;
  background: ${colors.dangerSoft};
  padding: 12px;
  color: ${colors.danger};
  font-size: 13px;
`;
const AlertRow = styled(ErrorPanel)`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  button {
    border: 0;
    background: transparent;
    color: ${colors.danger};
    font-size: 12px;
  }
`;
