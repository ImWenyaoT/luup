import { tool } from "@openai/agents";
import { z } from "zod";

import { searchCrossref } from "../crossref.ts";
import type { EvidenceLedger } from "../evidence.ts";

/** DOI 元数据的检索面，和 arxiv_search 并列。
 *
 * 两个源覆盖面不同：arXiv 是预印本，Crossref 是有 DOI 的登记记录。补证轮换个源查
 * 才叫补证 —— 只有一个源时，`gaps` 只能让 Researcher 把同一份检索原样重做一遍。
 *
 * locator 用 `doi:<DOI>`：DOI 是这类来源唯一稳定的标识，canonicalize 按它认回真身。
 */
export function createCrossrefSearchTool(ledger: EvidenceLedger) {
  return tool({
    name: "crossref_search",
    description: [
      "Search Crossref for DOI-backed publication metadata.",
      "Complements arxiv_search, which only covers preprints.",
      "Cite only the evidence_id and citations this tool returns; do not alter them.",
    ].join(" "),
    parameters: z.object({
      query: z.string().min(1).describe("Search keywords in English"),
    }),
    async execute(input, _context, details) {
      const result = await searchCrossref(input.query, { rows: 5, signal: details?.signal });
      const record = ledger.record({
        tool: "crossref_search",
        sourceType: "web",
        query: result.query,
        status: result.status,
        resultSummary: result.resultSummary,
        citations: result.records.map((item) => ({
          source_type: "web" as const,
          title: item.title,
          locator: `doi:${item.doi}`,
          url: item.url,
        })),
      });
      return {
        evidence_id: record.evidenceId,
        source_type: record.sourceType,
        query: record.query,
        status: record.status,
        result_summary: record.resultSummary,
        citations: record.citations,
        details: result.records.map((item) => ({
          locator: `doi:${item.doi}`,
          authors: item.authors.slice(0, 3),
          published: item.published,
          container: item.container,
        })),
      };
    },
  });
}
