/**
 * 文献检索工具（architecture.md「引用真实性防线」第 1 条）。
 * L 节点只能通过本工具（及 arxiv_save）获得文献；返回的一切字段都来自 arXiv API。
 * 本工具只读、不落盘 —— 要进 memory 必须再调 arxiv_save。
 */
import { tool } from "@openai/agents";
import { z } from "zod";
import { searchArxiv } from "../arxiv.ts";

const SUMMARY_LIMIT = 400;

const parameters = z.object({
  query: z
    .string()
    .min(2)
    .describe("Search phrase, or raw arXiv query syntax."),
  maxResults: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(10)
    .describe("How many results to return (1-50)."),
  sortBy: z
    .enum(["relevance", "lastUpdatedDate", "submittedDate"])
    .default("relevance")
    .describe("Ranking. Use submittedDate to survey recent work."),
});

/** 裸执行函数：selftest 直调它，不经 SDK 的 RunContext。 */
export async function executeArxivSearch({ query, maxResults, sortBy }: z.infer<typeof parameters>) {
  const papers = await searchArxiv(query, maxResults, { sortBy });
  return {
    query,
    count: papers.length,
    results: papers.map((p) => ({
      arxivId: p.arxivId,
      title: p.title,
      year: p.year,
      authors: p.authors.slice(0, 6),
      primaryCategory: p.primaryCategory,
      summary:
        p.summary.length > SUMMARY_LIMIT
          ? `${p.summary.slice(0, SUMMARY_LIMIT)}…`
          : p.summary,
      url: p.absUrl,
    })),
    hint:
      papers.length === 0
        ? "No hits. Try broader terms or a different field prefix."
        : "Call arxiv_save with the ids worth keeping; only saved ids may be cited.",
  };
}

export default tool({
  name: "arxiv_search",
  description:
    "Search arXiv for real papers. Returns arXiv-provided metadata only (id, title, year, category, truncated abstract). " +
    "This is the ONLY way to discover literature; never invent a paper. " +
    "Pass a plain phrase (it is matched across all fields), or arXiv query syntax such as " +
    '`ti:"solar flare" AND cat:astro-ph.SR`. To keep a result as evidence you must then call `arxiv_save` with its id.',
  parameters,
  execute: executeArxivSearch,
});
