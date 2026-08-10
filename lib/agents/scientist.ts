import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Agent } from "@openai/agents";
import { normalizeArxivId } from "./arxiv.ts";
import { type ScientistOutput, ScientistOutputSchema } from "./contracts.ts";
import { QWEN_CONTEXT_WINDOW_TOKENS, qwenModel } from "./model.ts";
import { readCard } from "./paperStore.ts";
import { resolveRunDir } from "./runContext.ts";
import arxivSearch from "./tools/arxiv_search.ts";
import arxivSave from "./tools/arxiv_save.ts";
import memorySearch from "./tools/memory_search.ts";
import paperIndexRead from "./tools/paper_index_read.ts";
import type { SubagentNode } from "./types.ts";

/**
 * 引用元数据回填（第五道防线；schema>机制>prompt）：`title/authors/year` 从本 run
 * 文献库的权威卡片（arxiv_save 实取自 arXiv API）覆写，模型的智力产出只保留
 * `arxivId` 与 `relevance`。动机是实测失败模式——单会话里检索与写计划相隔几十轮，
 * 模型写引用时凭记忆重构元数据（标题缩写、作者张冠李戴），B2/B4 必挂。
 * 卡片不存在的 id 原样保留：那是 B1（未实检落盘 = 疑似编造）的管辖范围，不在这里遮掩。
 */
function backfillReferenceMetadata(data: unknown): unknown {
  const out = data as ScientistOutput;
  const runDir = resolveRunDir();
  return {
    ...out,
    proposal: {
      ...out.proposal,
      references: out.proposal.references.map((r) => {
        const card = readCard(runDir, normalizeArxivId(r.arxivId) ?? r.arxivId);
        if (!card) return r;
        return { ...r, title: card.title, authors: card.authors, year: card.year ?? r.year };
      }),
    },
  };
}

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
  normalize: backfillReferenceMetadata,
  build: () =>
    new Agent({
      name: "scientist",
      instructions: readFileSync(join(import.meta.dirname, "scientist.md"), "utf8"),
      model: qwenModel({ thinking: true }),
      tools: [arxivSearch, arxivSave, memorySearch, paperIndexRead],
    }),
};
