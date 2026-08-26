import { createHash, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { serve, type ServerType } from "@hono/node-server";
import { Elysia } from "elysia";

import { renderResearchPlanMarkdown } from "./api/artifact-markdown.ts";
import { problemResponse } from "./api/problem-details.ts";
import { projectArtifact, projectRunSnapshot, projectSseFrame } from "./api/projection.ts";
import { findQuestion, readScience125, science125Text } from "./domain/science125.ts";
import { createDeterministicRuntime, createDeterministicVerifier } from "./executor-deterministic.ts";
import { createQwenExecutor } from "./executor.ts";
import { Harness } from "./harness.ts";
import { modelConfigStatus, setModelOverride } from "./seams/index.ts";
import { FeedbackSubmissionError, MAX_QUESTION_LENGTH, normalizeQuestion, SqliteStore } from "./store/store.ts";

const TERMINAL = new Set(["completed", "review_rejected", "failed"]);
const POLL_MS = 100;
const KEEP_ALIVE_TICKS = 100;

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

function json(status: number, body: unknown, extraHeaders: Record<string, string> = {}): Response {
  return Response.json(body, {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...extraHeaders },
  });
}

/** 严格解析游标。`parseInt("1e3")` 会得到 1、`Number("")` 会得到 0，两个都不是我们要的。 */
function parseCursor(raw: string | null): number | null {
  if (raw === null || raw.trim() === "") return 0;
  if (!/^\d+$/.test(raw.trim())) return null;
  const cursor = Number(raw.trim());
  return Number.isSafeInteger(cursor) ? cursor : null;
}

/** 恒定时间比对 API Token，抵御时序侧信道攻击（Timing Attack）。
 * 先对两端分别计算 SHA-256 哈希以规避 timingSafeEqual 对非等长 buffer 抛异常的问题，
 * 并保证比对时间与输入内容和长度无关。
 */
export function timingSafeTokenCompare(provided: string, expected: string): boolean {
  const hashProvided = createHash("sha256").update(provided).digest();
  const hashExpected = createHash("sha256").update(expected).digest();
  return timingSafeEqual(hashProvided, hashExpected);
}

/** 防御性 HTTP 安全响应头。
 * - x-content-type-options: nosniff（防御 MIME 混淆与嗅探攻击，特别是用户与模型生成的 Markdown/JSON/文本产物）
 * - x-frame-options: DENY（防御 Clickjacking 点击劫持，禁止第三方 frame 嵌入）
 * - referrer-policy: strict-origin-when-cross-origin（防止向外部文献服务如 arXiv/Crossref 泄漏内部路径与查询）
 */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
};

export function applySecurityHeaders(response: Response): Response {
  for (const [header, value] of Object.entries(SECURITY_HEADERS)) {
    if (!response.headers.has(header)) {
      response.headers.set(header, value);
    }
  }
  return response;
}

export type ServerOptions = {
  store: SqliteStore;
  harness: Harness;
  runtime?: "live" | "deterministic";
  webDist?: string;
  reportError?: (message: string, error: unknown) => void;
  hostname?: string;
  port?: number;
};

export type LuupServer = {
  readonly port: number;
  readonly hostname: string;
  readonly url: URL;
  readonly ready: Promise<void>;
  stop: (closeActiveConnections?: boolean) => Promise<void>;
  fetch: (req: Request) => Promise<Response>;
  rawServer: ServerType;
};

