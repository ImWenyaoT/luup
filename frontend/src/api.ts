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

/** 传输层失败没有 HTTP 状态码。编一个真实状态码会把断网说成服务端的错。 */
const NO_RESPONSE = 0

/** 读不出可用错误体时的兜底：至少把状态码说清楚，不要吐半页 HTML。 */
const fallback = (status: number, code: string): ApiError => ({
  error: `HTTP ${status}`,
  code,
})

/** 后端的错误体是 `{error, code}`；别的形状（纯文本、数组、null）一律不认。 */
const asApiError = (value: unknown, status: number, code: string): ApiError =>
  typeof value === "object" && value !== null && "error" in value
    ? (value as ApiError)
    : fallback(status, code)

/** 断网/DNS/CORS：两条路径都归到这里，用户看到的才是同一句真话。 */
const networkFailure = (cause: unknown): ApiFailure =>
  new ApiFailure(NO_RESPONSE, {
    error: cause instanceof Error ? cause.message : "网络请求失败",
    code: "network_error",
  })

/** JSON.parse 永不产出 undefined，所以拿 undefined 当「没解析出来」的哨兵是安全的。 */
async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return undefined
  }
}

async function send(request: () => Promise<Response>): Promise<Response> {
  try {
    return await request()
  } catch (cause) {
    throw networkFailure(cause)
  }
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await send(() =>
    fetch(url(path), {
      ...init,
      headers: { accept: "application/json", ...init?.headers },
    }),
  )
  const body = await readJson(response)
  if (!response.ok)
    throw new ApiFailure(
      response.status,
      asApiError(body, response.status, "bad_response"),
    )
  // 2xx 但体不是 JSON：契约破了。把兜底对象当业务数据交出去，
  // 调用方只会在读 runId 时拿到 undefined，错误要在这里就被看见。
  if (body === undefined)
    throw new ApiFailure(
      response.status,
      fallback(response.status, "bad_response"),
    )
  return body as T
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
  /**
   * 发起一次串行批跑。响应只回被受理的题号与它们压出来的 `--ids`——
   * 批次没有 id，也没有进度端点：进度是 /batch 页从 runs/ 派生出来的。
   */
  startBatch: (ids: readonly number[]) =>
    json<{ ids: number[]; idsSpec: string }>("/api/batch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids }),
    }),
  async artifact(id: string, file: string) {
    const response = await send(() =>
      fetch(
        url(
          `/api/runs/${encodeURIComponent(id)}?artifact=${encodeURIComponent(file)}`,
        ),
      ),
    )
    if (!response.ok)
      throw new ApiFailure(
        response.status,
        asApiError(
          await readJson(response),
          response.status,
          "artifact_failed",
        ),
      )
    return response.text()
  },
}

async function generated<T>(
  request: Promise<{ data?: unknown; error?: unknown; response?: Response }>,
): Promise<T> {
  const result = await request
  // 生成 client 把传输失败也吞进 error，此时压根没有 response——
  // 拿 `?? 500` 兜底就是把断网报成服务端错误。
  if (!result.response) throw networkFailure(result.error)
  const { status, ok } = result.response
  if (!ok)
    throw new ApiFailure(
      status,
      asApiError(result.error, status, "bad_response"),
    )
  // 2xx 但 data 缺失：生成 client 把 JSON.parse 失败塞进了 error、data 留空。
  // 只看 ok 就会 resolve 出 undefined，崩在下游 `data.runs.map` 而不是 ErrorBox。
  if (result.data === undefined)
    throw new ApiFailure(status, fallback(status, "bad_response"))
  return result.data as T
}
