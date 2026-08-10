import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Agent } from "@openai/agents";
import { QWEN_CONTEXT_WINDOW_TOKENS, qwenModel } from "../../lib/model.ts";
import arxivSearch from "../../lib/tools/arxiv_search.ts";
import arxivSave from "../../lib/tools/arxiv_save.ts";
import memorySearch from "../../lib/tools/memory_search.ts";
import paperIndexRead from "../../lib/tools/paper_index_read.ts";
import type { SubagentNode } from "../node.ts";

/**
 * L 节点：文献挖掘。DAG 的唯一外部事实入口。
 * 不开思考——本节点的工作是检索与摘录，token 应烧在多轮 arXiv 调用上而非推理。
 *
 * 熔断器（机制层，不靠 prompt）：`maxTurns` 是轮数上界，22 轮 × 131k 窗口
 * ≈ 原 token 熔断额度 3M 的上界映射（L 要多轮检索，额度最宽）。撞线抛
 * MaxTurnsExceededError，master 按「预算耗尽被截断」升级处理，而不是无声烧钱。
 */
export const literatureNode: SubagentNode = {
  name: "literature",
  description:
    "Literature miner. Given a scientific question, searches arXiv from multiple angles, saves the most " +
    "relevant papers into this run's literature memory, and returns fact cards (claim + arXiv id + relevance). " +
    "Every claim is grounded in a real abstract; it never invents papers.",
  maxTurns: 22,
  contextWindowTokens: QWEN_CONTEXT_WINDOW_TOKENS,
  build: () =>
    new Agent({
      name: "literature",
      instructions: readFileSync(join(import.meta.dirname, "instructions.md"), "utf8"),
      model: qwenModel(),
      tools: [arxivSearch, arxivSave, memorySearch, paperIndexRead],
    }),
};
