import { XMLParser } from "fast-xml-parser";

import type { EvidenceStatus } from "./contracts.ts";
import { createRateLimiter } from "./rate-limit.ts";

export type ArxivRecord = {
  arxivId: string;
  title: string;
  url: string;
  summary: string;
  authors: string[];
  published: string;
};

/** 独立反查失败。检索走 status 编码，反查走异常 —— 两条通路的调用方要的东西不一样：
 *  检索的调用方是模型，它需要一个能如实上报的结局；反查的调用方是验收器，
 *  它必须能把「查不到」和「网络不通」分开，后者不是引用造假。 */
export class ArxivLookupError extends Error {
  override readonly name = "ArxivLookupError";
}

export type ArxivSearchResult = {
  query: string;
  status: EvidenceStatus;
  resultSummary: string;
  records: ArxivRecord[];
  /** 排障用的执行现场，不进 Artifact。 */
  execution: Record<string, unknown>;
};

const ENDPOINT = "https://export.arxiv.org/api/query";
// 与 Python `backend/app/agent/tools/arxiv.py` 的 `httpx.Timeout(30.0)` 同一个数。
// 原值 10s 是拍脑袋的：canary 现场两次 `arxiv_search` 都卡在这条线上超时，而同一时刻
// arXiv 直连是健康的（简单查询 1.3–1.6s）——超的不是网络，是模型生成的复杂检索式，
// 那类查询在 arXiv 上要 3–10s+。10s 把「慢查询」误判成了「服务不可达」。
const CALL_TIMEOUT_MS = 30_000;

// arXiv 官方要求同源请求间隔 ≥3 秒，超了直接 429。这把闸是**模块级**的：
// 整个进程共用一个发号窗口，不管有多少个并发角色在检索。
// 绕过这个适配器直接打 arXiv 会把整台机器的 IP 打进临时封禁（表现是不给响应，不是 429）。
const MIN_INTERVAL_MS = 3_000;
const acquire = createRateLimiter(MIN_INTERVAL_MS);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  isArray: (name) => name === "entry" || name === "author" || name === "link",
});

function textOf(value: unknown): string {
  if (typeof value === "string") return value.replace(/\s+/g, " ").trim();
  if (typeof value === "number") return String(value);
  if (value && typeof value === "object" && "#text" in value) {
    return textOf((value as { "#text": unknown })["#text"]);
  }
  return "";
}

/** 把一个 Atom entry 变成可引用记录；缺关键字段就返回 null，由调用方计入 partial。 */
function toRecord(entry: any): ArxivRecord | null {
  const rawId = textOf(entry?.id);
  const title = textOf(entry?.title);
  if (!rawId || !title) return null;
  // id 形如 http://arxiv.org/abs/2301.12345v2
  const match = /arxiv\.org\/abs\/(.+)$/.exec(rawId);
  if (!match) return null;
  const arxivId = match[1]!;
  const authors = (Array.isArray(entry?.author) ? entry.author : [entry?.author])
    .map((item: unknown) => textOf((item as { name?: unknown })?.name))
    .filter((name: string) => name.length > 0);
  return {
    arxivId,
    title,
    // 统一用 https 的 abs 链接，别原样透传 arXiv 返回的 http。
    url: `https://arxiv.org/abs/${arxivId}`,
    summary: textOf(entry?.summary),
    authors,
    published: textOf(entry?.published),
  };
}

function failure(
  query: string,
  status: EvidenceStatus,
  resultSummary: string,
  execution: Record<string, unknown> = {},
): ArxivSearchResult {
  return { query, status, resultSummary, records: [], execution };
}

/** 检索 arXiv。任何失败都编码成 status 返回，不抛异常 —— 调用方要的是可审计的结局，
 *  不是一个会炸掉整个 Attempt 的异常。 */
