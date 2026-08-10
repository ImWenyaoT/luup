import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Agent } from "@openai/agents";
import { ProposalSchema } from "../../lib/contracts.ts";
import { QWEN_CONTEXT_WINDOW_TOKENS, qwenModel } from "../../lib/model.ts";
import paperIndexRead from "../../lib/tools/paper_index_read.ts";
import type { SubagentNode } from "../node.ts";

/**
 * W 节点：研究计划撰写。
 * 不开思考——产出被 10 字段契约完全约束，token 应烧在字段内容而非推理上。
 *
 * 熔断器（机制层，不靠 prompt）：15 轮 × 131k ≈ 原 token 熔断额度 2M 的
 * 上界映射（W 一次性出结构化 JSON）。撞线 = 「被截断」，master 升级处理。
 *
 * `contract`：派工工具按 ProposalSchema 提取/规范化返回 JSON，master 拿到即可
 * 落盘 `proposal.json`（10 字段契约在 artifact_write 再校验一遍，fail-closed）。
 */
export const proposalNode: SubagentNode = {
  name: "proposal",
  description:
    "Research plan writer. Given the question, the fact cards, the winning hypothesis and the critic's " +
    "mandatory revisions, emits the 10-field 《科学假设与研究计划》 as structured JSON matching the project " +
    "contract. References may only use arXiv ids that appear in the fact cards.",
  maxTurns: 15,
  contextWindowTokens: QWEN_CONTEXT_WINDOW_TOKENS,
  contract: ProposalSchema,
  build: () =>
    new Agent({
      name: "proposal",
      instructions: readFileSync(join(import.meta.dirname, "instructions.md"), "utf8"),
      model: qwenModel(),
      tools: [paperIndexRead],
    }),
};
