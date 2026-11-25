import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "vitest";

import {
  buildSiwcAuthorizeUrl,
  configureSiwc,
  createSiwcFetch,
  logoutSiwc,
  normalizeSiwcResponsesBody,
  resetSiwcRuntimeState,
  resolveSiwcAccessToken,
  SIWC_DYNAMIC_CLIENT_ID,
  siwcStatus,
  startSiwcLogin,
  type SiwcSession,
} from "../src/seams/siwc.ts";
import { clearProviderOverride, createLanguageModel, providerConfigStatus } from "../src/seams/providers.ts";

let dir: string;
let credentialPath: string;
let hostIdPath: string;

beforeEach(() => {
  resetSiwcRuntimeState();
  clearProviderOverride();
  delete process.env.OPENAI_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  delete process.env.LUUP_PROVIDER;
  dir = mkdtempSync(join(tmpdir(), "luup-siwc-"));
  credentialPath = join(dir, "siwc-session.json");
  hostIdPath = join(dir, "siwc-host-id");
  configureSiwc({ credentialPath, hostIdPath });
});

afterEach(() => {
  resetSiwcRuntimeState();
  clearProviderOverride();
  rmSync(dir, { recursive: true, force: true });
});

function writeSession(partial: Partial<SiwcSession> & Pick<SiwcSession, "accessToken" | "expiresAt">): void {
  const session: SiwcSession = {
    version: 1,
    clientId: partial.clientId || "oaiapp_test",
    hostId: partial.hostId || "urn:uuid:11111111-1111-1111-1111-111111111111",
    email: partial.email ?? "ab@example.com",
    subject: partial.subject ?? "sub",
    accessToken: partial.accessToken,
    refreshToken: partial.refreshToken ?? "refresh",
    idToken: partial.idToken ?? null,
    expiresAt: partial.expiresAt,
    earliestRefreshAt: partial.earliestRefreshAt ?? null,
    scopes: partial.scopes ?? ["chatgpt.tokens.use.direct"],
    savedAt: partial.savedAt ?? new Date().toISOString(),
  };
  writeFileSync(credentialPath, `${JSON.stringify(session, null, 2)}\n`);
  writeFileSync(hostIdPath, `${session.hostId}\n`);
}

test("siwcStatus 缺会话 → 未登录且不泄露字段", () => {
  const status = siwcStatus();
  assert.equal(status.signed_in, false);
  assert.equal(status.email, null);
  assert.equal(status.expires_at, null);
  assert.equal(status.client_id_present, false);
  assert.ok(!("access_token" in status));
  assert.ok(!("accessToken" in status));
});

test("siwcStatus 有会话 → signed_in，仍无 token", () => {
  writeSession({ accessToken: "secret-token", expiresAt: Date.now() + 60_000, email: "cd@example.com" });
  const status = siwcStatus();
  assert.equal(status.signed_in, true);
  assert.equal(status.email, "cd@example.com");
  assert.equal(status.client_id_present, true);
  assert.equal(JSON.stringify(status).includes("secret-token"), false);
});

test("logoutSiwc 清会话文件", () => {
  writeSession({ accessToken: "t", expiresAt: Date.now() + 1000 });
  logoutSiwc();
  assert.equal(siwcStatus().signed_in, false);
  assert.throws(() => readFileSync(credentialPath), /ENOENT/);
});

test("resolveSiwcAccessToken 未过期直接返回", async () => {
  writeSession({ accessToken: "live", expiresAt: Date.now() + 3_600_000 });
  assert.equal(await resolveSiwcAccessToken(), "live");
});

