/**
 * 跨 run 长期记忆的检索入口（docs/design/memory.md 第二层，只读）。
 *
 * 无 RAG：逐行确定性字符匹配，没有 embedding、没有向量库、没有重排模型。
 * 返回 L0 命中行 + 路径，agent 要细节再按路径读 L2 —— 分层加载，不撑爆上下文。
 *
 * **它不放松 B1**：这里命中的文献只是线索。任何要进 references 的 id 仍必须经
 * `arxiv_save` 在本次 run 实检落盘。
 *
 * replay: "safe" —— 只读逐行匹配，不写任何文件。
 */
import { defineTool } from "eve/tools";
import { z } from "zod";
import { searchMemory } from "../campaignMemory.ts";

export default defineTool({
  description:
    "Search the campaign-scoped long-term memory (shared across runs) for prior knowledge about a topic: " +
    "the global paper index, per-question campaign pages (status, cross-run rejected hypotheses, effective " +
    "search terms) and operational lessons. Plain deterministic text matching — you get back matching L0 " +
    "lines plus their file paths, not documents. " +
    "IMPORTANT: a paper found here is only a LEAD. It is NOT citable until you re-save it with `arxiv_save` " +
    "in THIS run; verification only accepts ids saved in this run. " +
    "Long-term memory is an accelerator, not a source of truth: if it is empty or disabled you simply proceed as usual.",
  inputSchema: z.object({
    query: z
      .string()
      .min(2)
      .describe("Keywords from the scientific question, e.g. 'solar flare prediction magnetogram'."),
    limit: z.number().int().min(1).max(100).default(20).describe("Max hit lines to return."),
  }),
  async execute({ query, limit }) {
    const result = searchMemory({ query, limit });
    return {
      ...result,
      hint: !result.enabled
        ? "长期记忆未启用（memory/ 不存在）。这不是错误：照常检索即可。"
        : result.hitCount === 0
          ? "无命中（本题或本主题此前没跑过）。照常走 arxiv_search。"
          : "命中的是线索行，不是可引用凭据 —— 要引用仍须 arxiv_save 在本 run 实检落盘。",
    };
  },
});
