import { Output, ToolLoopAgent, generateText, isStepCount, tool, type LanguageModel } from "ai";
import { z } from "zod";

import { COORDINATOR_INSTRUCTIONS, CRITIC_INSTRUCTIONS, LITERATURE_INSTRUCTIONS, WEB_INSTRUCTIONS } from "./prompts.ts";
import { evaluateAutoresearchGate } from "./gate.ts";
import { createBrowserTools, type BrowserRunner } from "./tools/browser.ts";
import { createLiteratureTools } from "./tools/literature.ts";
import type { AutoresearchGate, AutoresearchRuntime, CritiqueResult } from "./types.ts";

const critiqueSchema = z.object({
  verdict: z.enum(["supports", "contradicts", "insufficient"]),
  rationale: z.string().min(1),
  gaps: z.array(z.string()).default([]),
});

export type AutoresearchAgents = {
  runtime: AutoresearchRuntime;
  /** 具体 tools 泛型由工厂推断；对外只依赖 Agent 流式/生成接口。 */
  coordinator: ToolLoopAgent<never, any>;
  evaluateGate: () => AutoresearchGate;
};

export type CreateAutoresearchAgentsOptions = {
  model: LanguageModel;
  browserRunner?: BrowserRunner;
  /** Coordinator 最大步数；默认 12。 */
  coordinatorSteps?: number;
  literatureSteps?: number;
  webSteps?: number;
};

/** 组装 parent + literature / web / critique subagents（ADR-0013）。
 *
 * Harness 语义：subagent 只经 tool 委派；共享面是 runtime.evidence / critiques，
 * 不是隐藏对话历史。critique 否决由 `evaluateGate` 硬闸，不交给模型「改到过」。
 */
export function createAutoresearchAgents(options: CreateAutoresearchAgentsOptions): AutoresearchAgents {
  const runtime: AutoresearchRuntime = {
    evidence: [],
    critiques: [],
    browserCommands: [],
  };

  const literatureTools = createLiteratureTools(runtime);
  const browserTools = createBrowserTools(runtime, options.browserRunner);

  const literatureAgent = new ToolLoopAgent({
    model: options.model,
    instructions: LITERATURE_INSTRUCTIONS,
    tools: literatureTools,
    stopWhen: isStepCount(options.literatureSteps ?? 8),
  });

  const webAgent = new ToolLoopAgent({
    model: options.model,
    instructions: WEB_INSTRUCTIONS,
    tools: browserTools,
    stopWhen: isStepCount(options.webSteps ?? 10),
  });

  const literature_research = tool({
    description: "Delegate literature search (arXiv / Crossref) to an isolated subagent.",
    inputSchema: z.object({
      task: z.string().min(1).describe("Focused literature research task"),
    }),
    execute: async ({ task }, { abortSignal }) => {
      const result = await literatureAgent.generate({ prompt: task, abortSignal });
      return {
        summary: result.text,
        evidence_count: runtime.evidence.length,
        evidence_ids: runtime.evidence.map((e) => e.evidenceId),
      };
    },
    toModelOutput: ({ output }) => ({
      type: "text",
      value: `Literature summary:\n${output.summary}\nEvidence ids: ${output.evidence_ids.join(", ") || "(none)"}`,
    }),
  });

  const web_research = tool({
    description: "Delegate open-web research via agent-browser to an isolated subagent.",
    inputSchema: z.object({
      task: z.string().min(1).describe("Focused web research task"),
    }),
    execute: async ({ task }, { abortSignal }) => {
      const result = await webAgent.generate({ prompt: task, abortSignal });
      return {
        summary: result.text,
        evidence_count: runtime.evidence.filter((e) => e.source === "web").length,
        browser_commands_used: runtime.browserCommands.length,
      };
    },
    toModelOutput: ({ output }) => ({
      type: "text",
      value: `Web research summary:\n${output.summary}\nBrowser commands used: ${output.browser_commands_used}`,
    }),
  });

  const critique = tool({
    description: "Independent critique of claims against frozen evidence. Must run before final report merge.",
    inputSchema: z.object({
      claim: z.string().min(1).describe("Claim or draft conclusion to pressure-test"),
    }),
    execute: async ({ claim }, { abortSignal }) => {
      const evidenceBlock =
        runtime.evidence.length === 0
          ? "(no frozen evidence)"
          : runtime.evidence
              .map((e) => `- ${e.evidenceId} [${e.source}] ${e.locator}: ${e.title}\n  ${e.summary.slice(0, 280)}`)
              .join("\n");
      const prompt = [
        "Frozen evidence (authoritative; do not invent more):",
        evidenceBlock,
        "",
        "Claim to critique:",
        claim,
        "",
        "Return structured output only: verdict ∈ supports|contradicts|insufficient, rationale, gaps[].",
      ].join("\n");
      // 结构化 verdict：不从 rationale 正文猜词，避免「does not support」翻转判定。
      const result = await generateText({
        model: options.model,
        system: CRITIC_INSTRUCTIONS,
        prompt,
        output: Output.object({ schema: critiqueSchema }),
        abortSignal,
      });
      const parsed: CritiqueResult = {
        verdict: result.output.verdict,
        rationale: result.output.rationale,
        gaps: result.output.gaps ?? [],
      };
      runtime.critiques.push(parsed);
      return parsed;
    },
    toModelOutput: ({ output }) => ({
      type: "text",
      value: `Critique verdict=${output.verdict}\n${output.rationale}\nGaps: ${output.gaps.join("; ") || "(none)"}`,
    }),
  });

  const coordinator = new ToolLoopAgent({
    model: options.model,
    instructions: COORDINATOR_INSTRUCTIONS,
    tools: {
      literature_research,
      web_research,
      critique,
    },
    stopWhen: isStepCount(options.coordinatorSteps ?? 12),
  });

  return {
    runtime,
    coordinator,
    evaluateGate: () => evaluateAutoresearchGate(runtime),
  };
}
