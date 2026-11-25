import type { LanguageModel } from "ai";

import { createForestAssessor } from "./engine/assessor.ts";
import { ResearchEngine } from "./engine/engine.ts";
import { createMemoryRepos } from "./engine/memory-repos.ts";
import type { EngineEmit, EnginePorts } from "./engine/ports.ts";
import { createWorkerExecutor } from "./executor/workers.ts";
import type { BrowserRunner } from "./tools/browser.ts";

export type CreateResearchRuntimeOptions = {
  model: LanguageModel;
  browserRunner?: BrowserRunner;
  emit?: EngineEmit;
  clock?: () => Date;
  /** 测试注入：替换部分端口。 */
  ports?: Partial<EnginePorts>;
};

/** Autoresearch 组合根（形制学 superagent Runtime）：拼装 Engine 端口，不编排业务。 */
export function createResearchRuntime(options: CreateResearchRuntimeOptions): ResearchEngine {
  const repos = options.ports?.repos ?? createMemoryRepos();
  const ports: EnginePorts = {
    assessor: options.ports?.assessor ?? createForestAssessor(),
    executor: options.ports?.executor ?? createWorkerExecutor(),
    repos,
    model: options.ports?.model ?? options.model,
    browserRunner: options.ports?.browserRunner ?? options.browserRunner,
    emit: options.ports?.emit ?? options.emit,
    clock: options.ports?.clock ?? options.clock,
  };
  return new ResearchEngine(ports);
}

export { ResearchEngine } from "./engine/engine.ts";
export type { RunResearchResult } from "./engine/engine.ts";
