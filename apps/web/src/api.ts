import { treaty } from "@elysiajs/eden";
import type { Artifact, Science125Data, Science125Question, Snapshot } from "./types";

const SNAPSHOT_TIMEOUT_MS = 10_000;

export const client = treaty<any>(typeof window !== "undefined" ? window.location.origin : "http://localhost");

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function parse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const detail = await response.json().catch(() => ({ detail: response.statusText }));
    throw new ApiError(response.status, (detail as { detail?: string }).detail ?? `HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

export async function createRun(question: string): Promise<Snapshot> {
  return parse<Snapshot>(
    await fetch("/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question }),
    }),
  );
}

export async function fetchRun(runId: string): Promise<Snapshot> {
  return parse<Snapshot>(
    await fetch(`/api/runs/${encodeURIComponent(runId)}`, {
      signal: AbortSignal.timeout(SNAPSHOT_TIMEOUT_MS),
    }),
  );
}

export async function fetchArtifact(artifactId: string): Promise<Artifact> {
  return parse<Artifact>(await fetch(`/api/artifacts/${encodeURIComponent(artifactId)}`));
}

export async function submitResearcherFeedback(
  runId: string,
  input: { feedback_id: string; feedback: string },
  apiToken?: string,
): Promise<{ status: "queued"; feedback_id: string; round: 1 }> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (apiToken) headers.authorization = `Bearer ${apiToken}`;
  return parse(
    await fetch(`/api/runs/${encodeURIComponent(runId)}/feedback`, {
      method: "POST",
      headers,
      body: JSON.stringify(input),
    }),
  );
}

export type ConfigStatus = {
  runtime: "live" | "deterministic";
  credential: "override" | "environment" | "absent";
  model_id: string;
  base_url: string;
};

export async function fetchConfig(): Promise<ConfigStatus> {
  return parse<ConfigStatus>(await fetch("/api/config"));
}

export async function fetchScience125(): Promise<Science125Data> {
  return parse<Science125Data>(await fetch("/api/science125"));
}

export async function fetchScience125Question(
  id: number,
): Promise<{ question: Science125Question; formattedText: string }> {
  return parse<{ question: Science125Question; formattedText: string }>(
    await fetch(`/api/science125/${encodeURIComponent(id)}`),
  );
}

export async function saveConfig(next: {
  api_key?: string;
  model_id?: string;
  base_url?: string;
}): Promise<ConfigStatus> {
  return parse<ConfigStatus>(
    await fetch("/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(next),
    }),
  );
}

export function subscribe(runId: string, from: number, onTick: () => void): () => void {
  const source = new EventSource(`/api/runs/${encodeURIComponent(runId)}/events?after=${from}`);
  const handle = () => onTick();
  for (const kind of [
    "run.created",
    "attempt.started",
    "subagent.started",
    "subagent.ended",
    "feedback.received",
    "revision.applied",
    "tool.evidence_recorded",
    "sdk.structured_correction",
    "artifact.published",
    "attempt.failed",
    "run.completed",
    "run.review_rejected",
    "run.failed",
  ])
    source.addEventListener(kind, handle);
  return () => source.close();
}
