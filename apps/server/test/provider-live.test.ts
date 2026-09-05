import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "vitest";

test("live diagnostics are opt-in and transport failures send once and fail visibly", async () => {
  const directory = mkdtempSync(join(tmpdir(), "luup-provider-probe-"));
  let calls = 0;
  const server = createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      calls += 1;
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "local diagnostic outage" } }));
    });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const run = (args: string[]) =>
    new Promise<{ code: number; stdout: string }>((done) => {
      execFile(
        process.execPath,
        [
          resolve(import.meta.dirname, "../../../node_modules/tsx/dist/cli.mjs"),
          join(import.meta.dirname, "provider-live.ts"),
          ...args,
        ],
        {
          cwd: directory,
          timeout: 10_000,
          env: { ...process.env, QWEN_API_KEY: "local-fixture", QWEN_BASE_URL: `http://127.0.0.1:${address.port}/v1` },
        },
        (error, stdout) => done({ code: error ? (typeof error.code === "number" ? error.code : -1) : 0, stdout }),
      );
    });
  try {
    const dry = await run([]);
    assert.equal(dry.code, 0);
    assert.match(dry.stdout, /No API calls made/);
    assert.equal(calls, 0);
    const live = await run(["--live", "--case=native-schema"]);
    assert.equal(live.code, 1);
    assert.match(live.stdout, /native-schema: FAIL/);
    assert.equal(calls, 1, "Runner no-retry policy must also disable the underlying client retry loop");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((done, reject) => server.close((error) => (error ? reject(error) : done())));
    rmSync(directory, { recursive: true, force: true });
  }
}, 15_000);
