import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Agent } from "@openai/agents";
import { ScientistOutputSchema } from "../../lib/contracts.ts";
import { QWEN_CONTEXT_WINDOW_TOKENS, qwenModel } from "../../lib/model.ts";
import arxivSearch from "../../lib/tools/arxiv_search.ts";
import arxivSave from "../../lib/tools/arxiv_save.ts";
import memorySearch from "../../lib/tools/memory_search.ts";
import paperIndexRead from "../../lib/tools/paper_index_read.ts";
import type { SubagentNode } from "../node.ts";

/**
 * Scientist：检索证据、提出可证伪假设并写出完整研究计划（假设与计划是同一次
 * 科学论证，故合一节点）。开思考。
 *
 * 熔断器（机制层，不靠 prompt）：22 轮 × 131k 窗口 ≈ 原 token 熔断额度 3M 的
 * 上界映射（要多轮检索，额度最宽）。撞线 = 「被截断」，master 升级处理。
 *
 * `contract`：派工工具按 ScientistOutputSchema（evidence[]≥5 + 10 字段 proposal）
 * 提取/规范化返回 JSON；master 据此渲染 evidence.md 并原样写 proposal.json
 * （写入时 artifact_write 再校验，fail-closed）。
 */
export const scientistNode: SubagentNode = {
  name: "scientist",
  description:
    "Scientist. Searches and saves real arXiv evidence, derives a falsifiable hypothesis, and returns the complete " +
    "research plan plus its evidence cards. Revises the plan once when given a review.",
  maxTurns: 22,
  contextWindowTokens: QWEN_CONTEXT_WINDOW_TOKENS,
  contract: ScientistOutputSchema,
  build: () =>
    new Agent({
      name: "scientist",
      instructions: readFileSync(join(import.meta.dirname, "instructions.md"), "utf8"),
      model: qwenModel({ thinking: true }),
      tools: [arxivSearch, arxivSave, memorySearch, paperIndexRead],
    }),
};
