/** Sign in with ChatGPT（SIWC）凭据通道（ADR-0017）。
 *
 * 不是新 ProviderId：只给 `openai` 提供 ChatGPT plan usage 的 access token。
 * 协议自行实现（`@siwc/local` 在 npm 404），零额外依赖。
 */

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { chmodSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const SIWC_AUTH_ORIGIN = "https://auth.openai.com";
export const SIWC_AUTHORIZE_URL = `${SIWC_AUTH_ORIGIN}/api/accounts/authorize`;
export const SIWC_TOKEN_URL = `${SIWC_AUTH_ORIGIN}/api/accounts/oauth/token`;
export const SIWC_API_ORIGIN = "https://api.openai.com/v1";
export const SIWC_RESOURCE = SIWC_API_ORIGIN;
export const SIWC_DYNAMIC_CLIENT_ID = "dynamic_agent_client";
export const SIWC_CALLBACK_PATH = "/auth/callback";
export const SIWC_DEFAULT_AGENT_NAME_HINT = "Luup";
export const SIWC_OAUTH_SCOPE = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";

const DEFAULT_CREDENTIAL_PATH = join("outputs", "runtime", "siwc-session.json");
const DEFAULT_HOST_ID_PATH = join("outputs", "runtime", "siwc-host-id");
const REFRESH_AHEAD_MS = 5 * 60 * 1000;
const OAUTH_CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;

export type SiwcStatus = {
  signed_in: boolean;
  email: string | null;
  expires_at: number | null;
  client_id_present: boolean;
};

export type SiwcSession = {
  version: 1;
  clientId: string;
  hostId: string;
  email: string | null;
  subject: string | null;
  accessToken: string;
  refreshToken: string | null;
  idToken: string | null;
  expiresAt: number;
  earliestRefreshAt: number | null;
  scopes: string[];
  savedAt: string;
};

export type SiwcDeps = {
  fetch?: typeof globalThis.fetch;
  credentialPath?: string;
  hostIdPath?: string;
  openAuthorize?: (url: string) => void | Promise<void>;
  now?: () => number;
  /** 测试用：跳过真实 listen，注入已就绪的 redirect / callback。 */
  startLoopback?: (expectedState: string) => Promise<LoopbackListener>;
};

export type LoopbackListener = {
  redirectUri: string;
  result: Promise<{ code?: string; clientId?: string | null; error?: string; timeout?: boolean }>;
  close: () => void;
};

type LoginHandle = {
  cancel: () => void;
  done: Promise<{ authorize_url: string; redirect_uri: string }>;
};

let deps: SiwcDeps = {};
let loginInFlight: LoginHandle | null = null;
let refreshInFlight: Promise<string | null> | null = null;
/** 登出 / reset 时递增；进行中的 refresh 落盘前对照，避免把已注销会话写回。 */
let sessionEpoch = 0;

class SiwcLoginCancelledError extends Error {
  constructor() {
    super("SIWC login cancelled");
    this.name = "SiwcLoginCancelledError";
  }
}

export function configureSiwc(next: SiwcDeps): void {
  deps = { ...deps, ...next };
}

/** 测试 / 进程重启后清模块态（不清磁盘）。 */
export function resetSiwcRuntimeState(): void {
  if (loginInFlight) {
    loginInFlight.cancel();
    loginInFlight = null;
  }
  refreshInFlight = null;
  sessionEpoch += 1;
  deps = {};
}

function credentialPath(): string {
  return deps.credentialPath || process.env.LUUP_SIWC_SESSION || DEFAULT_CREDENTIAL_PATH;
}

function hostIdPath(): string {
  return deps.hostIdPath || process.env.LUUP_SIWC_HOST_ID || DEFAULT_HOST_ID_PATH;
}

function nowMs(): number {
  return deps.now ? deps.now() : Date.now();
}

function fetchImpl(): typeof globalThis.fetch {
  return deps.fetch || globalThis.fetch.bind(globalThis);
}

function ensureOwnerOnlyFile(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, body, { mode: 0o600 });
  try {
    chmodSync(tmp, 0o600);
  } catch {
    /* Windows / 某些 FS 忽略 mode */
  }
  renameSync(tmp, path);
  try {
    chmodSync(path, 0o600);
  } catch {
    /* ignore */
  }
}