export async function searchArxiv(
  rawQuery: string,
  options: {
    maxResults?: number;
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
    /** 仅供离线测试把等待压到 0。真实调用别传 —— 默认就是官方要求的 3 秒。 */
    minIntervalMs?: number;
  } = {},
): Promise<ArxivSearchResult> {
  const query = rawQuery.split(/\s+/).filter(Boolean).join(" ");
  if (!query) return failure("<empty>", "refused", "arXiv query is empty");
  const maxResults = Math.min(Math.max(options.maxResults ?? 5, 1), 20);
  const doFetch = options.fetchImpl ?? fetch;

  const url = new URL(ENDPOINT);
  url.searchParams.set("search_query", `all:${query}`);
  url.searchParams.set("start", "0");
  url.searchParams.set("max_results", String(maxResults));
  url.searchParams.set("sortBy", "relevance");
  url.searchParams.set("sortOrder", "descending");

  await acquire(options.minIntervalMs, options.signal);
  const startedAt = Date.now();
  let response: Response;
  try {
    const timeout = AbortSignal.timeout(CALL_TIMEOUT_MS);
    response = await doFetch(url, {
      signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
      headers: { "user-agent": "luup-agents-spike/0.1 (research prototype)" },
    });
  } catch (error) {
    // Attempt 取消必须一路抛回 Runner，不能伪装成一次普通检索失败后继续执行工具。
    if (options.signal?.aborted) throw error;
    const name = error instanceof Error ? error.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      return failure(query, "timeout", "arXiv search exceeded its deadline", {
        request_url: url.toString(),
        elapsed_ms: Date.now() - startedAt,
      });
    }
    return failure(query, "failed", "arXiv search failed before producing records", {
      request_url: url.toString(),
      exception_type: name || "Error",
      message: error instanceof Error ? error.message : String(error),
    });
  }

  const execution: Record<string, unknown> = {
    request_url: url.toString(),
    http_status: response.status,
    elapsed_ms: Date.now() - startedAt,
  };

  if (!response.ok) {
    return failure(
      query,
      response.status === 429 ? "rate_limited" : "source_unavailable",
      `arXiv returned HTTP ${response.status}`,
      execution,
    );
  }

  let entries: any[];
  try {
    const feed = parser.parse(await response.text())?.feed;
    entries = Array.isArray(feed?.entry) ? feed.entry : [];
  } catch (error) {
    return failure(query, "failed", "arXiv returned unparsable Atom", {
      ...execution,
      exception_type: error instanceof Error ? error.name : "Error",
    });
  }

  const records = entries.map(toRecord).filter((item): item is ArxivRecord => item !== null);
  if (records.length === 0) {
    return { query, status: "empty", resultSummary: "arXiv returned no valid records", records, execution };
  }
  // 有 entry 被丢掉 = 部分成功。这个区分要留住：partial 和 succeeded 对下游是两回事。
  const status: EvidenceStatus = records.length < entries.length ? "partial" : "succeeded";
  return {
    query,
    status,
    resultSummary: status === "partial"
      ? `arXiv returned ${records.length} citable record(s), ${entries.length - records.length} unusable`
      : `arXiv returned ${records.length} citable record(s)`,
    records,
    execution,
  };
}

/** arXiv 的 `published` 是 ISO 时间戳；取发表年份供引用元数据比对。 */
export function publishedYear(published: string): number | null {
  const match = /^(\d{4})-/.exec(published.trim());
  return match ? Number(match[1]) : null;
}

/** 按 id 独立反查 arXiv 记录，用于引用验收 —— 不是检索，是核对。
 *
 * 与 `searchArxiv` 的两点区别都是刻意的：
 * 1. 走 `id_list` 而不是 `search_query=all:`，命中的是**这个 id 本身**，
 *    不是「某个字段里出现过这串数字的论文」，否则反查会被相关论文冒名顶替。
 * 2. 任何失败都抛 ArxivLookupError。验收器据此把基础设施故障与引用造假分开，
 *    把网络抖动编码成一条 status 会让两者混进同一个失败堆里。
 *
 * 反查经过与检索同一把模块级限速闸；验收发生在 Run 末尾，多等 3 秒无所谓。
 */
export async function fetchArxivByIds(
  ids: readonly string[],
  options: { fetchImpl?: typeof fetch; signal?: AbortSignal; minIntervalMs?: number } = {},
): Promise<ArxivRecord[]> {
  const wanted = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  if (wanted.length === 0) return [];
  const doFetch = options.fetchImpl ?? fetch;

  const url = new URL(ENDPOINT);
  url.searchParams.set("id_list", wanted.join(","));
  url.searchParams.set("max_results", String(wanted.length));

  await acquire(options.minIntervalMs, options.signal);
  let response: Response;
  try {
    const timeout = AbortSignal.timeout(CALL_TIMEOUT_MS);
    response = await doFetch(url, {
      signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
      headers: { "user-agent": "luup-agents-spike/0.1 (research prototype)" },
    });
  } catch (error) {
    // 取消一路抛回调用方，不伪装成一次反查失败。
    if (options.signal?.aborted) throw error;
    throw new ArxivLookupError(
      `arXiv lookup failed: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  if (!response.ok) throw new ArxivLookupError(`arXiv lookup returned HTTP ${response.status}`);

  let entries: any[];
  try {
    const feed = parser.parse(await response.text())?.feed;
    entries = Array.isArray(feed?.entry) ? feed.entry : [];
  } catch (error) {
    throw new ArxivLookupError("arXiv lookup returned unparsable Atom", { cause: error });
  }
  // 反查不到的 id 直接缺席，由验收器判成 B2 失败 —— 那正是「引用了不存在的论文」的样子。
  return entries.map(toRecord).filter((item): item is ArxivRecord => item !== null);
}
