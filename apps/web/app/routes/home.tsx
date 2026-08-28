import { useCallback, useEffect, useRef, useState } from "react";
import styled from "@emotion/styled";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router";

import { useRun } from "../hooks/useRun";
import { useArtifact } from "../hooks/useArtifact";
import { fetchArtifact } from "../lib/api/artifacts";
import { AppShell } from "../features/shell/AppShell";
import { QuestionSidebar } from "../features/shell/QuestionSidebar";
import { RunHeader } from "../features/shell/RunHeader";
import { WelcomePanel } from "../features/shell/WelcomePanel";
import { readRunId, writeRunSearchParams } from "../features/shell/url-run";
import { RunInspector, RunWorkspace } from "../features/workspace/RunWorkspace";
import { Button, colors, mono, Textarea } from "../styles";
import { useRunEvents } from "../hooks/useRunEvents";
import { useRunWorkingSet } from "../hooks/useRunWorkingSet";
import { useApiClient } from "../providers/api";
import { TERMINAL_STATUSES } from "../lib/types/constants";
import type { InspectorKind } from "../lib/types/inspector";
import type { Science125Question, Snapshot } from "../lib/types/wire";
import type { Route } from "./+types/home";

export function meta(_args: Route.MetaArgs) {
  return [{ title: "Luup" }, { name: "description", content: "Luup research harness" }];
}

function readArtifactErrorMessage(error: unknown): string | null {
  if (!error) return null;
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return JSON.stringify(error);
}

function captureStickyArtifactError(
  queryClient: QueryClient,
  artifactId: string,
  originRunId: string,
): { message: string; originRunId: string } | null {
  const state = queryClient.getQueryState(["artifact", artifactId]);
  if (state?.status !== "error") return null;
  const message = readArtifactErrorMessage(state.error);
  if (!message) return null;
  return { message, originRunId };
}

function ResearchInput({
  onSubmit,
  disabled,
  selectedQuestion,
}: {
  onSubmit: (question: string) => Promise<void>;
  disabled?: boolean;
  selectedQuestion?: Science125Question | null;
}) {
  const [question, setQuestion] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const busy = submitting || disabled;

  const handleSubmit = () => {
    const trimmed = question.trim();
    if (!trimmed || busy) return;
    setSubmitting(true);
    void onSubmit(trimmed)
      .then(() => setQuestion(""))
      .finally(() => setSubmitting(false));
  };

  return (
    <ComposerBar>
      <ComposerInner>
        <ComposerMeta>
          <span>
            {selectedQuestion ? `已选 #${selectedQuestion.id} · ${selectedQuestion.domain}` : "追加研究课题或问题"}
          </span>
          {question && <span>{question.length} 字符</span>}
        </ComposerMeta>
        <ComposerRow>
          <Textarea
            data-testid="welcome-question-input"
            placeholder="提出一个可以设计实验去检验的研究问题"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            rows={2}
            disabled={busy}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && !busy && question.trim()) {
                event.preventDefault();
                handleSubmit();
              }
            }}
          />
          <Button
            tone="primary"
            type="button"
            data-testid="start-research"
            onClick={handleSubmit}
            disabled={!question.trim() || disabled}
          >
            {busy ? "运行中…" : "开始研究"}
          </Button>
        </ComposerRow>
      </ComposerInner>
    </ComposerBar>
  );
}

