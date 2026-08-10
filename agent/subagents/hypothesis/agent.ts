import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Agent } from "@openai/agents";
import { QWEN_CONTEXT_WINDOW_TOKENS, qwenModel } from "../../lib/model.ts";
import paperIndexRead from "../../lib/tools/paper_index_read.ts";
import type { SubagentNode } from "../node.ts";

/**
 * H 节点：假设生成。开思考——推导链质量是本节点的唯一产出。
 *
 * 熔断器（机制层，不靠 prompt）：15 轮 × 131k ≈ 原 token 熔断额度 2M 的
 * 上界映射（H 只推理一轮产物，额度收紧）。撞线 = 「被截断」，master 升级处理。
 */
export const hypothesisNode: SubagentNode = {
  name: "hypothesis",
  description:
    "Hypothesis generator. Given a scientific question plus the literature fact cards, produces 2-3 falsifiable " +
    "candidate hypotheses, each with an explicit derivation chain over the cited fact cards. It reasons only " +
    "from the cards it was given and says 'insufficient evidence' rather than inventing premises.",
  maxTurns: 15,
  contextWindowTokens: QWEN_CONTEXT_WINDOW_TOKENS,
  build: () =>
    new Agent({
      name: "hypothesis",
      instructions: readFileSync(join(import.meta.dirname, "instructions.md"), "utf8"),
      model: qwenModel({ thinking: true }),
      tools: [paperIndexRead],
    }),
};
