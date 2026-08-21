import type { Artifact, Snapshot } from "./types";

const SNAPSHOT_TIMEOUT_MS = 10_000;

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
  // 浏览器原生超时会中断卡住的连接，让 App 现有的重试与恢复定时器能继续工作。
  return parse<Snapshot>(
    await fetch(`/api/runs/${encodeURIComponent(runId)}`, {
      signal: AbortSignal.timeout(SNAPSHOT_TIMEOUT_MS),
    }),
  );
}

export async function fetchArtifact(artifactId: string): Promise<Artifact> {
  return parse<Artifact>(await fetch(`/api/artifacts/${encodeURIComponent(artifactId)}`));
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

/** 密钥只进不出：请求带 key，响应永远只有三态状态。 */
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

/** SSE 只当「有事发生了」的低延迟提示，权威状态一律回头拉快照。
 *
 * 这样后端新增事件种类时前端没跟上也不会丢数据，只是晚一拍 —— 代价仅仅是多一次
 * 快照请求，换来的是两边不必为了「对齐」去改帧格式。
 */
export function subscribe(runId: string, from: number, onTick: () => void): () => void {
  const source = new EventSource(`/api/runs/${encodeURIComponent(runId)}/events?after=${from}`);
  const handle = () => onTick();
  // 帧是命名事件（`event: <kind>`），EventSource 不会把它们派发到 onmessage。
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