export default function Home() {
  const queryClient = useQueryClient();
  const client = useApiClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const runId = readRunId(searchParams);

  const { state, refetch, createAndNavigate } = useRun(runId);
  const [creationError, setCreationError] = useState<string | null>(null);
  const [dismissedRunError, setDismissedRunError] = useState(false);
  const [selectedQuestion, setSelectedQuestion] = useState<Science125Question | null>(null);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const [inspector, setInspector] = useState<InspectorKind>(null);
  const { tabs: runTabs, openRun, closeRun } = useRunWorkingSet();
  const [stickyArtifactError, setStickyArtifactError] = useState<string | null>(null);
  const stickyArtifactRunRef = useRef<string | null>(null);
  const artifactRunByIdRef = useRef<Map<string, string>>(new Map());
  const pendingArtifactSelectionRef = useRef<string | null>(null);
  const runScopeRef = useRef(runId);

  const applyStickyArtifactError = useCallback((message: string, originRunId: string) => {
    setStickyArtifactError(message);
    stickyArtifactRunRef.current = originRunId;
  }, []);

  const rememberArtifactRun = useCallback((artifactId: string, originRunId: string) => {
    artifactRunByIdRef.current.set(artifactId, originRunId);
  }, []);

  const syncStickyArtifactError = useCallback(
    (artifactId: string, originRunId: string) => {
      const captured = captureStickyArtifactError(queryClient, artifactId, originRunId);
      if (captured) {
        applyStickyArtifactError(captured.message, captured.originRunId);
      }
    },
    [applyStickyArtifactError, queryClient],
  );

  const fetchArtifactQuery = useCallback(
    (artifactId: string) => ({
      queryKey: ["artifact", artifactId] as const,
      queryFn: () => fetchArtifact(client, artifactId),
      staleTime: Infinity,
      retry: false,
    }),
    [client],
  );

  const handleSelectArtifact = useCallback(
    (id: string | null) => {
      if (id) {
        pendingArtifactSelectionRef.current = id;
        if (runId) {
          rememberArtifactRun(id, runId);
          void queryClient.fetchQuery(fetchArtifactQuery(id)).catch(() => {
            // Errors are surfaced through the query cache subscription.
          });
        }
        setCreationError(null);
      } else {
        pendingArtifactSelectionRef.current = null;
      }
      setSelectedArtifactId(id);
    },
    [fetchArtifactQuery, queryClient, rememberArtifactRun, runId],
  );

  const resetRunScopedState = useCallback(() => {
    pendingArtifactSelectionRef.current = null;
    setSelectedArtifactId(null);
    setStickyArtifactError(null);
    stickyArtifactRunRef.current = null;
    artifactRunByIdRef.current.clear();
    setDismissedRunError(false);
    setInspector(null);
  }, []);

  const navigateToRun = useCallback(
    (id: string | null) => {
      if (id === runId) return;
      resetRunScopedState();
      setSearchParams(writeRunSearchParams(id), { replace: true });
    },
    [resetRunScopedState, runId, setSearchParams],
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

  useEffect(() => {
    if (snapshot) openRun({ id: snapshot.id, label: snapshot.question });
  }, [openRun, snapshot?.id, snapshot?.question]);

  const {
    artifact: selectedArtifact,
    loading: artifactLoading,
    error: artifactFetchError,
  } = useArtifact(selectedArtifactId);

  useEffect(() => {
    if (!artifactFetchError?.message || !selectedArtifactId) return;
    const originRunId = artifactRunByIdRef.current.get(selectedArtifactId) ?? runId;
    if (!originRunId) return;
    applyStickyArtifactError(artifactFetchError.message, originRunId);
  }, [applyStickyArtifactError, artifactFetchError?.message, runId, selectedArtifactId]);

  useEffect(() => {
    return queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== "updated") return;
      const query = event.query;
      if (query.queryKey[0] !== "artifact") return;
      if (query.state.status !== "error") return;
      const artifactId = query.queryKey[1];
      if (typeof artifactId !== "string") return;
      const originRunId = artifactRunByIdRef.current.get(artifactId);
      if (!originRunId) return;
      const message = readArtifactErrorMessage(query.state.error);
      if (!message) return;
      applyStickyArtifactError(message, originRunId);
    });
  }, [applyStickyArtifactError, queryClient]);

  useEffect(() => {
    if (!snapshot || !stickyArtifactRunRef.current) return;
    if (snapshot.id === stickyArtifactRunRef.current) return;
    if (!TERMINAL_STATUSES.has(snapshot.status)) return;

    const originRunId = stickyArtifactRunRef.current;
    const frame = requestAnimationFrame(() => {
      if (stickyArtifactRunRef.current !== originRunId) return;
      setStickyArtifactError(null);
      stickyArtifactRunRef.current = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [snapshot?.id, snapshot?.status]);

  const startResearch = useCallback(
    async (question: string) => {
      setCreationError(null);
      const pendingArtifactId = selectedArtifactId ?? pendingArtifactSelectionRef.current;
      const pendingRunId = runId;
      try {
        if (pendingArtifactId && pendingRunId) {
          rememberArtifactRun(pendingArtifactId, pendingRunId);
          const existingState = queryClient.getQueryState(["artifact", pendingArtifactId]);
          syncStickyArtifactError(pendingArtifactId, pendingRunId);
          if (existingState?.status !== "error" && existingState?.status !== "success") {
            try {
              await queryClient.fetchQuery(fetchArtifactQuery(pendingArtifactId));
            } catch {
              // Expected when the artifact request fails; sync from query cache below.
            }
            syncStickyArtifactError(pendingArtifactId, pendingRunId);
          }
        }
        const id = await createAndNavigate(question);
        pendingArtifactSelectionRef.current = null;
        setSelectedArtifactId(null);
        navigateToRun(id);
        setInspector(null);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        setCreationError(message);
        throw cause;
      }
    },
    [
      createAndNavigate,
      fetchArtifactQuery,
      navigateToRun,
      queryClient,
      rememberArtifactRun,
      runId,
      selectedArtifactId,
      syncStickyArtifactError,
    ],
  );

  const handleNewResearch = useCallback(() => {
    navigateToRun(null);
    pendingArtifactSelectionRef.current = null;
    setSelectedArtifactId(null);
    setStickyArtifactError(null);
    stickyArtifactRunRef.current = null;
    artifactRunByIdRef.current.clear();
    setSelectedQuestion(null);
    setCreationError(null);
    setDismissedRunError(false);
    setInspector(null);
  }, [navigateToRun]);

  useEffect(() => {
    if (state.status === "ready") {
      setDismissedRunError(false);
    }
  }, [state.status]);

  const runErrorMessage = runId && state.status === "error" && !state.lastSnapshot ? state.error.message : null;

  const refetchErrorMessage =
    runId && state.status === "error" && state.lastSnapshot && !dismissedRunError ? state.error.message : null;

  const artifactErrorMessage = stickyArtifactError ?? artifactFetchError?.message ?? null;

  const displayError = creationError ?? artifactErrorMessage ?? refetchErrorMessage;

  const { connected: sseConnected } = useRunEvents(snapshot?.id ?? null, snapshot ?? null, () => void refetch());

  return (
    <AppShell
      runId={runId}
      onRunIdChange={navigateToRun}
      onStartResearch={startResearch}
      runs={runTabs}
      onCloseRun={handleCloseRun}
      sidebar={
        <QuestionSidebar
          selectedQuestion={selectedQuestion}
          onSelect={setSelectedQuestion}
          onStartRun={(q) => void startResearch(q.question)}
          onNewResearch={handleNewResearch}
          disabled={state.status === "loading"}
        />
      }
      header={snapshot ? <RunHeader snapshot={snapshot} sseConnected={sseConnected} /> : undefined}
      footer={
        snapshot ? (
          <ResearchInput
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
                else if (artifactErrorMessage) {
                  setStickyArtifactError(null);
                  stickyArtifactRunRef.current = null;
                  setSelectedArtifactId(null);
                } else setDismissedRunError(true);
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

const ComposerBar = styled.div`
  flex: none;
  border-top: 1px solid ${colors.border};
  background: rgba(255, 255, 255, 0.96);
  padding: 12px 16px;
  @media (max-width: 700px) {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 20;
    padding: 8px;
  }
`;
const ComposerInner = styled.div`
  max-width: 980px;
  margin: 0 auto;
  display: grid;
  gap: 6px;
`;
const ComposerMeta = styled.div`
  display: flex;
  justify-content: space-between;
  color: ${colors.muted};
  font: 10px ${mono};
`;
const ComposerRow = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  align-items: end;
  textarea {
    min-height: 52px;
  }
  @media (max-width: 520px) {
    button {
      min-width: 84px;
    }
  }
`;
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
