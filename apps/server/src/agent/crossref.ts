import type { EvidenceStatus } from "./contracts.ts";
import { createRateLimiter } from "./rate-limit.ts";

export type CrossrefRecord = {
  doi: string;
  title: string;
  url: string;
  authors: string[];
  published: string;
  container: string;
};

export type CrossrefSearchResult = {
  query: string;
  status: EvidenceStatus;
  resultSummary: string;
  records: CrossrefRecord[];
  execution: Record<string, unknown>;
};

const ENDPOINT = "https://api.crossref.org/works";
const CALL_TIMEOUT_MS = 10_000;
const MIN_INTERVAL_MS = 1_000;

// Crossref 的 polite pool：带上能联系到人的 User-Agent 就进较宽松的队列，
// 匿名请求会被丢进 public pool，限流更紧且随时可能变。
const CONTACT = "hythmealot@gmail.com";
const USER_AGENT = `luup/0.1 (https://github.com/ImWenyaoT/luup; mailto:${CONTACT})`;

const acquire = createRateLimiter(MIN_INTERVAL_MS);

/** DOI 精确反查失败。404 由 resolveCrossrefDoi 返回 null；其余网络/服务故障抛出此类。 */
export class CrossrefLookupError extends Error {
  override readonly name = "CrossrefLookupError";
}

function textOf(value: unknown): string {
  if (typeof value === "string") return value.replace(/\s+/g, " ").trim();
  if (Array.isArray(value)) return textOf(value[0]);
  return "";
}

function toRecord(item: unknown): CrossrefRecord | null {
  if (!item || typeof item !== "object") return null;
  const recordItem = item as Record<string, unknown>;
  const doi = textOf(recordItem.DOI);
  const title = textOf(recordItem.title);
  // 没有 DOI 就没有稳定标识，引用无从核验，宁可丢掉也不放进证据。
  if (!doi || !title) return null;
  const rawAuthors = Array.isArray(recordItem.author) ? recordItem.author : [];
  const authors = rawAuthors
    .map((author: unknown) => {
      if (author && typeof author === "object") {
        const authRecord = author as Record<string, unknown>;
        return [textOf(authRecord.given), textOf(authRecord.family)].filter(Boolean).join(" ");
      }
      return "";
    })
    .filter((name: string) => name.length > 0);
  const issued =
    recordItem.issued && typeof recordItem.issued === "object" ? (recordItem.issued as Record<string, unknown>) : null;
  const parts = Array.isArray(issued?.["date-parts"]) ? issued?.["date-parts"]?.[0] : null;
  return {
    doi,
    title,
    url: `https://doi.org/${doi}`,
    authors,
    published: Array.isArray(parts) ? parts.filter(Boolean).join("-") : "",
    container: textOf(recordItem["container-title"]),
  };
}

function failure(
  query: string,
  status: EvidenceStatus,
  resultSummary: string,
  execution: Record<string, unknown> = {},
): CrossrefSearchResult {
  return { query, status, resultSummary, records: [], execution };
}

/** 检索 Crossref 的 DOI 出版元数据。与 arXiv 适配器同形：任何失败都编码成 status 返回，不抛。 */
export async function searchCrossref(
  rawQuery: string,
  options: {
    rows?: number;
    fetchImpl?: typeof fetch;
    minIntervalMs?: number;
    signal?: AbortSignal;
  } = {},
): Promise<CrossrefSearchResult> {
  const query = rawQuery.split(/\s+/).filter(Boolean).join(" ");
  if (!query) return failure("<empty>", "refused", "Crossref query is empty");
  const rows = Math.min(Math.max(options.rows ?? 5, 1), 20);
  const doFetch = options.fetchImpl ?? fetch;

  const url = new URL(ENDPOINT);
  url.searchParams.set("query", query);
  url.searchParams.set("rows", String(rows));
  url.searchParams.set("select", "DOI,title,author,URL,issued,container-title");

  await acquire(options.minIntervalMs, options.signal);
  const startedAt = Date.now();
  let response: Response;
  try {
    const timeout = AbortSignal.timeout(CALL_TIMEOUT_MS);
    response = await doFetch(url, {
      signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
      headers: { "user-agent": USER_AGENT },
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    const name = error instanceof Error ? error.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      return failure(query, "timeout", "Crossref search exceeded its deadline", {
        request_url: url.toString(),
        elapsed_ms: Date.now() - startedAt,
      });
    }
    return failure(query, "failed", "Crossref search failed before producing records", {
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
      `Crossref returned HTTP ${response.status}`,
      execution,
    );
  }

  let items: unknown[];
  try {
    const json = (await response.json()) as { message?: { items?: unknown[] } } | null;
    items = Array.isArray(json?.message?.items) ? json.message.items : [];
  } catch (error) {
    return failure(query, "failed", "Crossref returned unparsable JSON", {
      ...execution,
      exception_type: error instanceof Error ? error.name : "Error",
    });
  }

  const records = items
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .map(toRecord)
    .filter((item): item is CrossrefRecord => item !== null);
  if (records.length === 0) {
    return { query, status: "empty", resultSummary: "Crossref returned no citable records", records, execution };
  }
  const status: EvidenceStatus = records.length < items.length ? "partial" : "succeeded";
  return {
    query,
    status,
    resultSummary:
      status === "partial"
        ? `Crossref returned ${records.length} citable record(s), ${items.length - records.length} unusable`
        : `Crossref returned ${records.length} citable record(s)`,
    records,
    execution,
  };
}

function normalizeDoiForLookup(value: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(value.trim());
  } catch {
    return null;
  }
  const normalized = decoded
    .replace(/^doi:\s*/i, "")
    .trim()
    .toLowerCase();
  return /^10\.\d{4,9}\/\S+$/i.test(normalized) ? normalized : null;
}

/** 按一个 DOI 精确读取 Crossref `/works/{doi}`，绝不退化成关键词 search。 */
export async function resolveCrossrefDoi(
  rawDoi: string,
  options: { fetchImpl?: typeof fetch; minIntervalMs?: number; signal?: AbortSignal } = {},
): Promise<CrossrefRecord | null> {
  const doi = normalizeDoiForLookup(rawDoi);
  if (doi === null) return null;
  const doFetch = options.fetchImpl ?? fetch;
  const url = new URL(`${ENDPOINT}/${encodeURIComponent(doi)}`);

  await acquire(options.minIntervalMs, options.signal);
  let response: Response;
  try {
    const timeout = AbortSignal.timeout(CALL_TIMEOUT_MS);
    response = await doFetch(url, {
      signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
      headers: { "user-agent": USER_AGENT },
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new CrossrefLookupError(
      `Crossref DOI lookup failed: ${error instanceof Error ? error.message : String(error)}`,
      {
        cause: error,
      },
    );
  }

  if (response.status === 404) return null;
  if (!response.ok) throw new CrossrefLookupError(`Crossref DOI lookup returned HTTP ${response.status}`);

  let item: unknown;
  try {
    item = ((await response.json()) as { message?: unknown })?.message;
  } catch (error) {
    throw new CrossrefLookupError("Crossref DOI lookup returned unparsable JSON", { cause: error });
  }
  const record = toRecord(item);
  if (record === null || normalizeDoiForLookup(record.doi) !== doi) return null;
  return record;
}
