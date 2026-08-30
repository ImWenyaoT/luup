import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError } from "../lib/api/client";
import { createRun, fetchRun } from "../lib/api/runs";
import type { Snapshot } from "../lib/types/wire";
import { useApiClient } from "../providers/api";
import type { ApiClient } from "../lib/api/client";

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

export function useRun(runId: string | null, options?: UseRunOptions) {
  const defaultClient = useApiClient();
  const client = options?.client ?? defaultClient;
  const [state, setState] = useState<UseRunState>({ status: "idle" });
  const stateRef = useRef(state);
  stateRef.current = state;
  const backoffRef = useRef(INITIAL_BACKOFF_MS);
  const inFlightRef = useRef<{ client: ApiClient; runId: string; promise: Promise<Snapshot> } | null>(null);

  const fetchSnapshot = useCallback(
    (id: string): Promise<Snapshot> => {
      const current = inFlightRef.current;
      if (current?.client === client && current.runId === id) return current.promise;
      const promise = fetchRun(client, id).finally(() => {
        if (inFlightRef.current?.promise === promise) inFlightRef.current = null;
      });
      inFlightRef.current = { client, runId: id, promise };
      return promise;
    },
    [client],
  );

  const loadRun = useCallback(
    async (id: string) => {
      setState({ status: "loading", runId: id });
      try {
        const snapshot = await fetchSnapshot(id);
        setState({ status: "ready", snapshot });
        backoffRef.current = INITIAL_BACKOFF_MS;
      } catch (cause) {
        const error = cause instanceof ApiError ? cause : new ApiError(500, String(cause));
        const lastSnapshot = stateRef.current.status === "ready" ? stateRef.current.snapshot : undefined;
        setState({ status: "error", runId: id, error, lastSnapshot });
      }
    },
    [fetchSnapshot],
  );

  useEffect(() => {
    if (!runId) {
      setState({ status: "idle" });
      backoffRef.current = INITIAL_BACKOFF_MS;
      return;
    }
    void loadRun(runId);
  }, [runId, loadRun]);

  const refetch = useCallback(async () => {
    if (!runId) return;
    const previous = stateRef.current;
    const lastSnapshot =
      previous.status === "ready" ? previous.snapshot : previous.status === "error" ? previous.lastSnapshot : undefined;
    try {
      const snapshot = await fetchSnapshot(runId);
      setState({ status: "ready", snapshot });
      backoffRef.current = INITIAL_BACKOFF_MS;
    } catch (cause) {
      const error = cause instanceof ApiError ? cause : new ApiError(500, String(cause));
      if (lastSnapshot) {
        setState({ status: "error", runId, error, lastSnapshot });
      } else {
        setState({ status: "error", runId, error });
      }
    }
  }, [fetchSnapshot, runId]);

  useEffect(() => {
    if (state.status !== "error") return;
    if (isClientError(state.error.status)) return;

    const timer = setTimeout(() => {
      void refetch();
    }, backoffRef.current);
    backoffRef.current = Math.min(backoffRef.current * 2, MAX_BACKOFF_MS);
    return () => clearTimeout(timer);
  }, [state, refetch]);

  const createAndNavigate = useCallback(
    async (question: string) => {
      const snapshot = await createRun(client, question);
      setState({ status: "ready", snapshot });
      backoffRef.current = INITIAL_BACKOFF_MS;
      return snapshot.id;
    },
    [client],
  );

  return { state, refetch, createAndNavigate };
}