function readSession(): SiwcSession | null {
  try {
    const raw = JSON.parse(readFileSync(credentialPath(), "utf8")) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const data = raw as Record<string, unknown>;
    if (data.version !== 1) return null;
    if (typeof data.clientId !== "string" || typeof data.accessToken !== "string") return null;
    if (typeof data.expiresAt !== "number" || !Number.isFinite(data.expiresAt)) return null;
    if (typeof data.hostId !== "string") return null;
    return {
      version: 1,
      clientId: data.clientId,
      hostId: data.hostId,
      email: typeof data.email === "string" ? data.email : null,
      subject: typeof data.subject === "string" ? data.subject : null,
      accessToken: data.accessToken,
      refreshToken: typeof data.refreshToken === "string" ? data.refreshToken : null,
      idToken: typeof data.idToken === "string" ? data.idToken : null,
      expiresAt: data.expiresAt,
      earliestRefreshAt: typeof data.earliestRefreshAt === "number" ? data.earliestRefreshAt : null,
      scopes: Array.isArray(data.scopes) ? data.scopes.filter((s): s is string => typeof s === "string") : [],
      savedAt: typeof data.savedAt === "string" ? data.savedAt : new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

function writeSession(session: SiwcSession): void {
  ensureOwnerOnlyFile(credentialPath(), `${JSON.stringify(session, null, 2)}\n`);
}

function ensureHostId(): string {
  try {
    const existing = readFileSync(hostIdPath(), "utf8").trim();
    if (/^urn:uuid:[0-9a-f-]{36}$/i.test(existing)) return existing;
  } catch {
    /* create */
  }
  const hostId = `urn:uuid:${randomUUID()}`;
  ensureOwnerOnlyFile(hostIdPath(), `${hostId}\n`);
  return hostId;
}

function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

function newOpaque(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}

export function buildSiwcAuthorizeUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  nonce: string;
  codeChallenge: string;
  hostId: string;
  agentNameHint?: string;
}): string {
  const url = new URL(SIWC_AUTHORIZE_URL);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("scope", SIWC_OAUTH_SCOPE);
  url.searchParams.set("resource", SIWC_RESOURCE);
  url.searchParams.set("state", input.state);
  url.searchParams.set("nonce", input.nonce);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("ext_agent_host_id", input.hostId);
  if (input.clientId === SIWC_DYNAMIC_CLIENT_ID && input.agentNameHint) {
    url.searchParams.set("agent_name_hint", input.agentNameHint);
  }
  return url.toString();
}

function formBody(fields: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== "") params.set(key, value);
  }
  return params.toString();
}

function parseEarliestRefreshAt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === "string" && value.length > 0) {
    const asNumber = Number(value);
    if (Number.isFinite(asNumber) && asNumber > 0) return asNumber < 1e12 ? asNumber * 1000 : asNumber;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function parseTokenResponse(body: Record<string, unknown>): {
  accessToken: string;
  refreshToken: string | null;
  idToken: string | null;
  expiresIn: number;
  scopes: string[];
  earliestRefreshAt: number | null;
} {
  const accessToken = body.access_token;
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    throw new Error("SIWC token response missing access_token");
  }
  const expiresIn =
    typeof body.expires_in === "number" && Number.isFinite(body.expires_in) && body.expires_in > 0
      ? body.expires_in
      : 3600;
  const scopes = typeof body.scope === "string" ? body.scope.split(/\s+/).filter(Boolean) : ([] as string[]);
  return {
    accessToken,
    refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : null,
    idToken: typeof body.id_token === "string" ? body.id_token : null,
    expiresIn,
    scopes,
    earliestRefreshAt: parseEarliestRefreshAt(body.earliest_refresh_at),
  };
}

