import { MockLanguageModelV4 } from "ai/test";

import { createLanguageModel, providerConfigStatus } from "../../seams/providers.ts";
import { createDeterministicWorkerExecutor } from "../executor/deterministic.ts";
import { createResearchRuntime } from "../runtime.ts";
import type { BrowserRunner } from "../tools/browser.ts";
import { ResearchMill } from "./mill.ts";
import { createFsPaperStore, type PaperStore } from "./paper-store.ts";
import type { MillSnapshot, StartMillInput } from "./types.ts";

const DET_USAGE = {
  inputTokens: { total: 0, noCache: 0, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 0, text: 0, reasoning: undefined },
};

export type MillRegistryDeps = {
  createMill?: () => ResearchMill;
  browserRunner?: BrowserRunner;
  paperStore?: PaperStore;
  /** live | deterministic；缺省看 LUUP_RUNTIME。 */
  runtime?: "live" | "deterministic";
};

/** 进程内单战役：第一刀一张 Mill；后续可多租户。 */
export class MillRegistry {
  #mill: ResearchMill | null = null;
  readonly #deps: MillRegistryDeps;

  constructor(deps: MillRegistryDeps = {}) {
    this.#deps = deps;
  }

  status(): MillSnapshot | { status: "idle" } {
    if (!this.#mill) return { status: "idle" };
    return this.#mill.snapshot();
  }

  start(input: StartMillInput): MillSnapshot {
    const runtime = this.#deps.runtime ?? (process.env.LUUP_RUNTIME === "deterministic" ? "deterministic" : "live");
    if (runtime === "live" && providerConfigStatus().credential === "absent") {
      throw new Error("missing_model_credentials");
    }
    if (this.#mill?.snapshot().status === "running") {
      throw new Error("mill_already_running");
    }
    const mill =
      this.#deps.createMill?.() ??
      new ResearchMill({
        engine: createResearchRuntime({
          model:
            runtime === "deterministic"
              ? new MockLanguageModelV4({
                  doGenerate: {
                    content: [{ type: "text", text: "[deterministic stub]" }],
                    finishReason: { unified: "stop", raw: undefined },
                    usage: DET_USAGE,
                    warnings: [],
                  },
                })
              : createLanguageModel(),
          browserRunner: this.#deps.browserRunner,
          ...(runtime === "deterministic" ? { ports: { executor: createDeterministicWorkerExecutor() } } : {}),
        }),
        tickDelayMs: Number(process.env.LUUP_MILL_TICK_MS ?? 0) || 0,
        paperStore: this.#deps.paperStore ?? createFsPaperStore(),
      });
    this.#mill = mill;
    return mill.start(input);
  }

  async stop(): Promise<MillSnapshot | { status: "idle" }> {
    if (!this.#mill) return { status: "idle" };
    return this.#mill.stop();
  }
}