/** 基于 Elysia 的应用工厂，负责路由声明与类型系统推导。 */
export function createElysiaApp(options: ServerOptions) {
  const { store, harness } = options;
  const mode = options.runtime ?? runtimeMode();
  const reportError = options.reportError ?? ((message, error) => console.error(message, error));
  const maxConcurrentRuns = 2;
  const apiToken = process.env.LUUP_API_TOKEN?.trim() || null;
  const configuredQueueLimit = Number(process.env.LUUP_MAX_QUEUED_RUNS ?? 8);
  const maxQueuedRuns =
    Number.isSafeInteger(configuredQueueLimit) && configuredQueueLimit > 0 ? configuredQueueLimit : 8;
  const scheduled = new Set<string>();
  const queue: string[] = [];
  let activeRuns = 0;

  const unauthorized = (instance?: string, req?: Request): Response => {
    const accept = req?.headers.get("accept") ?? "";
    if (accept.includes("application/problem+json")) {
      return problemResponse(401, {
        code: "unauthorized",
        title: "Unauthorized",
        detail: "需要 API token。",
        resolution: "请在 Authorization 请求头中提供 'Bearer <token>'。",
        instance,
        extraHeaders: { "www-authenticate": 'Bearer realm="luup"' },
      });
    }
    return json(401, { detail: "需要 API token。" }, { "www-authenticate": 'Bearer realm="luup"' });
  };

  const authorized = (req: Request): boolean => {
    if (apiToken === null) return mode === "deterministic";
    const authHeader = req.headers.get("authorization");
    if (!authHeader) return false;
    return timingSafeTokenCompare(authHeader, `Bearer ${apiToken}`);
  };

  const drain = (): void => {
    while (activeRuns < maxConcurrentRuns && queue.length > 0) {
      const runId = queue.shift()!;
      activeRuns += 1;
      void harness
        .execute(runId)
        .catch((error: unknown) => {
          reportError("background run failed", error);
          if (store.snapshot(runId)?.status !== "running") return;
          try {
            store.finishRun(runId, "failed", { errorCode: "runtime_error" });
          } catch (settleError) {
            reportError("failed to settle background run", settleError);
          }
        })
        .finally(() => {
          activeRuns -= 1;
          scheduled.delete(runId);
          drain();
        });
    }
  };

  const schedule = (runId: string): void => {
    if (scheduled.has(runId)) return;
    scheduled.add(runId);
    queue.push(runId);
    drain();
  };

  function streamEvents(req: Request, runId: string, from: number): Response {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let cursor = from;
        let idle = 0;
        let closed = false;

        const close = (): void => {
          if (closed) return;
          closed = true;
          try {
            controller.close();
          } catch (error) {
            if (!req.signal.aborted) reportError("SSE stream close failed", error);
          }
        };

        const fail = (error: unknown): void => {
          if (req.signal.aborted) {
            close();
            return;
          }
          reportError("SSE stream failed", error);
          if (closed) return;
          try {
            const payload = JSON.stringify({ code: "stream_error", cursor });
            controller.enqueue(encoder.encode(`event: stream.error\ndata: ${payload}\n\n`));
          } catch (enqueueError) {
            reportError("SSE stream error frame failed", enqueueError);
          }
          close();
        };

        try {
          while (!req.signal.aborted) {
            const events = store.eventsAfter(runId, cursor);
            if (events.length > 0) {
              for (const event of events) {
                const frame = projectSseFrame(event);
                if (frame !== null) controller.enqueue(encoder.encode(frame));
              }
              cursor = Number(events.at(-1)!.version);
              idle = 0;
              continue;
            }
            const snapshot = store.snapshot(runId);
            if (!snapshot || TERMINAL.has(String(snapshot.status))) break;
            idle += 1;
            if (idle % KEEP_ALIVE_TICKS === 0) controller.enqueue(encoder.encode(": keep-alive\n\n"));
            await sleep(POLL_MS);
          }
        } catch (error) {
          fail(error);
        } finally {
          close();
        }
      },
    });
    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
      },
    });
  }

  function serveStatic(pathname: string): Response | null {
    const dist = options.webDist;
    if (!dist) return null;
    const root = resolve(dist);
    const candidate = resolve(join(root, normalize(pathname)));
    const inside = candidate === root || candidate.startsWith(root + (process.platform === "win32" ? "\\" : "/"));
    const target =
      inside && existsSync(candidate) && statSync(candidate).isFile() ? candidate : join(root, "index.html");
    if (!existsSync(target)) return null;
    return new Response(readFileSync(target), {
      headers: { "content-type": MIME[extname(target)] ?? "application/octet-stream" },
    });
  }

  const errorProblem = (
    req: Request,
    status: number,
    problemOpts: {
      code: string;
      title: string;
      detail: string;
      resolution?: string;
      instance?: string;
      extraHeaders?: Record<string, string>;
    },
  ): Response => {
    const acceptHeader = req.headers.get("accept") ?? "";
    if (acceptHeader.includes("application/problem+json")) {
      return problemResponse(status, problemOpts);
    }
    return json(status, { detail: problemOpts.detail }, problemOpts.extraHeaders);
  };

  const app = new Elysia({ aot: false })
    .onError(({ code, error, request }) => {
      if (code === "PARSE" || error instanceof SyntaxError) {
        return errorProblem(request, 400, {
          code: "invalid_json",
          title: "Bad Request",
          detail: "请求体必须是合法 JSON。",
          resolution: "请检查 JSON 格式是否正确闭合。",
          instance: new URL(request.url).pathname,
        });
      }
      if (code === "NOT_FOUND") {
        return errorProblem(request, 404, {
          code: "not_found",
          title: "Not Found",
          detail: "Not Found",
          resolution: "请查阅 /llms.txt 与 /openapi.json 获取支持的有效路径。",
          instance: new URL(request.url).pathname,
        });
      }
      reportError("request failed", error);
      return errorProblem(request, 500, {
        code: "internal_error",
        title: "Internal Server Error",
        detail: "服务器内部错误。",
        instance: request.url,
      });
    })
    // 题库端点
    .get("/api/science125", ({ request }) => {
      const bank = readScience125();
      if (!bank) {
        return errorProblem(request, 503, {
          code: "science125_unavailable",
          title: "Service Unavailable",
          detail: "Science 125 题库暂不可用。",
          instance: "/api/science125",
        });
      }
      return json(200, bank);
    })
    .get("/api/science125/:id", ({ params, request }) => {
      const id = Number(params.id);
      const q = findQuestion(id);
      if (!q) {
        return errorProblem(request, 404, {
          code: "question_not_found",
          title: "Not Found",
          detail: `Science 125 第 ${id} 题不存在。`,
          instance: `/api/science125/${id}`,
        });
      }
      return json(200, { question: q, formattedText: science125Text(q) });
    })
    // 配置端点
    .get("/api/config", () => {
      return json(200, { runtime: mode, ...modelConfigStatus() });
    })
    .put("/api/config", async ({ body, request }) => {
      if (!authorized(request)) return unauthorized("/api/config", request);
      const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
      if (contentType !== "application/json") {
        return errorProblem(request, 415, {
          code: "unsupported_media_type",
          title: "Unsupported Media Type",
          detail: "Content-Type 必须是 application/json。",
          resolution: "请设置 Content-Type: application/json 请求头。",
          instance: "/api/config",
        });
      }
      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        return errorProblem(request, 400, {
          code: "invalid_body",
          title: "Bad Request",
          detail: "请求体必须是 JSON 对象。",
          resolution: "请传递 JSON 格式的对象参数。",
          instance: "/api/config",
        });
      }
      const parsedBody = body as { api_key?: unknown; model_id?: unknown; base_url?: unknown };
      const next: { apiKey?: string; modelId?: string; baseUrl?: string } = {};
      if (parsedBody.api_key !== undefined) {
        if (typeof parsedBody.api_key !== "string" || parsedBody.api_key.trim() === "") {
          return errorProblem(request, 422, {
            code: "invalid_api_key",
            title: "Unprocessable Entity",
            detail: "api_key 必须是非空字符串。",
            instance: "/api/config",
          });
        }
        const apiKey = parsedBody.api_key.trim();
        if (/^[A-Z][A-Z0-9_]*=[^=]/.test(apiKey)) {
          return errorProblem(request, 422, {
            code: "invalid_api_key_format",
            title: "Unprocessable Entity",
            detail: "api_key 看起来是一整行环境变量（NAME=value）——只粘贴 = 后面的值。",
            instance: "/api/config",
          });
        }
        if (!/^[\x21-\x7E]+$/.test(apiKey)) {
          return errorProblem(request, 422, {
            code: "invalid_api_key_characters",
            title: "Unprocessable Entity",
            detail: "api_key 只能是可打印 ASCII 且不含空格。",
            instance: "/api/config",
          });
        }
        next.apiKey = apiKey;
      }
      if (parsedBody.model_id !== undefined) {
        if (typeof parsedBody.model_id !== "string" || parsedBody.model_id.trim() === "") {
          return errorProblem(request, 422, {
            code: "invalid_model_id",
            title: "Unprocessable Entity",
            detail: "model_id 必须是非空字符串。",
            instance: "/api/config",
          });
        }
        next.modelId = parsedBody.model_id.trim();
      }
      if (parsedBody.base_url !== undefined) {
        if (typeof parsedBody.base_url !== "string" || !/^https?:\/\//.test(parsedBody.base_url.trim())) {
          return errorProblem(request, 422, {
            code: "invalid_base_url",
            title: "Unprocessable Entity",
            detail: "base_url 必须是 http(s) URL。",
            instance: "/api/config",
          });
        }
        try {
          new URL(parsedBody.base_url.trim());
        } catch {
          return errorProblem(request, 422, {
            code: "invalid_base_url",
            title: "Unprocessable Entity",
            detail: "base_url 必须是合法 URL。",
            instance: "/api/config",
          });
        }
        next.baseUrl = parsedBody.base_url.trim();
      }
      if (Object.keys(next).length === 0) {
        return errorProblem(request, 422, {
          code: "empty_configuration_payload",
          title: "Unprocessable Entity",
          detail: "没有可设置的字段（api_key / model_id / base_url）。",
          instance: "/api/config",
        });
      }
      setModelOverride(next);
      return json(200, { runtime: mode, ...modelConfigStatus() });
    })
    // 探针端点
    .get("/api/health", () => json(200, { status: "ok" }))
    .get("/health", () => json(200, { status: "ok" }))
    .get("/api/readyz", () => {
      const databaseReady = store.isReady();
      const modelConfigured = mode === "deterministic" || modelConfigStatus().credential !== "absent";
      const authConfigured = mode === "deterministic" || apiToken !== null;
      const ready = databaseReady && modelConfigured && authConfigured;
      return json(ready ? 200 : 503, {
        status: ready ? "ready" : "not_ready",
        checks: {
          database: databaseReady ? "ok" : "unavailable",
          model: modelConfigured ? "configured" : "missing_credential",
          auth: authConfigured ? "configured" : "missing_api_token",
        },
      });
    })
    .get("/readyz", () => {
      const databaseReady = store.isReady();
      const modelConfigured = mode === "deterministic" || modelConfigStatus().credential !== "absent";
      const authConfigured = mode === "deterministic" || apiToken !== null;
      const ready = databaseReady && modelConfigured && authConfigured;
      return json(ready ? 200 : 503, {
        status: ready ? "ready" : "not_ready",
        checks: {
          database: databaseReady ? "ok" : "unavailable",
          model: modelConfigured ? "configured" : "missing_credential",
          auth: authConfigured ? "configured" : "missing_api_token",
        },
      });
    })
    // 运行任务详细子路由（优先于 /:id 匹配）
    .post("/api/runs/:id/feedback", async ({ body, params, request }) => {
      if (!authorized(request)) return unauthorized(`/api/runs/${params.id}/feedback`, request);
      const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
      if (contentType !== "application/json") {
        return errorProblem(request, 415, {
          code: "unsupported_media_type",
          title: "Unsupported Media Type",
          detail: "Content-Type 必须是 application/json。",
          instance: `/api/runs/${params.id}/feedback`,
        });
      }
      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        return errorProblem(request, 400, {
          code: "invalid_body",
          title: "Bad Request",
          detail: "请求体必须是 JSON 对象。",
          instance: `/api/runs/${params.id}/feedback`,
        });
      }
      const parsedBody = body as { feedback_id?: unknown; feedback?: unknown };
      if (typeof parsedBody.feedback_id !== "string" || typeof parsedBody.feedback !== "string") {
        return errorProblem(request, 422, {
          code: "invalid_feedback_payload",
          title: "Unprocessable Entity",
          detail: "feedback_id 和 feedback 必须是字符串。",
          instance: `/api/runs/${params.id}/feedback`,
        });
      }
      try {
        const accepted = store.submitResearcherFeedback(params.id, {
          id: parsedBody.feedback_id,
          text: parsedBody.feedback,
        });
        return json(202, { status: "queued", feedback_id: accepted.id, round: accepted.round });
      } catch (error) {
        if (error instanceof FeedbackSubmissionError) {
          const status = error.code === "not_found" ? 404 : error.code === "invalid" ? 422 : 409;
          return errorProblem(request, status, {
            code: `feedback_${error.code}`,
            title: status === 404 ? "Not Found" : status === 409 ? "Conflict" : "Unprocessable Entity",
            detail: error.message,
            instance: `/api/runs/${params.id}/feedback`,
          });
        }
        throw error;
      }
    })
    .get("/api/runs/:id/events", ({ params, request }) => {
      const runId = params.id;
      if (!store.snapshot(runId)) {
        return errorProblem(request, 404, {
          code: "run_not_found",
          title: "Not Found",
          detail: "Run 不存在。",
          instance: `/api/runs/${runId}/events`,
        });
      }
      const header = request.headers.get("last-event-id");
      const url = new URL(request.url);
      const cursor = parseCursor(header ?? url.searchParams.get("after"));
      if (cursor === null) {
        return errorProblem(request, 400, {
          code: "invalid_cursor",
          title: "Bad Request",
          detail: "游标必须是整数。",
          instance: `/api/runs/${runId}/events`,
        });
      }
      return streamEvents(request, runId, cursor);
    })
    // 运行任务主入口
    .post("/api/runs", async ({ body, request }) => {
      if (!authorized(request)) return unauthorized("/api/runs", request);
      if (mode === "live" && modelConfigStatus().credential === "absent") {
        return errorProblem(request, 503, {
          code: "missing_model_credentials",
          title: "Service Unavailable",
          detail: "live 模式缺少模型凭据，Run 未创建。",
          resolution: "请配置 QWEN_API_KEY 环境变量或使用 PUT /api/config 设置 API Key。",
          instance: "/api/runs",
          extraHeaders: { "retry-after": "1" },
        });
      }
      if (activeRuns + queue.length >= maxQueuedRuns) {
        return errorProblem(request, 429, {
          code: "rate_limit_exceeded",
          title: "Too Many Requests",
          detail: "运行队列已满，请稍后重试。",
          resolution: "请等待前序任务执行完毕后重试。",
          instance: "/api/runs",
          extraHeaders: {
            "retry-after": "1",
            "ratelimit-policy": `${maxQueuedRuns};w=60`,
            ratelimit: `limit=${maxQueuedRuns}, remaining=0, reset=1`,
          },
        });
      }
      const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
      if (contentType !== "application/json") {
        return errorProblem(request, 415, {
          code: "unsupported_media_type",
          title: "Unsupported Media Type",
          detail: "Content-Type 必须是 application/json。",
          resolution: "请在请求头中指定 Content-Type: application/json。",
          instance: "/api/runs",
        });
      }
      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        return errorProblem(request, 400, {
          code: "invalid_body",
          title: "Bad Request",
          detail: "请求体必须是 JSON 对象。",
          instance: "/api/runs",
        });
      }
      const parsedBody = body as { question?: unknown };
      if (typeof parsedBody.question !== "string") {
        return errorProblem(request, 422, {
          code: "invalid_question_type",
          title: "Unprocessable Entity",
          detail: "question 必须是非空字符串。",
          instance: "/api/runs",
        });
      }
      const question = normalizeQuestion(parsedBody.question);
      if (question === "") {
        return errorProblem(request, 422, {
          code: "empty_question",
          title: "Unprocessable Entity",
          detail: "question 必须是非空字符串。",
          instance: "/api/runs",
        });
      }
      if (question.length > MAX_QUESTION_LENGTH) {
        return errorProblem(request, 422, {
          code: "question_too_long",
          title: "Unprocessable Entity",
          detail: `question 不能超过 ${MAX_QUESTION_LENGTH} 个字符。`,
          instance: "/api/runs",
        });
      }
      const runId = harness.createRun(question);
      schedule(runId);
      return json(202, projectRunSnapshot(store.snapshot(runId)!), {
        "ratelimit-policy": `${maxQueuedRuns};w=60`,
        ratelimit: `limit=${maxQueuedRuns}, remaining=${Math.max(0, maxQueuedRuns - activeRuns - queue.length)}, reset=1`,
      });
    })
    .get("/api/runs/:id", ({ params, request }) => {
      const snapshot = store.snapshot(params.id);
      if (!snapshot) {
        return errorProblem(request, 404, {
          code: "run_not_found",
          title: "Not Found",
          detail: "Run 不存在。",
          resolution: "请检查 Run ID 是否正确，或重新调用 POST /api/runs 创建新任务。",
          instance: `/api/runs/${params.id}`,
        });
      }
      return json(200, projectRunSnapshot(snapshot));
    })
    // 产物端点
    .get("/api/artifacts/:id/markdown", ({ params, request }) => {
      const artifact = store.artifact(params.id);
      if (!artifact) {
        return errorProblem(request, 404, {
          code: "artifact_not_found",
          title: "Not Found",
          detail: "Artifact 不存在。",
          instance: `/api/artifacts/${params.id}/markdown`,
        });
      }
      const projected = projectArtifact(artifact);
      if (projected.content.artifact_type !== "research-plan") {
        return errorProblem(request, 404, {
          code: "artifact_not_markdown_capable",
          title: "Not Found",
          detail: "该 Artifact 没有 Markdown 投影。",
          instance: `/api/artifacts/${params.id}/markdown`,
        });
      }
      const markdown = renderResearchPlanMarkdown(projected.content);
      return new Response(markdown, {
        headers: { "content-type": "text/markdown; charset=utf-8", vary: "Accept" },
      });
    })
    .get("/api/artifacts/:id", ({ params, request }) => {
      const artifact = store.artifact(params.id);
      if (!artifact) {
        return errorProblem(request, 404, {
          code: "artifact_not_found",
          title: "Not Found",
          detail: "Artifact 不存在。",
          instance: `/api/artifacts/${params.id}`,
        });
      }
      return json(200, projectArtifact(artifact));
    })
    // 静态文件与 SPA / 404 兜底
    .get("*", ({ request }) => {
      const url = new URL(request.url);
      const path = url.pathname;
      const staticResponse = path !== "/api" && !path.startsWith("/api/") ? serveStatic(path) : null;
      return (
        staticResponse ??
        errorProblem(request, 404, {
          code: "not_found",
          title: "Not Found",
          detail: "Not Found",
          instance: path,
        })
      );
    });

  return app;
}

