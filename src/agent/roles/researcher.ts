import { Agent } from "@openai/agents";

import { modelForRole, sharedModelSettings } from "../config.ts";
import type { EvidenceLedger } from "../evidence.ts";
import { instructionsFrom } from "../instructions.ts";
import { createArxivSearchTool } from "../tools/arxiv-search.ts";
import { createCrossrefSearchTool } from "../tools/crossref-search.ts";

/** 唯一有检索面的角色。两个来源：arXiv 预印本与 Crossref DOI 出版元数据。 */
export default function defineResearcher(ledger: EvidenceLedger) {
  return new Agent({
    name: "EvidenceResearcher",
    model: modelForRole(),
    instructions: instructionsFrom(import.meta.dirname, "researcher.md"),
    tools: [createArxivSearchTool(ledger), createCrossrefSearchTool(ledger)],
    // 不强制某一个工具，让模型在两个来源之间选择。
    // 「至少查过一次」仍由 EvidenceLedger 检查，不能只靠提示词。
    // 百炼有时会在同一 turn 并发调用两个检索工具。MVP 先关掉并发，让调用顺序和费用更好理解。
    modelSettings: { ...sharedModelSettings, parallelToolCalls: false },
  });
}