async function postToken(fields: Record<string, string | undefined>): Promise<Record<string, unknown>> {
  const response = await fetchImpl()(SIWC_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: formBody(fields),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text().catch(() => "");
  let body: unknown = null;
  try {
    body = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!response.ok || !body || typeof body !== "object" || Array.isArray(body)) {
    const err =
      body &&
      typeof body === "object" &&
      !Array.isArray(body) &&
      typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string }).error
        : `http_${response.status}`;
    throw new Error(`SIWC token endpoint failed: ${err}`);
  }
  return body as Record<string, unknown>;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as unknown;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
    return payload as Record<string, unknown>;
  } catch {
    return null;
  }
}

function emailFromIdToken(idToken: string | null): string | null {
  if (!idToken) return null;
  const claims = decodeJwtPayload(idToken);
  return claims && typeof claims.email === "string" ? claims.email : null;
}

function subjectFromIdToken(idToken: string | null): string | null {
  if (!idToken) return null;
  const claims = decodeJwtPayload(idToken);
  return claims && typeof claims.sub === "string" ? claims.sub : null;
}

function respondHtml(res: import("node:http").ServerResponse, status: number, title: string, body: string): void {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body><p>${body}</p></body></html>`;
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end(html);
}

async function startRealLoopback(expectedState: string): Promise<LoopbackListener & { server: Server }> {
  return await new Promise((resolve, reject) => {
    let accepted = false;
    let settle: ((value: { code?: string; clientId?: string | null; error?: string }) => void) | null = null;
    const result = new Promise<{ code?: string; clientId?: string | null; error?: string }>((res) => {
      settle = res;
    });
    const server = createServer((req, res) => {
      let url: URL;
      try {
        url = new URL(req.url || "/", "http://127.0.0.1");
      } catch {
        respondHtml(res, 400, "SIWC", "Invalid callback address.");
        return;
      }
      if (url.pathname !== SIWC_CALLBACK_PATH) {
        respondHtml(res, 404, "SIWC", "Not found.");
        return;
      }
      if (url.searchParams.get("state") !== expectedState) {
        respondHtml(res, 400, "SIWC", "Invalid state.");
        return;
      }
      if (accepted) {
        respondHtml(res, 409, "SIWC", "Callback already consumed.");
        return;
      }
      accepted = true;
      const error = url.searchParams.get("error");
      const code = url.searchParams.get("code");
      const clientId = url.searchParams.get("client_id");
      if (error) {
        respondHtml(res, 400, "SIWC", "Authorization declined.");
        settle?.({ error });
        return;
      }
      if (!code) {
        respondHtml(res, 400, "SIWC", "Missing authorization code.");
        settle?.({ error: "missing_code" });
        return;
      }
      respondHtml(res, 200, "SIWC", "Signed in. You can close this window.");
      settle?.({ code, clientId });
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = address && typeof address === "object" ? address.port : 0;
      resolve({
        server,
        redirectUri: `http://127.0.0.1:${port}${SIWC_CALLBACK_PATH}`,
        result,
        close: () => {
          try {
            server.close();
          } catch {
            /* ignore */
          }
          try {
            server.closeAllConnections?.();
          } catch {
            /* ignore */
          }
        },
      });
    });
  });
}

async function defaultOpenAuthorize(url: string): Promise<void> {
  const platform = process.platform;
  const { spawn } = await import("node:child_process");
  const cmd = platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
  } catch {
    /* 调用方可手动打开 authorize_url */
  }
}

/** 只读状态。永不返回 token。 */
export function siwcStatus(): SiwcStatus {
  const session = readSession();
  if (!session) {
    return { signed_in: false, email: null, expires_at: null, client_id_present: false };
  }
  return {
    signed_in: true,
    email: session.email,
    expires_at: session.expiresAt,
    client_id_present: session.clientId.length > 0 && session.clientId !== SIWC_DYNAMIC_CLIENT_ID,
  };
}

