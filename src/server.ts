import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

import { projectArtifact, projectRunSnapshot, projectSseFrame } from "./api/projection.ts";
import { createDeterministicRuntime, createDeterministicVerifier } from "./executors/deterministic.ts";
import { createQwenExecutor, type StageMetrics } from "./executor.ts";
import { Harness } from "./harness.ts";
import { MAX_QUESTION_LENGTH, normalizeQuestion, SqliteStore } from "./store/store.ts";

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

function json(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
  });
  res.end(text);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/** 严格解析游标。`parseInt("1e3")` 会得到 1、`Number("")` 会得到 0，两个都不是我们要的。 */
function parseCursor(raw: string | null): number | null {
  if (raw === null || raw.trim() === "") return 0;
  if (!/^\d+$/.test(raw.trim())) return null;
  return Number(raw.trim());
}

export type ServerOptions = {
  store: SqliteStore;
  harness: Harness;
  webDist?: string;
};

export function createApp(options: ServerOptions) {
  const { store, harness } = options;
  // 两个槽足够演示并发，也不会让一批请求同时放大成无上限的付费模型调用。
  const maxConcurrentRuns = 2;
  const scheduled = new Set<string>();
  const queue: string[] = [];
  let activeRuns = 0;

  const drain = (): void => {
    while (activeRuns < maxConcurrentRuns && queue.length > 0) {
      const runId = queue.shift()!;
      activeRuns += 1;
      void harness.execute(runId)
        // Harness 会把正常的阶段失败落库；这里仅兜住它自身意外抛出的异常。
        .catch(() => store.finishRun(runId, "failed", { errorCode: "runtime_error" }))
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

  async function streamEvents(
    req: IncomingMessage,
    res: ServerResponse,
    runId: string,
    from: number,
  ): Promise<void> {
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });

    // 客户端断开在 Node 里不会自己中断这个循环 —— Python 靠生成器被 GC/CancelledError 收掉，
    // 这里必须显式监听，否则会泄漏一个每 100ms 查一次库的死循环。
    let closed = false;
    req.on("close", () => { closed = true; });

    let cursor = from;
    let idle = 0;
    while (!closed) {
      const events = store.eventsAfter(runId, cursor);
      if (events.length > 0) {
        for (const event of events) {
          const frame = projectSseFrame(event as any);
          // 隐藏事件不出网，但游标照样推进 —— 否则会在它上面原地打转。
          if (frame !== null) res.write(frame);
        }
        cursor = Number(events.at(-1)!.version);
        idle = 0;
        continue;
      }
      const snapshot = store.snapshot(runId);
      if (!snapshot || TERMINAL.has(String(snapshot.status))) break;
      idle += 1;
      if (idle % KEEP_ALIVE_TICKS === 0) res.write(": keep-alive\n\n");
      await sleep(POLL_MS);
    }
    res.end();
  }

  function serveStatic(res: ServerResponse, pathname: string): boolean {
    const dist = options.webDist;
    if (!dist) return false;
    const root = resolve(dist);
    // 分量级包含检查：`join` 之后再比前缀会把 `/dist-evil` 误判成在 `/dist` 里。
    const candidate = resolve(join(root, normalize(pathname)));
    const inside = candidate === root
      || candidate.startsWith(root + (process.platform === "win32" ? "\\" : "/"));
    const target = inside && existsSync(candidate) && statSync(candidate).isFile()
      ? candidate
      : join(root, "index.html");
    if (!existsSync(target)) return false;
    const stream = createReadStream(target);
    // stat 与异步 open 之间文件仍可能被替换；stream error 不监听会直接终止 Node 进程。
    stream.on("error", () => {
      if (res.headersSent) res.destroy();
      else json(res, 500, { detail: "静态文件读取失败。" });
    });
    stream.on("open", () => {
      res.writeHead(200, { "content-type": MIME[extname(target)] ?? "application/octet-stream" });
      stream.pipe(res);
    });
    return true;
  }

  return createServer((req, res) => {
    void (async () => {
      try {
        let url: URL;
        try {
          url = new URL(req.url ?? "/", "http://localhost");
        } catch {
          return json(res, 400, { detail: "请求 URL 不合法。" });
        }
        const path = url.pathname;
        const method = req.method ?? "GET";

        if (method === "GET" && (path === "/api/health" || path === "/health")) {
          return json(res, 200, { status: "ok" });
        }

        if (method === "POST" && path === "/api/runs") {
          const contentType = req.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
          // application/json 会触发浏览器 CORS 预检；拒绝 text/plain 等 simple request，
          // 避免恶意网页在读不到响应的情况下仍让 localhost 启动付费 Run。
          if (contentType !== "application/json") {
            return json(res, 415, { detail: "Content-Type 必须是 application/json。" });
          }
          let body: { question?: unknown };
          try {
            const parsed = await readJson(req);
            if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
              return json(res, 400, { detail: "请求体必须是 JSON 对象。" });
            }
            body = parsed as { question?: unknown };
          } catch {
            return json(res, 400, { detail: "请求体必须是合法 JSON。" });
          }
          if (typeof body.question !== "string") {
            return json(res, 422, { detail: "question 必须是非空字符串。" });
          }
          const question = normalizeQuestion(body.question);
          if (question === "") {
            return json(res, 422, { detail: "question 必须是非空字符串。" });
          }
          if (question.length > MAX_QUESTION_LENGTH) {
            return json(res, 422, { detail: `question 不能超过 ${MAX_QUESTION_LENGTH} 个字符。` });
          }
          const runId = harness.createRun(question);
          schedule(runId);
          // 202：Run 已建立，执行在后台推进，客户端靠 SSE 跟进度。
          return json(res, 202, projectRunSnapshot(store.snapshot(runId)!));
        }

        const runMatch = /^\/api\/runs\/([A-Za-z0-9]+)$/.exec(path);
        if (method === "GET" && runMatch) {
          const snapshot = store.snapshot(runMatch[1]!);
          if (!snapshot) return json(res, 404, { detail: "Run 不存在。" });
          return json(res, 200, projectRunSnapshot(snapshot));
        }

        const eventsMatch = /^\/api\/runs\/([A-Za-z0-9]+)\/events$/.exec(path);
        if (method === "GET" && eventsMatch) {
          const runId = eventsMatch[1]!;
          if (!store.snapshot(runId)) return json(res, 404, { detail: "Run 不存在。" });
          // 浏览器重连时自动带 Last-Event-ID，它比 query 更准。
          const header = req.headers["last-event-id"];
          const cursor = parseCursor(
            typeof header === "string" ? header : url.searchParams.get("after"),
          );
          if (cursor === null) return json(res, 400, { detail: "游标必须是整数。" });
          return await streamEvents(req, res, runId, cursor);
        }

        const artifactMatch = /^\/api\/artifacts\/([A-Za-z0-9]+)$/.exec(path);
        if (method === "GET" && artifactMatch) {
          const artifact = store.artifact(artifactMatch[1]!);
          if (!artifact) return json(res, 404, { detail: "Artifact 不存在。" });
          return json(res, 200, projectArtifact(artifact));
        }

        // `/api` 是严格的 JSON 边界，拼错接口不能静默得到 SPA 的 index.html。
        if (method === "GET" && path !== "/api" && !path.startsWith("/api/") && serveStatic(res, path)) return;
        return json(res, 404, { detail: "Not Found" });
      } catch (error) {
        // 浏览器边界只给固定消息；原始异常可能包含 SQLite、provider 或本地路径细节。
        console.error("request failed", error);
        if (res.headersSent) return res.end();
        return json(res, 500, { detail: "服务器内部错误。" });
      }
    })();
  });
}

