import assert from "node:assert/strict";
import { test } from "vitest";

import { createBrowserTools } from "../src/autoresearch/tools/browser.ts";
import type { AutoresearchRuntime } from "../src/autoresearch/types.ts";

const toolOpts = {
  abortSignal: AbortSignal.timeout(5_000),
  toolCallId: "t",
  messages: [] as never[],
  context: {},
};

test("browser tools 记录命令并冻结 web 证据", async () => {
  const runtime: AutoresearchRuntime = { evidence: [], critiques: [], browserCommands: [] };
  const calls: string[][] = [];
  const tools = createBrowserTools(runtime, async (args) => {
    calls.push(args);
    return { ok: true, stdout: args[0] === "snapshot" ? "@e1 link Home" : "ok", stderr: "", code: 0 };
  });

  // Tool.execute 的联合返回类型含 AsyncIterable；测试里直接 await 并断言形状。
  const open = (await (tools.browser_open.execute as Function)({ url: "https://example.com" }, toolOpts)) as {
    ok: boolean;
  };
  assert.equal(open.ok, true);

  const snap = (await (tools.browser_snapshot.execute as Function)({ interactiveOnly: true }, toolOpts)) as {
    snapshot?: string;
  };
  assert.match(String(snap.snapshot), /@e1/);

  const click = (await (tools.browser_click.execute as Function)({ ref: "@e1" }, toolOpts)) as {
    ok: boolean;
  };
  assert.equal(click.ok, true);

  const recorded = (await (tools.browser_record_finding.execute as Function)(
    {
      title: "Example",
      url: "https://example.com",
      summary: "A landing page",
      query: "example",
    },
    toolOpts,
  )) as { evidence_id: string };
  assert.equal(recorded.evidence_id, "web_0001");
  assert.equal(runtime.evidence.length, 1);
  assert.deepEqual(
    calls.map((c) => c[0]),
    ["open", "snapshot", "click"],
  );
  assert.equal(runtime.browserCommands.length, 3);
});

test("browser 命令预算耗尽后拒绝", async () => {
  const runtime: AutoresearchRuntime = {
    evidence: [],
    critiques: [],
    browserCommands: Array.from({ length: 20 }, (_, i) => `cmd ${i}`),
  };
  const tools = createBrowserTools(runtime, async () => {
    throw new Error("should not run");
  });
  const result = (await (tools.browser_open.execute as Function)({ url: "https://example.com" }, toolOpts)) as {
    ok: boolean;
    error?: string;
  };
  assert.equal(result.ok, false);
  assert.match(String(result.error), /budget exceeded/);
});
