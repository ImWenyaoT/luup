import { Agent } from "@openai/agents";

import { modelForRole, sharedModelSettings } from "../../seams/index.ts";
import { researchProposalSchema } from "../contracts.ts";
import type { EvidenceLedger } from "../evidence.ts";
import { instructionsFrom } from "../instructions.ts";
import { createArxivSearchTool } from "../tools/arxiv-search.ts";
import { createCrossrefSearchTool } from "../tools/crossref-search.ts";
import { createStructuredOutput, STRUCTURED_OUTPUT_INSTRUCTION, type StructuredOutput } from "./structured-output.ts";

/** 通过 arXiv / Crossref 检索，再用合成工具上报待核验的 Research。
 * 上报后禁止新增检索；Reviewer 有自己的独立检索面，Planner 只有合成上报面。
 * parallelToolCalls 只是给 provider 的请求参数，不是检索次数上界（协议修订 queries_authority）。
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
    tools: [
      createArxivSearchTool(ledger, capture.assertOpen),
      createCrossrefSearchTool(ledger, capture.assertOpen),
      capture.tool,
    ],
    // 不强制某一个工具，让模型在两个来源之间选择。
    // 「至少查过一次」仍由 EvidenceLedger 检查，不能只靠提示词。
    // 请求串行调用；provider 可能忽略该参数，真正的终止边界是上报闸与阶段 deadline。
    modelSettings: { ...sharedModelSettings, parallelToolCalls: false },
    toolUseBehavior: capture.toolUseBehavior,
  });
  return { agent, capture };
}
