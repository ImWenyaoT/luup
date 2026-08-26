import type { ApiClient } from "./client";
import { withAuth } from "./client";
import type { Snapshot } from "../types/wire";
import type { FeedbackQueued } from "../types/wire";

export function createRun(client: ApiClient, question: string): Promise<Snapshot> {
  return client.post<Snapshot>("/api/runs", { question }, withAuth(client));
}

export function fetchRun(client: ApiClient, runId: string): Promise<Snapshot> {
  return client.get<Snapshot>(`/api/runs/${encodeURIComponent(runId)}`, {
    signal: AbortSignal.timeout(client.snapshotTimeoutMs),
  });
}

export function submitFeedback(
  client: ApiClient,
  runId: string,
  input: { feedback_id: string; feedback: string },
): Promise<FeedbackQueued> {
  return client.post<FeedbackQueued>(`/api/runs/${encodeURIComponent(runId)}/feedback`, input, withAuth(client));
}
