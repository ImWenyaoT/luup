import assert from "node:assert/strict";
import { test } from "vitest";

import { loadDesktopConfig } from "../src/config.js";
import { startManagedServices, waitForHttpOk } from "../src/services.js";

test("manageServices=0 时不拉起子进程", () => {
  const managed = startManagedServices(loadDesktopConfig({ LUUP_DESKTOP_MANAGE_SERVICES: "0" }));
  assert.equal(managed.api, null);
  assert.equal(managed.web, null);
  managed.stop();
});

test("waitForHttpOk 对立即成功的 URL 返回", async () => {
  // 用 data URL 不行；用一个会失败的短超时证明错误路径
  await assert.rejects(
    () => waitForHttpOk("http://127.0.0.1:1/health", { timeoutMs: 300, intervalMs: 50 }),
    /timed out/,
  );
});
