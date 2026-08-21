import { existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";

import { renderResearchPlanMarkdown } from "./api/artifact-markdown.ts";
import { projectArtifact, projectRunSnapshot, projectSseFrame } from "./api/projection.ts";
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
};

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

function json(status: number, body: unknown, extraHeaders: Record<string, string> = {}): Response {
  return Response.json(body, {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...extraHeaders },
  });
}

async function readJson(req: Request): Promise<unknown> {
  const text = await req.text();
  return text === "" ? {} : JSON.parse(text);
}

/** 严格解析游标。`parseInt("1e3")` 会得到 1、`Number("")` 会得到 0，两个都不是我们要的。 */
function parseCursor(raw: string | null): number | null {
  if (raw === null || raw.trim() === "") return 0;
  if (!/^\d+$/.test(raw.trim())) return null;
  const cursor = Number(raw.trim());
  return Number.isSafeInteger(cursor) ? cursor : null;
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

export function createApp(options: ServerOptions) {
  const { store, harness } = options;
  const mode = options.runtime ?? runtimeMode();
  const reportError = options.reportError ?? ((message, error) => console.error(message, error));
  // 两个槽足够演示并发，也不会让一批请求同时放大成无上限的付费模型调用。
  const maxConcurrentRuns = 2;
  const apiToken = process.env.LUUP_API_TOKEN?.trim() || null;
  const configuredQueueLimit = Number(process.env.LUUP_MAX_QUEUED_RUNS ?? 8);
  const maxQueuedRuns =
    Number.isSafeInteger(configuredQueueLimit) && configuredQueueLimit > 0 ? configuredQueueLimit : 8;
  const scheduled = new Set<string>();
  const queue: string[] = [];
  let activeRuns = 0;

  const unauthorized = (): Response =>
    json(401, { detail: "需要 API token。" }, { "www-authenticate": 'Bearer realm="luup"' });
  const authorized = (req: Request): boolean => {
    if (apiToken === null) return mode === "deterministic";
    return req.headers.get("authorization") === `Bearer ${apiToken}`;
  };

  const drain = (): void => {
    while (activeRuns < maxConcurrentRuns && queue.length > 0) {
      const runId = queue.shift()!;
      activeRuns += 1;
      void harness
        .execute(runId)
        // Harness 会把正常的阶段失败落库；这里仅兜住它自身意外抛出的异常。
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
            // 客户端主动断开时 controller 可能已经被底层关闭；这不是业务错误。
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
                const frame = projectSseFrame(event as any);
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
          // replay、JSON/project schema 或 enqueue 任一环节失败都必须留下诊断，且不能
          // 让客户端只看到一个无法解释的 EOF。
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
    // 分量级包含检查：`join` 之后再比前缀会把 `/dist-evil` 误判成在 `/dist` 里。
    const candidate = resolve(join(root, normalize(pathname)));
    const inside = candidate === root || candidate.startsWith(root + (process.platform === "win32" ? "\\" : "/"));
    const target =
      inside && existsSync(candidate) && statSync(candidate).isFile() ? candidate : join(root, "index.html");
    if (!existsSync(target)) return null;
    return new Response(Bun.file(target), {
      headers: { "content-type": MIME[extname(target)] ?? "application/octet-stream" },
    });
  }

  return Bun.serve({
    hostname: options.hostname ?? "127.0.0.1",
    port: options.port ?? 0,
    async fetch(req) {
      try {
        let url: URL;
        try {
          url = new URL(req.url ?? "/", "http://localhost");
        } catch {
          return json(400, { detail: "请求 URL 不合法。" });
        }
        const path = url.pathname;
        const method = req.method ?? "GET";

        if (path === "/api/config") {
          // 设置面（学 dsh：环境变量是默认，页面可即时补配）。密钥只进不出：
          // GET/PUT 的响应都只报三态状态，key 本体不出网、不落盘、重启即忘。
          if (method === "GET") {
            return json(200, { runtime: mode, ...modelConfigStatus() });
          }
          if (method === "PUT") {
            if (!authorized(req)) return unauthorized();
            const contentType = req.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
            // 与 POST /api/runs 同一条 CORS 纪律：这里收的是密钥，更不能吃 simple request。
            if (contentType !== "application/json") {
              return json(415, { detail: "Content-Type 必须是 application/json。" });
            }
            let body: { api_key?: unknown; model_id?: unknown; base_url?: unknown };
            try {
              const parsed = await readJson(req);
              if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
                return json(400, { detail: "请求体必须是 JSON 对象。" });
              }
              body = parsed;
            } catch {
              return json(400, { detail: "请求体必须是合法 JSON。" });
            }
            const next: { apiKey?: string; modelId?: string; baseUrl?: string } = {};
            if (body.api_key !== undefined) {
              if (typeof body.api_key !== "string" || body.api_key.trim() === "") {
                return json(422, { detail: "api_key 必须是非空字符串。" });
              }
              const apiKey = body.api_key.trim();
              // 从 .env 整行复制是高频错误（学 dsh apiKey.ts 的启发式）：名字全大写、
              // `=` 后非 `=`——`sk-` 形式在连字符处断开、base64 padding 不会误判。
              if (/^[A-Z][A-Z0-9_]*=[^=]/.test(apiKey)) {
                return json(422, { detail: "api_key 看起来是一整行环境变量（NAME=value）——只粘贴 = 后面的值。" });
              }
              if (!/^[\x21-\x7E]+$/.test(apiKey)) {
                return json(422, { detail: "api_key 只能是可打印 ASCII 且不含空格。" });
              }
              next.apiKey = apiKey;
            }
            if (body.model_id !== undefined) {
              if (typeof body.model_id !== "string" || body.model_id.trim() === "") {
                return json(422, { detail: "model_id 必须是非空字符串。" });
              }
              next.modelId = body.model_id.trim();
            }
            if (body.base_url !== undefined) {
              if (typeof body.base_url !== "string" || !/^https?:\/\//.test(body.base_url.trim())) {
                return json(422, { detail: "base_url 必须是 http(s) URL。" });
              }
              try {
                new URL(body.base_url.trim());
              } catch {
                return json(422, { detail: "base_url 必须是合法 URL。" });
              }
              next.baseUrl = body.base_url.trim();
            }
            if (Object.keys(next).length === 0) {
              return json(422, { detail: "没有可设置的字段（api_key / model_id / base_url）。" });
            }
            setModelOverride(next);
            return json(200, { runtime: mode, ...modelConfigStatus() });
          }
        }

        if (method === "GET" && (path === "/api/health" || path === "/health")) {
          return json(200, { status: "ok" });
        }

        if (method === "GET" && (path === "/api/readyz" || path === "/readyz")) {
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
        }

        if (method === "POST" && path === "/api/runs") {
          if (!authorized(req)) return unauthorized();
          if (mode === "live" && modelConfigStatus().credential === "absent") {
            return json(503, { detail: "live 模式缺少模型凭据，Run 未创建。" }, { "retry-after": "1" });
          }
          if (activeRuns + queue.length >= maxQueuedRuns) {
            return json(429, { detail: "运行队列已满，请稍后重试。" }, { "retry-after": "1" });
          }
          const contentType = req.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
          // application/json 会触发浏览器 CORS 预检；拒绝 text/plain 等 simple request，
          // 避免恶意网页在读不到响应的情况下仍让 localhost 启动付费 Run。
          if (contentType !== "application/json") {
            return json(415, { detail: "Content-Type 必须是 application/json。" });
          }
          let body: { question?: unknown };
          try {
            const parsed = await readJson(req);
            if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
              return json(400, { detail: "请求体必须是 JSON 对象。" });
            }
            body = parsed as { question?: unknown };
          } catch {
            return json(400, { detail: "请求体必须是合法 JSON。" });
          }
          if (typeof body.question !== "string") {
            return json(422, { detail: "question 必须是非空字符串。" });
          }
          const question = normalizeQuestion(body.question);
          if (question === "") {
            return json(422, { detail: "question 必须是非空字符串。" });
          }
          if (question.length > MAX_QUESTION_LENGTH) {
            return json(422, { detail: `question 不能超过 ${MAX_QUESTION_LENGTH} 个字符。` });
          }
          const runId = harness.createRun(question);
          schedule(runId);
          // 202：Run 已建立，执行在后台推进，客户端靠 SSE 跟进度。
          return json(202, projectRunSnapshot(store.snapshot(runId)!));
        }

        const runMatch = /^\/api\/runs\/([A-Za-z0-9]+)$/.exec(path);
        if (method === "GET" && runMatch) {
          const snapshot = store.snapshot(runMatch[1]!);
          if (!snapshot) return json(404, { detail: "Run 不存在。" });
          return json(200, projectRunSnapshot(snapshot));
        }

        const feedbackMatch = /^\/api\/runs\/([A-Za-z0-9]+)\/feedback$/.exec(path);
        if (method === "POST" && feedbackMatch) {
          if (!authorized(req)) return unauthorized();
          const contentType = req.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
          if (contentType !== "application/json") {
            return json(415, { detail: "Content-Type 必须是 application/json。" });
          }
          let body: { feedback_id?: unknown; feedback?: unknown };
          try {
            const parsed = await readJson(req);
            if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
              return json(400, { detail: "请求体必须是 JSON 对象。" });
            }
            body = parsed;
          } catch {
            return json(400, { detail: "请求体必须是合法 JSON。" });
          }
          if (typeof body.feedback_id !== "string" || typeof body.feedback !== "string") {
            return json(422, { detail: "feedback_id 和 feedback 必须是字符串。" });
          }
          try {
            const accepted = store.submitResearcherFeedback(feedbackMatch[1]!, {
              id: body.feedback_id,
              text: body.feedback,
            });
            return json(202, { status: "queued", feedback_id: accepted.id, round: accepted.round });
          } catch (error) {
            if (error instanceof FeedbackSubmissionError) {
              const status = error.code === "not_found" ? 404 : error.code === "invalid" ? 422 : 409;
              return json(status, { detail: error.message });
            }
            throw error;
          }
        }

        const eventsMatch = /^\/api\/runs\/([A-Za-z0-9]+)\/events$/.exec(path);
        if (method === "GET" && eventsMatch) {
          const runId = eventsMatch[1]!;
          if (!store.snapshot(runId)) return json(404, { detail: "Run 不存在。" });
          // 浏览器重连时自动带 Last-Event-ID，它比 query 更准。
          const header = req.headers.get("last-event-id");
          const cursor = parseCursor(header ?? url.searchParams.get("after"));
          if (cursor === null) return json(400, { detail: "游标必须是整数。" });
          return streamEvents(req, runId, cursor);
        }

        const artifactMarkdownMatch = /^\/api\/artifacts\/([A-Za-z0-9]+)\/markdown$/.exec(path);
        if (method === "GET" && artifactMarkdownMatch) {
          const artifact = store.artifact(artifactMarkdownMatch[1]!);
          if (!artifact) return json(404, { detail: "Artifact 不存在。" });
          const projected = projectArtifact(artifact);
          if (projected.content.artifact_type !== "research-plan") {
            return json(404, { detail: "该 Artifact 没有 Markdown 投影。" });
          }
          const markdown = renderResearchPlanMarkdown(projected.content);
          return new Response(markdown, { headers: { "content-type": "text/markdown; charset=utf-8" } });
        }

        const artifactMatch = /^\/api\/artifacts\/([A-Za-z0-9]+)$/.exec(path);
        if (method === "GET" && artifactMatch) {
          const artifact = store.artifact(artifactMatch[1]!);
          if (!artifact) return json(404, { detail: "Artifact 不存在。" });
          return json(200, projectArtifact(artifact));
        }

        // `/api` 是严格的 JSON 边界，拼错接口不能静默得到 SPA 的 index.html。
        const staticResponse =
          method === "GET" && path !== "/api" && !path.startsWith("/api/") ? serveStatic(path) : null;
        return staticResponse ?? json(404, { detail: "Not Found" });
      } catch (error) {
        // 浏览器边界只给固定消息；原始异常可能包含 SQLite、provider 或本地路径细节。
        reportError("request failed", error);
        return json(500, { detail: "服务器内部错误。" });
      }
    },
  });
}

export function createDefaultApp(options: Pick<ServerOptions, "hostname" | "port"> = {}) {
  // Python 旧栈也曾使用 runs.db，但两边 schema 不兼容；换文件名比写一次性迁移更适合 MVP。
  const store = new SqliteStore(process.env.LUUP_DATABASE || "outputs/runtime/typescript-runs.db");
  const mode = runtimeMode();
  const deterministic = mode === "deterministic";
  const runtime = deterministic ? createDeterministicRuntime(store) : null;
  const harness = new Harness(
    store,
    // 用量不在这里落库：executor 把它交还给 runTask，harness 每个 Attempt 落一条
    // `sdk.usage`。这里再挂一个写库回调就是双写 —— 失败的 Attempt 会被记两遍，
    // 纠错轮还会把同一个 Attempt 拆成两条。
    runtime ? runtime.execute : createQwenExecutor(),
    // 确定性模式连引用验收也不打网络：它的来源是写死的，反查替身与之同源。
    runtime ? { createLedger: runtime.createLedger, verifyReferences: createDeterministicVerifier() } : {},
  );
  return createApp({
    store,
    harness,
    runtime: mode,
    webDist: process.env.LUUP_WEB_DIST || "apps/web/dist",
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
