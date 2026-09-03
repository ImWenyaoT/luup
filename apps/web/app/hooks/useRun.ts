import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { toApiError } from "../lib/api/client";
import type { ApiClient, ApiError } from "../lib/api/client";
import { createRun, fetchRun } from "../lib/api/runs";
import type { Snapshot } from "../lib/types/wire";
import { useApiClient } from "../providers/api";

export type UseRunState =
  | { status: "idle" }
  | { status: "loading"; runId: string }
  | { status: "ready"; snapshot: Snapshot }
  | { status: "error"; runId: string; error: ApiError; lastSnapshot?: Snapshot };

export type UseRunOptions = {
  client?: ApiClient;
};

const INITIAL_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 5_000;

function isClientError(status: number): boolean {
  return status >= 400 && status < 500;
}

export function runQueryKey(runId: string) {
  return ["run", runId] as const;
}

export function runQueryOptions(client: ApiClient, runId: string) {
  return {
    queryKey: runQueryKey(runId),
    queryFn: () => fetchRun(client, runId),
  };
}

function deriveRunState(
  runId: string | null,
  cached:
    | {
        status: string;
        data: Snapshot | undefined;
        error: unknown;
      }
    | undefined,
  createdSnapshot: Snapshot | null,
): UseRunState {
  if (createdSnapshot && (!runId || runId === createdSnapshot.id)) {
    return { status: "ready", snapshot: createdSnapshot };
  }
  if (!runId) return { status: "idle" };
  if (!cached || cached.status === "pending") {
    return { status: "loading", runId };
  }
  if (cached.status === "error") {
    return {
      status: "error",
      runId,
      error: toApiError(cached.error),
      // Prior success data stays on this queryKey only — no cross-runId leak.
      ...(cached.data ? { lastSnapshot: cached.data } : {}),
    };
  }
  if (cached.data) return { status: "ready", snapshot: cached.data };
  return { status: "loading", runId };
}

export function useRun(runId: string | null, options?: UseRunOptions) {
  const defaultClient = useApiClient();
  const client = options?.client ?? defaultClient;
  const queryClient = useQueryClient();
  const backoffRef = useRef(INITIAL_BACKOFF_MS);
  const [createdSnapshot, setCreatedSnapshot] = useState<Snapshot | null>(null);
  // Query cache mutates state in place; useQuery alone can miss a React turn after
  // fetchQuery error (refetch-fail → lastSnapshot). Bump on matching cache events.
  const [, setCacheEpoch] = useState(0);

  useQuery({
    ...runQueryOptions(client, runId ?? ""),
    enabled: Boolean(runId),
    retry: false,
  });

  useEffect(() => {
    if (!runId) return;
    const key = runQueryKey(runId);
    return queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== "updated" && event.type !== "added") return;
      const eventKey = event.query.queryKey;
      if (eventKey[0] !== key[0] || eventKey[1] !== key[1]) return;
      setCacheEpoch((n) => n + 1);
    });
  }, [queryClient, runId]);

  const mutation = useMutation({
    mutationFn: (question: string) => createRun(client, question),
    onSuccess: (snapshot) => {
      queryClient.setQueryData(runQueryKey(snapshot.id), snapshot);
    },
  });

  useEffect(() => {
    if (createdSnapshot && runId === createdSnapshot.id) {
      setCreatedSnapshot(null);
    }
  }, [runId, createdSnapshot]);

  useEffect(() => {
    if (!runId) {
      backoffRef.current = INITIAL_BACKOFF_MS;
    }
  }, [runId]);

  const cached = runId ? queryClient.getQueryState<Snapshot>(runQueryKey(runId)) : undefined;

  useEffect(() => {
    if (cached?.status === "success") {
      backoffRef.current = INITIAL_BACKOFF_MS;
    }
  }, [cached?.status, cached?.dataUpdatedAt]);

  const refetch = useCallback(async () => {
    if (!runId) return;
    try {
      await queryClient.fetchQuery({
        ...runQueryOptions(client, runId),
        staleTime: 0,
      });
    } catch {
      // fetchQuery throws and sets cache status=error; subscription re-renders.
    }
  }, [runId, client, queryClient]);

  useEffect(() => {
    if (!runId) return;
    if (cached?.status !== "error" || !cached.error) return;
    const error = toApiError(cached.error);
    if (isClientError(error.status)) return;

    const delay = backoffRef.current;
    const timer = setTimeout(() => {
      void queryClient
        .fetchQuery({
          ...runQueryOptions(client, runId),
          staleTime: 0,
        })
        .catch(() => undefined);
    }, delay);
    backoffRef.current = Math.min(delay * 2, MAX_BACKOFF_MS);
    return () => clearTimeout(timer);
  }, [runId, cached?.status, cached?.error, cached?.fetchFailureCount, client, queryClient]);

  const createAndNavigate = useCallback(
    async (question: string) => {
      try {
        const snapshot = await mutation.mutateAsync(question);
        setCreatedSnapshot(snapshot);
        backoffRef.current = INITIAL_BACKOFF_MS;
        return snapshot.id;
      } catch (cause) {
        throw toApiError(cause);
      }
    },
    [mutation],
  );

  const state = deriveRunState(runId, cached, createdSnapshot);

  return { state, refetch, createAndNavigate };
}
