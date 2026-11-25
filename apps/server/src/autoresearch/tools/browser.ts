import { spawn } from "node:child_process";

import { tool } from "ai";
import { z } from "zod";

import type { AutoresearchRuntime, EvidenceHit } from "../types.ts";

const MAX_BROWSER_COMMANDS = 20;
const COMMAND_TIMEOUT_MS = 60_000;

export type BrowserRunner = (
  args: string[],
  options: { signal?: AbortSignal },
) => Promise<{ ok: boolean; stdout: string; stderr: string; code: number | null }>;

/** 默认通过 `agent-browser` CLI 驱动浏览器（vercel-labs/agent-browser）。 */
export const defaultBrowserRunner: BrowserRunner = (args, { signal }) =>
  new Promise((resolve) => {
    const child = spawn("agent-browser", args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve({ ok: false, stdout, stderr: stderr || "agent-browser timed out", code: null });
    }, COMMAND_TIMEOUT_MS);

    const onAbort = () => {
      child.kill("SIGTERM");
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve({
        ok: false,
        stdout,
        stderr: error instanceof Error ? error.message : String(error),
        code: null,
      });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve({ ok: code === 0, stdout: stdout.trim(), stderr: stderr.trim(), code });
    });
  });

function nextEvidenceId(runtime: AutoresearchRuntime): string {
  return `ev_${String(runtime.evidence.length + 1).padStart(4, "0")}`;
}

export function createBrowserTools(runtime: AutoresearchRuntime, runner: BrowserRunner = defaultBrowserRunner) {
  return {
    browser_open: tool({
      description: "Open a URL in agent-browser. Prefer academic / primary sources.",
      inputSchema: z.object({
        url: z.string().url(),
      }),
      execute: async ({ url }, { abortSignal }) => {
        if (runtime.browserCommands.length >= MAX_BROWSER_COMMANDS) {
          return { ok: false, error: `browser command budget exceeded (${MAX_BROWSER_COMMANDS})` };
        }
        runtime.browserCommands.push(`open ${url}`);
        const result = await runner(["open", url], { signal: abortSignal });
        return { ok: result.ok, stdout: result.stdout.slice(0, 4000), stderr: result.stderr.slice(0, 1000) };
      },
    }),

    browser_snapshot: tool({
      description: "Take an accessibility snapshot; elements are labeled with refs like @e1.",
      inputSchema: z.object({
        interactiveOnly: z.boolean().optional().describe("If true, pass -i for interactive elements"),
      }),
      execute: async ({ interactiveOnly }, { abortSignal }) => {
        if (runtime.browserCommands.length >= MAX_BROWSER_COMMANDS) {
          return { ok: false, error: `browser command budget exceeded (${MAX_BROWSER_COMMANDS})` };
        }
        const args = interactiveOnly ? ["snapshot", "-i"] : ["snapshot"];
        runtime.browserCommands.push(args.join(" "));
        const result = await runner(args, { signal: abortSignal });
        return { ok: result.ok, snapshot: result.stdout.slice(0, 12000), stderr: result.stderr.slice(0, 1000) };
      },
    }),

    browser_click: tool({
      description: "Click an element by snapshot ref, e.g. @e1.",
      inputSchema: z.object({
        ref: z.string().min(1).describe("Element ref from the latest snapshot"),
      }),
      execute: async ({ ref }, { abortSignal }) => {
        if (runtime.browserCommands.length >= MAX_BROWSER_COMMANDS) {
          return { ok: false, error: `browser command budget exceeded (${MAX_BROWSER_COMMANDS})` };
        }
        runtime.browserCommands.push(`click ${ref}`);
        const result = await runner(["click", ref], { signal: abortSignal });
        return { ok: result.ok, stdout: result.stdout.slice(0, 2000), stderr: result.stderr.slice(0, 1000) };
      },
    }),

    browser_record_finding: tool({
      description: "Freeze a web finding into the evidence ledger after reading a page.",
      inputSchema: z.object({
        title: z.string().min(1),
        url: z.string().url(),
        summary: z.string().min(1).max(2000),
        query: z.string().min(1),
      }),
      execute: async ({ title, url, summary, query }) => {
        const hit: EvidenceHit = {
          evidenceId: nextEvidenceId(runtime),
          source: "web",
          query,
          title,
          locator: `web:${url}`,
          url,
          summary,
        };
        runtime.evidence.push(hit);
        return {
          evidence_id: hit.evidenceId,
          title: hit.title,
          locator: hit.locator,
          url: hit.url,
        };
      },
    }),
  };
}