export function createDefaultApp() {
  // Python 旧栈也曾使用 runs.db，但两边 schema 不兼容；换文件名比写一次性迁移更适合 MVP。
  const store = new SqliteStore(process.env.LUUP_DATABASE || "outputs/runtime/typescript-runs.db");
  const deterministic = runtimeMode() === "deterministic";
  const runtime = deterministic ? createDeterministicRuntime(store) : null;
  const harness = new Harness(
    store,
    runtime ? runtime.execute : createQwenExecutor((metrics) => persistUsage(store, metrics)),
    // 确定性模式连引用验收也不打网络：它的来源是写死的，反查替身与之同源。
    runtime
      ? { createLedger: runtime.createLedger, verifyReferences: createDeterministicVerifier() }
      : {},
  );
  return createApp({ store, harness, webDist: process.env.LUUP_WEB_DIST || "frontend-ts/dist" });
}

export function runtimeMode(raw: string | undefined = process.env.LUUP_RUNTIME): "live" | "deterministic" {
  const mode = raw || "live";
  if (mode !== "live" && mode !== "deterministic") {
    throw new Error("LUUP_RUNTIME must be live or deterministic");
  }
  return mode;
}

/** 每次 SDK 调用成功就记一条事件。SDK 没提供的字段不猜，也不补假数据。 */
export function persistUsage(store: SqliteStore, metrics: StageMetrics): void {
  store.emit(metrics.runId, "sdk.usage", {
    agent: metrics.role,
    input_tokens: metrics.inputTokens,
    output_tokens: metrics.outputTokens,
    total_tokens: metrics.totalTokens,
  });
}