test("resolveSiwcAccessToken 过期则 refresh（串行）", async () => {
  writeSession({
    accessToken: "stale",
    refreshToken: "r1",
    expiresAt: Date.now() - 1000,
    clientId: "oaiapp_x",
  });
  let refreshCalls = 0;
  configureSiwc({
    credentialPath,
    hostIdPath,
    fetch: async (input, init) => {
      const url = String(input);
      assert.ok(url.includes("/oauth/token"));
      const body = String(init?.body || "");
      assert.ok(body.includes("grant_type=refresh_token"));
      refreshCalls += 1;
      await new Promise((r) => setTimeout(r, 20));
      return new Response(
        JSON.stringify({
          access_token: "fresh",
          refresh_token: "r2",
          expires_in: 3600,
          scope: "chatgpt.tokens.use.direct",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    },
  });
  const [a, b] = await Promise.all([resolveSiwcAccessToken(), resolveSiwcAccessToken()]);
  assert.equal(a, "fresh");
  assert.equal(b, "fresh");
  assert.equal(refreshCalls, 1);
  assert.equal(JSON.parse(readFileSync(credentialPath, "utf8")).accessToken, "fresh");
});

test("startSiwcLogin 完成 PKCE 回调并落盘", async () => {
  const tokenBodies: string[] = [];
  configureSiwc({
    credentialPath,
    hostIdPath,
    openAuthorize: async () => {},
    fetch: async (_input, init) => {
      tokenBodies.push(String(init?.body || ""));
      return new Response(
        JSON.stringify({
          access_token: "access-1",
          refresh_token: "refresh-1",
          id_token: [
            Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url"),
            Buffer.from(JSON.stringify({ email: "zz@example.com", sub: "user-1" })).toString("base64url"),
            "sig",
          ].join("."),
          expires_in: 3600,
          scope: "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    },
    startLoopback: async (expectedState) => {
      assert.ok(expectedState.length > 8);
      return {
        redirectUri: "http://127.0.0.1:34567/auth/callback",
        result: Promise.resolve({ code: "auth-code", clientId: "oaiapp_issued" }),
        close: () => {},
      };
    },
  });

  const ok = await startSiwcLogin({ agentNameHint: "Luup" });
  assert.ok(ok.authorize_url.includes("client_id=dynamic_agent_client"));
  assert.ok(ok.authorize_url.includes("agent_name_hint=Luup"));
  assert.ok(ok.authorize_url.includes("code_challenge_method=S256"));
  assert.equal(ok.redirect_uri, "http://127.0.0.1:34567/auth/callback");
  assert.equal(siwcStatus().signed_in, true);
  assert.equal(siwcStatus().email, "zz@example.com");
  assert.equal(siwcStatus().client_id_present, true);
  assert.ok(tokenBodies.some((b) => b.includes("grant_type=authorization_code")));
});

test("第二次 startSiwcLogin 取消进行中的第一次", async () => {
  let firstClose = 0;
  let loopbackCount = 0;
  let releaseFirst!: (v: { code: string; clientId: string }) => void;

  configureSiwc({
    credentialPath,
    hostIdPath,
    openAuthorize: async () => {},
    fetch: async () =>
      new Response(
        JSON.stringify({
          access_token: "access-2",
          refresh_token: "refresh-2",
          id_token: null,
          expires_in: 3600,
          scope: "chatgpt.tokens.use.direct",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    startLoopback: async () => {
      loopbackCount += 1;
      if (loopbackCount === 1) {
        return {
          redirectUri: "http://127.0.0.1:1111/auth/callback",
          result: new Promise((resolve) => {
            releaseFirst = resolve;
          }),
          close: () => {
            firstClose += 1;
          },
        };
      }
      return {
        redirectUri: "http://127.0.0.1:2222/auth/callback",
        result: Promise.resolve({ code: "code-2", clientId: "oaiapp_2" }),
        close: () => {},
      };
    },
  });

  const first = startSiwcLogin();
  // 等第一轮 loopback 挂起
  await new Promise((r) => setTimeout(r, 10));
  const second = startSiwcLogin();
  await assert.rejects(first, /cancelled/);
  assert.ok(firstClose >= 1);
  // 避免悬挂：若 cancel 未 settle，补一枪
  releaseFirst?.({ code: "late", clientId: "oaiapp_late" });
  const ok = await second;
  assert.equal(ok.redirect_uri, "http://127.0.0.1:2222/auth/callback");
  assert.equal(siwcStatus().signed_in, true);
});
test("buildSiwcAuthorizeUrl 首次带 agent_name_hint，复用 client 不带", () => {
  const first = buildSiwcAuthorizeUrl({
    clientId: SIWC_DYNAMIC_CLIENT_ID,
    redirectUri: "http://127.0.0.1:9/auth/callback",
    state: "s",
    nonce: "n",
    codeChallenge: "c",
    hostId: "urn:uuid:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    agentNameHint: "Luup",
  });
  assert.ok(first.includes("agent_name_hint=Luup"));
  const reuse = buildSiwcAuthorizeUrl({
    clientId: "oaiapp_reuse",
    redirectUri: "http://127.0.0.1:9/auth/callback",
    state: "s",
    nonce: "n",
    codeChallenge: "c",
    hostId: "urn:uuid:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    agentNameHint: "Luup",
  });
  assert.equal(reuse.includes("agent_name_hint"), false);
});

test("normalizeSiwcResponsesBody / createSiwcFetch 强制 store:false", async () => {
  assert.deepEqual(normalizeSiwcResponsesBody({ model: "gpt", store: true, stream: true }), {
    model: "gpt",
    store: false,
    stream: true,
  });
  let seen = "";
  const wrapped = createSiwcFetch(async (_input, init) => {
    seen = String(init?.body || "");
    return new Response("{}", { status: 200 });
  });
  await wrapped("https://api.openai.com/v1/responses", {
    method: "POST",
    body: JSON.stringify({ model: "gpt-5.4", store: true }),
  });
  assert.equal(JSON.parse(seen).store, false);
});

test("providers：SIWC → credential=siwc；DeepSeek 环境变量仍独立", () => {
  writeSession({ accessToken: "tok", expiresAt: Date.now() + 60_000 });
  assert.equal(providerConfigStatus().provider, "openai");
  assert.equal(providerConfigStatus().credential, "siwc");
  assert.ok(createLanguageModel());

  process.env.DEEPSEEK_API_KEY = "sk-deepseek";
  assert.equal(providerConfigStatus().provider, "deepseek");
  assert.equal(providerConfigStatus().credential, "environment");
  assert.ok(createLanguageModel());

  process.env.LUUP_PROVIDER = "openai";
  assert.equal(providerConfigStatus().provider, "openai");
  assert.equal(providerConfigStatus().credential, "siwc");
});
