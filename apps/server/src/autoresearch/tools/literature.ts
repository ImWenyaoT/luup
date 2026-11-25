import { tool } from "ai";
import { z } from "zod";

import { publishedYear, searchArxiv } from "../../agent/arxiv.ts";
import { searchCrossref } from "../../agent/crossref.ts";
import type { AutoresearchRuntime, EvidenceHit } from "../types.ts";

function nextEvidenceId(runtime: AutoresearchRuntime): string {
  return `ev_${String(runtime.evidence.length + 1).padStart(4, "0")}`;
}

function pushHit(runtime: AutoresearchRuntime, hit: Omit<EvidenceHit, "evidenceId">): EvidenceHit {
  const full: EvidenceHit = { ...hit, evidenceId: nextEvidenceId(runtime) };
  runtime.evidence.push(full);
  return full;
}

export function createLiteratureTools(runtime: AutoresearchRuntime) {
  return {
    arxiv_search: tool({
      description: "Search arXiv. Cite only returned evidence_id / locator fields.",
      inputSchema: z.object({
        query: z.string().min(1).describe("English search keywords"),
      }),
      execute: async ({ query }, { abortSignal }) => {
        const result = await searchArxiv(query, { maxResults: 5, signal: abortSignal });
        const citations = result.records.map((item) => {
          const hit = pushHit(runtime, {
            source: "arxiv",
            query: result.query,
            title: item.title,
            locator: `arxiv:${item.arxivId}`,
            url: item.url,
            summary: item.summary.slice(0, 600),
          });
          return {
            evidence_id: hit.evidenceId,
            title: hit.title,
            locator: hit.locator,
            url: hit.url,
            year: publishedYear(item.published),
            summary: hit.summary,
          };
        });
        return {
          status: result.status,
          result_summary: result.resultSummary,
          citations,
        };
      },
    }),

    crossref_search: tool({
      description: "Search Crossref works. Cite only returned evidence_id / locator fields.",
      inputSchema: z.object({
        query: z.string().min(1).describe("Search keywords"),
      }),
      execute: async ({ query }, { abortSignal }) => {
        const result = await searchCrossref(query, { rows: 5, signal: abortSignal });
        const citations = result.records.map((item) => {
          const hit = pushHit(runtime, {
            source: "crossref",
            query: result.query,
            title: item.title,
            locator: item.doi ? `doi:${item.doi}` : `crossref:${item.title}`,
            url: item.url,
            summary: [item.title, item.container, item.published].filter(Boolean).join(" · ").slice(0, 600),
          });
          return {
            evidence_id: hit.evidenceId,
            title: hit.title,
            locator: hit.locator,
            url: hit.url,
            year: /^\d{4}/.test(item.published) ? Number(item.published.slice(0, 4)) : null,
            summary: hit.summary,
          };
        });
        return {
          status: result.status,
          result_summary: result.resultSummary,
          citations,
        };
      },
    }),
  };
}