export type App = ReturnType<typeof createElysiaApp>;

export function createApp(options: ServerOptions): LuupServer {
  const reportError = options.reportError ?? ((message, error) => console.error(message, error));
  const app = createElysiaApp(options);

  const fetchHandler = async (req: Request): Promise<Response> => {
    try {
      return applySecurityHeaders(await app.fetch(req));
    } catch (error) {
      reportError("request failed", error);
      const acceptHeader = req.headers.get("accept") ?? "";
      if (acceptHeader.includes("application/problem+json")) {
        return applySecurityHeaders(
          problemResponse(500, {
            code: "internal_error",
            title: "Internal Server Error",
            detail: "服务器内部错误。",
            instance: req.url,
          }),
        );
      }
      return applySecurityHeaders(json(500, { detail: "服务器内部错误。" }));
    }
  };

  const hostname = options.hostname ?? "127.0.0.1";
  const port = options.port ?? 0;

  const nodeServer = serve({
    fetch: fetchHandler,
    hostname,
    port,
  });

  const ready = new Promise<void>((resolvePromise) => {
    if (nodeServer.listening) resolvePromise();
    else nodeServer.once("listening", resolvePromise);
  });

  return {
    ready,
    get port(): number {
      const address = nodeServer.address();
      return typeof address === "object" && address ? address.port : port;
    },
    hostname,
    get url(): URL {
      const address = nodeServer.address();
      const actualPort = typeof address === "object" && address ? address.port : port;
      return new URL(`http://${hostname === "0.0.0.0" ? "127.0.0.1" : hostname}:${actualPort}`);
    },
    stop: async (closeActiveConnections?: boolean) => {
      return new Promise<void>((resolvePromise, rejectPromise) => {
        if (closeActiveConnections && typeof (nodeServer as any).closeAllConnections === "function") {
          (nodeServer as any).closeAllConnections();
        }
        nodeServer.close((err) => {
          if (err) rejectPromise(err);
          else resolvePromise();
        });
      });
    },
    fetch: fetchHandler,
    rawServer: nodeServer,
  };
}

export function createDefaultApp(options: Pick<ServerOptions, "hostname" | "port"> = {}) {
  const store = new SqliteStore(process.env.LUUP_DATABASE || "outputs/runtime/typescript-runs.db");
  const mode = runtimeMode();
  const deterministic = mode === "deterministic";
  const runtime = deterministic ? createDeterministicRuntime(store) : null;
  const harness = new Harness(
    store,
    runtime ? runtime.execute : createQwenExecutor(),
    runtime ? { createLedger: runtime.createLedger, verifyReferences: createDeterministicVerifier() } : {},
  );
  return createApp({
    store,
    harness,
    runtime: mode,
    webDist: process.env.LUUP_WEB_DIST || "apps/web/dist/client",
    hostname: options.hostname,
    port: options.port,
  });
}

export function runtimeMode(raw: string | undefined = process.env.LUUP_RUNTIME): "live" | "deterministic" {
  const mode = raw || "live";
  if (mode !== "live" && mode !== "deterministic") {
    throw new Error("LUUP_RUNTIME must be live or deterministic");
  }
  return mode;
}
