import assert from "node:assert/strict";
import { test } from "vitest";

import { desktopEntryUrl, healthUrl, loadDesktopConfig } from "../src/config.js";

test("默认指向本机 API/Web 与 /autoresearch", () => {
  const config = loadDesktopConfig({});
  assert.equal(config.apiOrigin, "http://127.0.0.1:8000");
  assert.equal(config.webOrigin, "http://127.0.0.1:3000");
  assert.equal(config.startPath, "/autoresearch");
  assert.equal(config.manageServices, true);
  assert.equal(config.runtime, "deterministic");
  assert.equal(desktopEntryUrl(config), "http://127.0.0.1:3000/autoresearch");
  assert.equal(healthUrl(config), "http://127.0.0.1:8000/health");
});

test("环境变量覆盖 origin / path / manage", () => {
  const config = loadDesktopConfig({
    LUUP_API_ORIGIN: "http://127.0.0.1:9000/",
    LUUP_WEB_ORIGIN: "http://127.0.0.1:4000",
    LUUP_DESKTOP_START_PATH: "autoresearch",
    LUUP_DESKTOP_MANAGE_SERVICES: "0",
    LUUP_RUNTIME: "live",
    PORT: "9000",
  });
  assert.equal(config.apiOrigin, "http://127.0.0.1:9000");
  assert.equal(config.webOrigin, "http://127.0.0.1:4000");
  assert.equal(config.startPath, "/autoresearch");
  assert.equal(config.manageServices, false);
  assert.equal(config.runtime, "live");
  assert.equal(config.apiPort, 9000);
});
