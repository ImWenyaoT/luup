import { createLanguageModel, providerConfigStatus } from "../../seams/providers.ts";
import { createResearchRuntime } from "../runtime.ts";
import type { BrowserRunner } from "../tools/browser.ts";
import { ResearchMill } from "./mill.ts";
import type { MillSnapshot, StartMillInput } from "./types.ts";

export type MillRegistryDeps = {
  createMill?: () => ResearchMill;
  browserRunner?: BrowserRunner;
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
          model: createLanguageModel(),
          browserRunner: this.#deps.browserRunner,
        }),
        tickDelayMs: Number(process.env.LUUP_MILL_TICK_MS ?? 0) || 0,
      });
    this.#mill = mill;
    return mill.start(input);
  }

  async stop(): Promise<MillSnapshot | { status: "idle" }> {
    if (!this.#mill) return { status: "idle" };
    return this.#mill.stop();
  }
}
