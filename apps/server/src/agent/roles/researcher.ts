import { Agent } from "@openai/agents";

import { modelForRole, sharedModelSettings } from "../../seams/index.ts";
import { researchProposalSchema } from "../contracts.ts";
import type { EvidenceLedger } from "../evidence.ts";
import { instructionsFrom } from "../instructions.ts";
import { createArxivSearchTool } from "../tools/arxiv-search.ts";
import { createCrossrefSearchTool } from "../tools/crossref-search.ts";
import { createStructuredOutput, STRUCTURED_OUTPUT_INSTRUCTION, type StructuredOutput } from "./structured-output.ts";

/** 唯一有检索面的角色。两个来源：arXiv 预印本与 Crossref DOI 出版元数据。
 *
 * 也是唯一交作业不走 `outputType` 的角色：它的产物必须先与本轮检索台账对账
 * （见 `roles.ts` 的 `canonicalizeResearch`）才能落成 Research Artifact，
 * 所以走合成工具上报 —— 上报面与检索面挂在同一个 Agent 上，模型自己决定何时收尾。
 * 其余角色直接用 `outputType` 交付；Reviewer 另有受限检索面，但不走这条合成上报通路。
 */
export default function defineResearcher(ledger: EvidenceLedger): {
  agent: Agent<any, any>;
  capture: StructuredOutput;
} {
  const capture = createStructuredOutput(researchProposalSchema);
  const agent = new Agent({
    name: "EvidenceResearcher",
    model: modelForRole(),
    instructions: [instructionsFrom(import.meta.dirname, "researcher.md"), STRUCTURED_OUTPUT_INSTRUCTION].join("\n\n"),
    tools: [createArxivSearchTool(ledger), createCrossrefSearchTool(ledger), capture.tool],
    // 不强制某一个工具，让模型在两个来源之间选择。
    // 「至少查过一次」仍由 EvidenceLedger 检查，不能只靠提示词。
    // 百炼有时会在同一 turn 并发调用两个检索工具。MVP 先关掉并发，让调用顺序和费用更好理解。
    modelSettings: { ...sharedModelSettings, parallelToolCalls: false },
    toolUseBehavior: capture.toolUseBehavior,
  });
  return { agent, capture };
}
