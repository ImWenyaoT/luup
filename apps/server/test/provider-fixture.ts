import assert from "node:assert/strict";
import { createServer } from "node:http";
import { onTestFinished, vi } from "vitest";
import { clearModelOverride, setModelOverride } from "../src/seams/model.ts";

type Request = { method: string | undefined; path: string | undefined; body: string };
type Reply = { body: unknown; status?: number; headers?: Record<string, string> };

/** Real HTTP and SDK transport; tests retain control over response bodies and assertions. */
export async function providerFixture(modelId: string, respond: (index: number) => Reply): Promise<Request[]> {
  const requests: Request[] = [];
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      body += chunk;
    });
    request.on("end", () => {
      const reply = respond(requests.length);
      requests.push({ method: request.method, path: request.url, body });
      response.writeHead(reply.status ?? 200, { "content-type": "application/json", ...reply.headers });
      response.end(JSON.stringify(reply.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  const originalFetch = globalThis.fetch;
  vi.stubGlobal("fetch", ((input, init) => {
    const url = new URL(input instanceof globalThis.Request ? input.url : String(input));
    if (url.origin !== origin) throw new Error("Only the local provider fixture is allowed");
    return originalFetch(input, init);
  }) satisfies typeof fetch);
  setModelOverride({ apiKey: "local-test-only", baseUrl: `${origin}/v1`, modelId });
  onTestFinished(async () => {
    clearModelOverride();
    vi.unstubAllGlobals();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });
  return requests;
}
