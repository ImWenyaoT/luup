import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router";

import { useRun } from "../hooks/useRun";
import { useArtifact } from "../hooks/useArtifact";
import { fetchArtifact } from "../lib/api/artifacts";
import { AppShell } from "../features/shell/AppShell";
import { QuestionSidebar } from "../features/shell/QuestionSidebar";
import { RunHeader } from "../features/shell/RunHeader";
import { WelcomePanel } from "../features/shell/WelcomePanel";
import { RunWorkspace } from "../features/workspace/RunWorkspace";
import { useRunEvents } from "../hooks/useRunEvents";
import { useApiClient } from "../providers/api";
import { TERMINAL_STATUSES } from "../lib/types/constants";
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
    <div className="border-t border-neutral-200 bg-white/80 p-3.5 backdrop-blur shrink-0">
      <div className="mx-auto max-w-5xl space-y-2">
        <div className="flex items-center justify-between px-1">
          <span className="font-mono text-[11px] font-medium text-neutral-500">
            {selectedQuestion ? `已选 #${selectedQuestion.id} · ${selectedQuestion.domain}` : "追加研究课题或问题"}
          </span>
          {question && <span className="font-mono text-[10px] text-neutral-500">{question.length} 字符</span>}
        </div>
        <div className="flex items-end gap-2">
          <textarea
            data-testid="welcome-question-input"
            className="min-h-[52px] flex-1 resize-none rounded-lg border border-neutral-300 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-neutral-400"
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
          <button
            type="button"
            data-testid="start-research"
            className="h-[52px] min-w-[84px] shrink-0 rounded-lg bg-neutral-900 px-4 text-xs font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
            onClick={handleSubmit}
            disabled={!question.trim() || disabled}
          >
            {busy ? "运行中…" : "开始研究"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const queryClient = useQueryClient();
  const client = useApiClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const runId = searchParams.get("run");

  const { state, refetch, createAndNavigate } = useRun(runId);
  const [creationError, setCreationError] = useState<string | null>(null);
  const [dismissedRunError, setDismissedRunError] = useState(false);
  const [selectedQuestion, setSelectedQuestion] = useState<Science125Question | null>(null);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const [stickyArtifactError, setStickyArtifactError] = useState<string | null>(null);
  const stickyArtifactRunRef = useRef<string | null>(null);
  const artifactRunByIdRef = useRef<Map<string, string>>(new Map());
  const pendingArtifactSelectionRef = useRef<string | null>(null);

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

  const navigateToRun = useCallback(
    (id: string | null) => {
      if (id) {
        setSearchParams({ run: id }, { replace: true });
      } else {
        setSearchParams({}, { replace: true });
      }
    },
    [setSearchParams],
  );

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
    >
      <div className="mx-auto max-w-5xl space-y-4">
        {displayError && (
          <div
            role="alert"
            className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700"
            data-testid="error-banner"
          >
            <div className="flex items-start justify-between gap-2">
              <span>{displayError}</span>
              <button
                type="button"
                className="text-xs text-red-600 hover:text-red-800"
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
            </div>
          </div>
        )}

        {!snapshot && (
          <WelcomePanel
            onStartResearch={startResearch}
            disabled={state.status === "loading"}
            selectedQuestion={selectedQuestion}
          />
        )}

        {runId && state.status === "loading" && (
          <p className="text-sm text-neutral-500" data-testid="run-loading">
            加载运行…
          </p>
        )}

        {runErrorMessage && (
          <div className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700" data-testid="run-error">
            {runErrorMessage}
          </div>
        )}

        {snapshot && (
          <RunWorkspace
            snapshot={snapshot}
            onRefetch={() => void refetch()}
            selectedArtifactId={selectedArtifactId}
            onSelectArtifact={handleSelectArtifact}
            artifact={selectedArtifact}
            artifactLoading={artifactLoading}
          />
        )}
      </div>
    </AppShell>
  );
}
