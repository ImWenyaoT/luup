import type { ApiClient } from "./client";
import { withAuth } from "./client";
import type { Role, Snapshot } from "../types/wire";
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

export type RunInstruction = {
  instruction_id: string;
  role: Role;
  instruction: string;
};
export type InstructionReceipt = Omit<RunInstruction, "instruction"> & {
  status: "queued" | "applied" | "discarded";
  attempt_id?: string;
};
export function cancelRun(client: ApiClient, runId: string): Promise<{ status: "stopping" | "settled" }> {
  return client.post(`/api/runs/${encodeURIComponent(runId)}/cancel`, {}, withAuth(client));
}
export function submitInstruction(
  client: ApiClient,
  runId: string,
  input: RunInstruction,
): Promise<InstructionReceipt> {
  return client.post(`/api/runs/${encodeURIComponent(runId)}/instructions`, input, withAuth(client));
}
