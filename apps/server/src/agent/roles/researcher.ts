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
    if (searches >= MAX_SEARCHES) agent.modelSettings.toolChoice = "structured_output";
  };
  const searchTools = [createArxivSearchTool(ledger, beforeSearch), createCrossrefSearchTool(ledger, beforeSearch)];
  const agent = new Agent({
    name: "EvidenceResearcher",
    model: modelForRole(),
    instructions: [instructionsFrom(import.meta.dirname, "researcher.md"), STRUCTURED_OUTPUT_INSTRUCTION].join("\n\n"),
    tools: [...searchTools, capture.tool],
    // 检索阶段不强制某一个来源，到限后明确要求上报。
    // 「至少查过一次」仍由 EvidenceLedger 检查，不能只靠提示词。
    // 请求串行调用；provider 可能忽略该参数，真正的终止边界是上报闸与阶段 deadline。
    modelSettings: { ...sharedModelSettings, parallelToolCalls: false },
    // 保留工具定义以识别 Qwen 从历史中发出的旧调用；执行闸拒绝超额调用，
    // 命名 toolChoice 要求下一回合上报，且不让 SDK 在工具执行后自动清除它。
    resetToolChoice: false,
    toolUseBehavior: capture.toolUseBehavior,
  });
  return { agent, capture };
}