export function logoutSiwc(): void {
  sessionEpoch += 1;
  refreshInFlight = null;
  try {
    unlinkSync(credentialPath());
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

function needsRefresh(session: SiwcSession, at: number): boolean {
  if (session.expiresAt - REFRESH_AHEAD_MS > at) return false;
  if (session.expiresAt <= at) return true;
  return session.earliestRefreshAt == null || session.earliestRefreshAt <= at;
}

async function refreshSession(session: SiwcSession): Promise<string | null> {
  if (!session.refreshToken) {
    logoutSiwc();
    return null;
  }
  const epochAtStart = sessionEpoch;
  try {
    const body = await postToken({
      grant_type: "refresh_token",
      client_id: session.clientId,
      refresh_token: session.refreshToken,
      resource: SIWC_RESOURCE,
    });
    if (epochAtStart !== sessionEpoch || !readSession()) {
      // 等待 HTTP 期间已 logout：不落盘、不恢复 signed_in。
      return null;
    }
    const tokens = parseTokenResponse(body);
    const at = nowMs();
    const next: SiwcSession = {
      ...session,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken ?? session.refreshToken,
      idToken: tokens.idToken ?? session.idToken,
      expiresAt: at + tokens.expiresIn * 1000,
      earliestRefreshAt: tokens.earliestRefreshAt,
      scopes: tokens.scopes.length > 0 ? tokens.scopes : session.scopes,
      email: emailFromIdToken(tokens.idToken) ?? session.email,
      subject: subjectFromIdToken(tokens.idToken) ?? session.subject,
      savedAt: new Date(at).toISOString(),
    };
    if (epochAtStart !== sessionEpoch || !readSession()) return null;
    writeSession(next);
    return next.accessToken;
  } catch {
    if (epochAtStart === sessionEpoch) logoutSiwc();
    return null;
  }
}

/** 过期则 refresh；并发调用串行到同一次 refresh。 */
export async function resolveSiwcAccessToken(): Promise<string | null> {
  const session = readSession();
  if (!session) return null;
  const at = nowMs();
  if (!needsRefresh(session, at)) return session.accessToken;
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = refreshSession(session).finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

/**
 * 启动 loopback → 打开授权页 → 等 callback → 换 token → 落盘。
 * 若已有进行中的 login，取消旧的再开新的。
 */
export async function startSiwcLogin(opts?: {
  agentNameHint?: string;
  /** 授权 URL 就绪时立刻回调（仍未等 callback）；HTTP 面可据此先返回给浏览器。 */
  onAuthorizeUrl?: (info: { authorize_url: string; redirect_uri: string }) => void | Promise<void>;
  /** 覆盖默认的本机 open；前端自己 window.open 时传 no-op。 */
  openAuthorize?: (url: string) => void | Promise<void>;
}): Promise<{ authorize_url: string; redirect_uri: string }> {
  if (loginInFlight) {
    loginInFlight.cancel();
    loginInFlight = null;
  }

  let cancelled = false;
  let rejectCancel: ((err: Error) => void) | null = null;
  const cancelGate = new Promise<never>((_, reject) => {
    rejectCancel = reject;
  });
  // 避免无人 catch 的 cancelGate 变 unhandled rejection
  cancelGate.catch(() => {});

  let listener: LoopbackListener | null = null;
  const cancel = () => {
    cancelled = true;
    listener?.close();
    rejectCancel?.(new SiwcLoginCancelledError());
  };

  const done = (async () => {
    const hostId = ensureHostId();
    const existing = readSession();
    const clientId =
      existing && existing.clientId !== SIWC_DYNAMIC_CLIENT_ID ? existing.clientId : SIWC_DYNAMIC_CLIENT_ID;
    const { verifier, challenge } = createPkcePair();
    const state = newOpaque();
    const nonce = newOpaque();

    listener = deps.startLoopback ? await deps.startLoopback(state) : await startRealLoopback(state);
    if (cancelled) {
      listener.close();
      throw new SiwcLoginCancelledError();
    }

    const redirectUri = listener.redirectUri;
    if (!redirectUri.startsWith("http://127.0.0.1:")) {
      listener.close();
      throw new Error("SIWC redirect_uri must use http://127.0.0.1 (not localhost)");
    }

    const authorizeUrl = buildSiwcAuthorizeUrl({
      clientId,
      redirectUri,
      state,
      nonce,
      codeChallenge: challenge,
      hostId,
      agentNameHint: opts?.agentNameHint || SIWC_DEFAULT_AGENT_NAME_HINT,
    });

    const info = { authorize_url: authorizeUrl, redirect_uri: redirectUri };
    if (opts?.onAuthorizeUrl) await opts.onAuthorizeUrl(info);
    const open = opts?.openAuthorize || deps.openAuthorize || defaultOpenAuthorize;
    await open(authorizeUrl);
    if (cancelled) throw new SiwcLoginCancelledError();

    let timer: ReturnType<typeof setTimeout> | null = null;
    const callback = await Promise.race([
      listener.result,
      cancelGate,
      new Promise<{ timeout: true }>((resolve) => {
        timer = setTimeout(() => resolve({ timeout: true }), OAUTH_CALLBACK_TIMEOUT_MS);
      }),
    ]);
    if (timer) clearTimeout(timer);
    listener.close();
    if (cancelled) throw new SiwcLoginCancelledError();
    if (!callback || ("timeout" in callback && callback.timeout)) {
      throw new Error("SIWC login timed out waiting for callback");
    }
    if (callback.error || !callback.code) {
      throw new Error(`SIWC authorization failed: ${callback.error || "missing_code"}`);
    }

    const issuedClientId = callback.clientId || clientId;
    if (!issuedClientId || issuedClientId === SIWC_DYNAMIC_CLIENT_ID) {
      throw new Error("SIWC registration incomplete: missing issued client_id");
    }

    const tokenBody = await postToken({
      grant_type: "authorization_code",
      client_id: issuedClientId,
      code: callback.code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
      resource: SIWC_RESOURCE,
    });
    const tokens = parseTokenResponse(tokenBody);
    if (!tokens.scopes.includes("chatgpt.tokens.use.direct")) {
      throw new Error("SIWC plan usage scope missing; allow ChatGPT plan usage on the consent screen");
    }

    const at = nowMs();
    const session: SiwcSession = {
      version: 1,
      clientId: issuedClientId,
      hostId,
      email: emailFromIdToken(tokens.idToken),
      subject: subjectFromIdToken(tokens.idToken),
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      idToken: tokens.idToken,
      expiresAt: at + tokens.expiresIn * 1000,
      earliestRefreshAt: tokens.earliestRefreshAt,
      scopes: tokens.scopes,
      savedAt: new Date(at).toISOString(),
    };
    writeSession(session);
    return { authorize_url: authorizeUrl, redirect_uri: redirectUri };
  })();

  loginInFlight = { cancel, done };
  try {
    return await done;
  } finally {
    if (loginInFlight?.done === done) loginInFlight = null;
  }
}
/** SIWC Responses 请求体：强制 `store:false`（协议硬要求）。 */
export function normalizeSiwcResponsesBody(body: unknown): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  return { ...(body as Record<string, unknown>), store: false };
}

/** 给 `@ai-sdk/openai` 用的 fetch：对 `/v1/responses` POST 注入 `store:false`。 */
export function createSiwcFetch(baseFetch: typeof globalThis.fetch = fetchImpl()): typeof globalThis.fetch {
  return async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = (
      init?.method ||
      (typeof input !== "string" && !(input instanceof URL) ? input.method : "GET") ||
      "GET"
    ).toUpperCase();
    if (method === "POST" && /\/v1\/responses\/?(\?|$)/.test(url) && init?.body && typeof init.body === "string") {
      try {
        const parsed = JSON.parse(init.body) as unknown;
        const next = normalizeSiwcResponsesBody(parsed);
        return baseFetch(input, {
          ...init,
          body: JSON.stringify(next),
        });
      } catch {
        return baseFetch(input, init);
      }
    }
    return baseFetch(input, init);
  };
}
