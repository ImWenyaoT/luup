import { Agent } from "@openai/agents";

import { modelForRole, sharedModelSettings } from "../../seams/index.ts";
import { researchProposalSchema } from "../contracts.ts";
import type { EvidenceLedger } from "../evidence.ts";
import { instructionsFrom } from "../instructions.ts";
import { createArxivSearchTool } from "../tools/arxiv-search.ts";
import { createCrossrefSearchTool } from "../tools/crossref-search.ts";
import { createStructuredOutput, STRUCTURED_OUTPUT_INSTRUCTION, type StructuredOutput } from "./structured-output.ts";

// 通常 2–3 次检索，额外留同等额度给换源/失败；其余回合留给写作与结构化纠错。
const MAX_SEARCHES = 6;

/** 通过 arXiv / Crossref 检索，再用合成工具上报待核验的 Research。
 * 上报后禁止新增检索；Reviewer 有自己的独立检索面，Planner 只有合成上报面。
 * parallelToolCalls 只是给 provider 的请求参数，不是检索次数上界（协议修订 queries_authority）。
 */
export default function defineResearcher(ledger: EvidenceLedger): {
  agent: Agent<any, any>;
  capture: StructuredOutput;
} {
  const capture = createStructuredOutput(researchProposalSchema);
  let searches = 0;
  const beforeSearch = () => {
    capture.assertOpen();
    if (searches >= MAX_SEARCHES) {
      throw new Error(
        "Search budget exhausted. Submit structured_output using existing evidence and state gaps honestly.",
      );
    }
    // 在 await 前预留，防止 provider 忽略 parallelToolCalls 时同批调用越过上界。
    searches += 1;
  };
  const searchTools = [createArxivSearchTool(ledger, beforeSearch), createCrossrefSearchTool(ledger, beforeSearch)];
  for (const tool of searchTools) {
    // SDK 每轮重新读取工具可见性；到限后保留上报工具，而不是直接让 Attempt 失败。
    tool.isEnabled = async () => searches < MAX_SEARCHES && capture.captured() === undefined;
  }
  const agent = new Agent({
    name: "EvidenceResearcher",
    model: modelForRole(),
    instructions: [instructionsFrom(import.meta.dirname, "researcher.md"), STRUCTURED_OUTPUT_INSTRUCTION].join("\n\n"),
    tools: [...searchTools, capture.tool],
    // 不强制某一个工具，让模型在两个来源之间选择。
    // 「至少查过一次」仍由 EvidenceLedger 检查，不能只靠提示词。
    // 请求串行调用；provider 可能忽略该参数，真正的终止边界是上报闸与阶段 deadline。
    modelSettings: { ...sharedModelSettings, parallelToolCalls: false },
    toolUseBehavior: capture.toolUseBehavior,
  });
  return { agent, capture };
}
