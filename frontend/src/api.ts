import { client } from "./client/client.gen"
import {
  runApiRunsIdentifierGet,
  runsApiRunsGet,
  science125ApiScience125Get,
} from "./client/sdk.gen"
import type {
  ApiError,
  RunDetail,
  RunStatusView,
  RunSummary,
  Science125,
} from "./types"

const base = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "")
const url = (path: string) => `${base}${path}`
client.setConfig({ baseUrl: base })

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiError,
  ) {
    super(body.error || `HTTP ${status}`)
  }
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url(path), {
    ...init,
    headers: { accept: "application/json", ...init?.headers },
  })
  const body = (await response.json().catch(() => ({
    error: `HTTP ${response.status}`,
    code: "bad_response",
  }))) as T & ApiError
  if (!response.ok) throw new ApiFailure(response.status, body)
  return body
}

export const api = {
  science125: () =>
    generated<Science125>(science125ApiScience125Get({ throwOnError: false })),
  runs: () =>
    generated<{ active: string | null; runs: RunSummary[] }>(
      runsApiRunsGet({ query: { limit: "500" }, throwOnError: false }),
    ),
  detail: (id: string) =>
    generated<RunDetail>(
      runApiRunsIdentifierGet({
        path: { identifier: id },
        throwOnError: false,
      }),
    ),
  status: (id: string) =>
    generated<RunStatusView>(
      runApiRunsIdentifierGet({
        path: { identifier: id },
        query: { view: "status" },
        throwOnError: false,
      }),
    ),
  start: (body: { science125Id: number } | { question: string }) =>
    json<{ runId: string; status: "working" }>("/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  async artifact(id: string, file: string) {
    const response = await fetch(
      url(
        `/api/runs/${encodeURIComponent(id)}?artifact=${encodeURIComponent(file)}`,
      ),
    )
    if (!response.ok) {
      const body = (await response.json().catch(() => ({
        error: `HTTP ${response.status}`,
        code: "artifact_failed",
      }))) as ApiError
      throw new ApiFailure(response.status, body)
    }
    return response.text()
  },
}

async function generated<T>(
  request: Promise<{ data?: unknown; error?: unknown; response?: Response }>,
): Promise<T> {
  const result = await request
  const status = result.response?.status ?? 500
  if (!result.response?.ok) {
    const body = (result.error ?? {
      error: `HTTP ${status}`,
      code: "bad_response",
    }) as ApiError
    throw new ApiFailure(status, body)
  }
  return result.data as T
}
