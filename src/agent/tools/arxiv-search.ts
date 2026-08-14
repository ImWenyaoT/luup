import { tool } from "@openai/agents";
import { z } from "zod";

import { publishedYear, searchArxiv } from "../arxiv.ts";
import type { EvidenceLedger } from "../evidence.ts";

/** Researcher 唯一的检索面。
 *
 * 关键不是「有个工具」，而是**证据从哪来**：每次调用登记一条检索记录，
 * evidence ID 与全部 citation 字段都由代码写定，模型只能引用。
 * 此前那个 record_evidence 是模型自报 `{query,title,url,claim}`、代码只算 hash ——
 * 冻结的是一条幻觉的 ID，稳定但不可核验，真实检索接上后已删除。
 *
 * 失败不抛异常：8 种 status 原样回给模型，让它自己决定改写查询还是如实上报查不到。
 * 把检索失败变成 Attempt 崩溃，模型就没有机会诚实地说「这条查不到」。
 */
export function createArxivSearchTool(ledger: EvidenceLedger) {
  return tool({
    name: "arxiv_search",
    description: [
      "Search arXiv for papers. Each call is registered as one evidence record.",
      "Cite only the evidence_id and citations this tool returns; do not alter them.",
    ].join(" "),
    parameters: z.object({
      query: z.string().min(1).describe("Search keywords in English, e.g. 'retrieval augmented generation evaluation'"),
    }),
    async execute(input, _context, details) {
      const result = await searchArxiv(input.query, { maxResults: 5, signal: details?.signal });
      const record = ledger.record({
        tool: "arxiv_search",
        sourceType: "arxiv",
        query: result.query,
        status: result.status,
        resultSummary: result.resultSummary,
        citations: result.records.map((item) => ({
          source_type: "arxiv" as const,
          title: item.title,
          locator: `arxiv:${item.arxivId}`,
          url: item.url,
          // 引用验收（B4）比对的就是这两个字段；模型看不到也改不动它们。
          authors: item.authors,
          year: publishedYear(item.published),
        })),
      });
      return {
        // 这一份就是 Artifact 里 queries[] 那条该有的样子，逐字照抄即可。
        evidence_id: record.evidenceId,
        source_type: record.sourceType,
        query: record.query,
        status: record.status,
        result_summary: record.resultSummary,
        citations: record.citations,
        abstracts: result.records.map((item) => ({
          locator: `arxiv:${item.arxivId}`,
          summary: item.summary,
        })),
      };
    },
  });
}
