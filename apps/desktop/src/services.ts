import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { DesktopConfig } from "./config.js";

const here = path.dirname(fileURLToPath(import.meta.url));
/** apps/desktop/dist → repo root */
export const repoRoot = path.resolve(here, "../../..");

export type ManagedServices = {
  api: ChildProcess | null;
  web: ChildProcess | null;
  stop: () => void;
};

function spawnWorkspaceScript(
  filter: "@luup/server" | "@luup/frontend",
  script: string,
  env: NodeJS.ProcessEnv,
): ChildProcess {
  const child = spawn("pnpm", ["--filter", filter, "run", script], {
    cwd: repoRoot,
    env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  return child;
}

export async function waitForHttpOk(
  url: string,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const intervalMs = options.intervalMs ?? 400;
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (res.ok) return;
      lastError = new Error(`HTTP ${res.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(
    `timed out waiting for ${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

/** 按需拉起本机 API / Web；调用方负责 stop。 */
export function startManagedServices(config: DesktopConfig): ManagedServices {
  const children: ManagedServices = {
    api: null,
    web: null,
    stop() {
      for (const child of [children.api, children.web]) {
        if (!child || child.killed) continue;
        child.kill("SIGTERM");
      }
    },
  };

  if (!config.manageServices) return children;

  children.api = spawnWorkspaceScript("@luup/server", config.runtime === "live" ? "dev:live" : "dev", {
    ...process.env,
    PORT: String(config.apiPort),
    LUUP_HOSTNAME: "127.0.0.1",
    LUUP_RUNTIME: config.runtime,
  });

  children.web = spawnWorkspaceScript("@luup/frontend", "dev", {
    ...process.env,
    PORT: String(config.webPort),
    LUUP_API_ORIGIN: config.apiOrigin,
  });

  return children;
}
