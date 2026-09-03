"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";

import { fetchArtifact } from "../lib/api/artifacts";
import { TERMINAL_STATUSES } from "../lib/types/constants";
import type { Snapshot } from "../lib/types/wire";
import { useApiClient } from "../providers/api";
import { useArtifact } from "./useArtifact";

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

export type UseStickyArtifactErrorsOptions = {
  runId: string | null;
  snapshot: Snapshot | undefined;
};

export function useStickyArtifactErrors({ runId, snapshot }: UseStickyArtifactErrorsOptions) {
  const queryClient = useQueryClient();
  const client = useApiClient();

  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const [stickyError, setStickyError] = useState<string | null>(null);
  const stickyArtifactRunRef = useRef<string | null>(null);
  const artifactRunByIdRef = useRef<Map<string, string>>(new Map());
  const pendingArtifactSelectionRef = useRef<string | null>(null);

  const {
    artifact: selectedArtifact,
    loading: artifactLoading,
    error: artifactFetchError,
  } = useArtifact(selectedArtifactId);

  const applyStickyArtifactError = useCallback((message: string, originRunId: string) => {
    setStickyError(message);
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

  const selectArtifact = useCallback(
    (id: string | null) => {
      if (id) {
        pendingArtifactSelectionRef.current = id;
        if (runId) {
          rememberArtifactRun(id, runId);
          void queryClient.fetchQuery(fetchArtifactQuery(id)).catch((cause: unknown) => {
            const message = readArtifactErrorMessage(cause);
            if (message && artifactRunByIdRef.current.get(id) === runId) {
              applyStickyArtifactError(message, runId);
            }
          });
        }
      } else {
        pendingArtifactSelectionRef.current = null;
      }
      setSelectedArtifactId(id);
    },
    [applyStickyArtifactError, fetchArtifactQuery, queryClient, rememberArtifactRun, runId],
  );

  const clearAll = useCallback(() => {
    pendingArtifactSelectionRef.current = null;
    setSelectedArtifactId(null);
    setStickyError(null);
    stickyArtifactRunRef.current = null;
    artifactRunByIdRef.current.clear();
  }, []);

  const clearSelection = useCallback(() => {
    pendingArtifactSelectionRef.current = null;
    setSelectedArtifactId(null);
  }, []);

  const dismissStickyError = useCallback(() => {
    setStickyError(null);
    stickyArtifactRunRef.current = null;
    setSelectedArtifactId(null);
  }, []);

  const prepareBeforeNewRun = useCallback(async () => {
    const pendingArtifactId = selectedArtifactId ?? pendingArtifactSelectionRef.current;
    const pendingRunId = runId;
    if (!pendingArtifactId || !pendingRunId) return;

    rememberArtifactRun(pendingArtifactId, pendingRunId);
    const existingState = queryClient.getQueryState(["artifact", pendingArtifactId]);
    syncStickyArtifactError(pendingArtifactId, pendingRunId);
    if (existingState?.status !== "error" && existingState?.status !== "success") {
      try {
        await queryClient.fetchQuery(fetchArtifactQuery(pendingArtifactId));
      } catch (cause) {
        const message = readArtifactErrorMessage(cause);
        if (message) applyStickyArtifactError(message, pendingRunId);
      }
      syncStickyArtifactError(pendingArtifactId, pendingRunId);
    }
  }, [
    applyStickyArtifactError,
    fetchArtifactQuery,
    queryClient,
    rememberArtifactRun,
    runId,
    selectedArtifactId,
    syncStickyArtifactError,
  ]);

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
      setStickyError(null);
      stickyArtifactRunRef.current = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [snapshot?.id, snapshot?.status]);

  return {
    selectedArtifactId,
    selectedArtifact,
    artifactLoading,
    artifactFetchError,
    stickyError,
    selectArtifact,
    prepareBeforeNewRun,
    clearAll,
    clearSelection,
    dismissStickyError,
  };
}
