import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Agent } from "@openai/agents";
import { CritiqueSchema } from "../../lib/contracts.ts";
import { QWEN_CONTEXT_WINDOW_TOKENS, qwenModel } from "../../lib/model.ts";
import arxivSearch from "../../lib/tools/arxiv_search.ts";
import paperIndexRead from "../../lib/tools/paper_index_read.ts";
import type { SubagentNode } from "../node.ts";

/**
 * C 节点：批判。开思考，且**必须带工具**——纯 prompt 批判无信息增量
 * （architecture.md 角色表，书 ch10 表 10-2）。
 *
 * 熔断器（机制层，不靠 prompt）：19 轮 × 131k ≈ 原 token 熔断额度 2.5M 的
 * 上界映射（C 要反查 arXiv，比 H 略宽）。撞线 = 「被截断」，master 升级处理。
 *
 * `contract`：C→W handoff 的结构化防线。派工工具按 CritiqueSchema 提取/规范化
 * 返回 JSON，master 原样落盘 `critique.json`；判据「每假设 ≥3 条批判」由 schema
 * 基数兜底（写入时 artifact_write 再校验一遍，fail-closed）。
 */
export const critiqueNode: SubagentNode = {
  name: "critique",
  description:
    "Adversarial critic. Assumes every candidate hypothesis is wrong, trivial or already published: it " +
    "actually re-searches arXiv for prior art, audits each derivation step against the cited fact cards, " +
    "and judges feasibility. Returns >=3 substantive critiques per hypothesis, a winning hypothesis, and a " +
    "mandatory revision list for the plan writer.",
  maxTurns: 19,
  contextWindowTokens: QWEN_CONTEXT_WINDOW_TOKENS,
  contract: CritiqueSchema,
  build: () =>
    new Agent({
      name: "critique",
      instructions: readFileSync(join(import.meta.dirname, "instructions.md"), "utf8"),
      model: qwenModel({ thinking: true }),
      tools: [arxivSearch, paperIndexRead],
    }),
};
