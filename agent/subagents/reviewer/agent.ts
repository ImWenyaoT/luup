import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Agent } from "@openai/agents";
import { ReviewSchema } from "../../lib/contracts.ts";
import { QWEN_CONTEXT_WINDOW_TOKENS, qwenModel } from "../../lib/model.ts";
import arxivSearch from "../../lib/tools/arxiv_search.ts";
import paperIndexRead from "../../lib/tools/paper_index_read.ts";
import type { SubagentNode } from "../node.ts";

/**
 * Reviewer：独立反查 arXiv 找先行工作与反例，审证据支撑/可证伪性/实验区分度。
 * 开思考，且**必须带工具**——纯 prompt 批判无信息增量。
 *
 * 熔断器（机制层，不靠 prompt）：19 轮 × 131k ≈ 原 token 熔断额度 2.5M 的
 * 上界映射（要反查 arXiv）。撞线 = 「被截断」，master 升级处理。
 *
 * `contract`：派工工具按 ReviewSchema（verdict pass|revise + findings[] +
 * requiredChanges[]）提取/规范化，master 原样落盘 `review.json`
 * （写入时 artifact_write 再校验，fail-closed）。
 */
export const reviewerNode: SubagentNode = {
  name: "reviewer",
  description:
    "Independent reviewer. Re-searches arXiv for prior art and counterevidence, checks whether the proposed " +
    "experiment can falsify the hypothesis, and returns pass or a concrete one-time revision list.",
  maxTurns: 19,
  contextWindowTokens: QWEN_CONTEXT_WINDOW_TOKENS,
  contract: ReviewSchema,
  build: () =>
    new Agent({
      name: "reviewer",
      instructions: readFileSync(join(import.meta.dirname, "instructions.md"), "utf8"),
      model: qwenModel({ thinking: true }),
      tools: [arxivSearch, paperIndexRead],
    }),
};
