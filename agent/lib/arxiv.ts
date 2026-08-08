/**
 * arXiv API 客户端 —— 文献层的唯一外部事实来源（criteria B1/C5）。
 *
 * 设计约束：
 *  - 无 LLM、无 embedding、无 vector DB。纯确定性 HTTP + 文本解析。
 *  - 不引第三方 XML 依赖：arXiv 的 Atom feed 结构固定且浅，正则手解足够。
 *  - 全局串行 + 3s 礼貌间隔 + 指数退避重试（arXiv API 使用条款要求）。
 *
 * 规范化约定：对外暴露的 arxivId 一律为 **无版本号** 形式（"2401.12345v2" → "2401.12345"）。
 * 理由：papers/ 文件名、index.md、proposal.references 三处必须用同一个 key，
 * 版本后缀会让「模型引用的 id」与「落盘的 id」漂移，B1 反查就会误判。
 */
import { arxivIdPattern } from "#lib/contracts.ts";

const API_URL = "https://export.arxiv.org/api/query";
/** arXiv 使用条款要求的请求间隔下限。 */
const MIN_INTERVAL_MS = 3_000;
const MAX_ATTEMPTS = 4;
const REQUEST_TIMEOUT_MS = 30_000;
const USER_AGENT = "luup/0.1 (+https://github.com/ImWenyaoT/luup)";
/** 单次 id_list 请求的 id 上限，超出自动分批。 */
const ID_CHUNK_SIZE = 50;

export type ArxivPaper = {
  /** 无版本号规范 id，如 "2401.12345" / "astro-ph/0601001" */
  arxivId: string;
  /** 检索时命中的版本，如 "v2"；无则 null */
  version: string | null;
  title: string;
  authors: string[];
  /** 摘要，已折叠换行 */
  summary: string;
  /** 首次提交时间（ISO） */
  published: string;
  /** 最近更新时间（ISO） */
  updated: string;
  /** 取自 published 的年份 */
  year: number;
  primaryCategory: string;
  categories: string[];
  absUrl: string;
  pdfUrl: string;
  /** 期刊/DOI 等补充信息，缺失为 null */
  doi: string | null;
  comment: string | null;
  journalRef: string | null;
};

/** 注意：不用 TS 参数属性 —— Node 的 strip-only 类型擦除不支持。 */
export class ArxivError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ArxivError";
  }
}

/* ------------------------------------------------------------------ */
/* id 规范化                                                            */
/* ------------------------------------------------------------------ */

/**
 * 把各种写法（URL、"arXiv:" 前缀、带版本号）收敛成无版本号的规范 id。
 * 不合法返回 null —— 调用方据此拒绝模型编造的 id，而不是把垃圾发给 arXiv。
 */
export function normalizeArxivId(raw: string): string | null {
  let s = String(raw ?? "").trim();
  if (!s) return null;
  s = s.replace(/^https?:\/\/(?:www\.|export\.)?arxiv\.org\/(?:abs|pdf)\//i, "");
  s = s.replace(/^arxiv:\s*/i, "");
  s = s.replace(/\.pdf$/i, "");
  s = s.replace(/v\d+$/i, "");
  s = s.trim();
  return arxivIdPattern.test(s) ? s : null;
}

/** 从 `<id>http://arxiv.org/abs/2401.12345v2</id>` 拆出 [无版本 id, 版本]。 */
function splitIdAndVersion(absId: string): { arxivId: string; version: string | null } {
  const tail = absId.replace(/^https?:\/\/(?:www\.|export\.)?arxiv\.org\/abs\//i, "").trim();
  const m = tail.match(/^(.*?)(v\d+)$/i);
  if (m) return { arxivId: m[1]!, version: m[2]!.toLowerCase() };
  return { arxivId: tail, version: null };
}

/* ------------------------------------------------------------------ */
/* XML 手解                                                             */
/* ------------------------------------------------------------------ */

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeXml(input: string): string {
  return input.replace(/&(#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, ent: string) => {
    if (ent[0] === "#") {
      const code =
        ent[1] === "x" || ent[1] === "X"
          ? Number.parseInt(ent.slice(2), 16)
          : Number.parseInt(ent.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return whole;
      try {
        return String.fromCodePoint(code);
      } catch {
        return whole;
      }
    }
    return NAMED_ENTITIES[ent.toLowerCase()] ?? whole;
  });
}

/** 解实体 + 折叠所有空白（arXiv 的 title/summary 带硬换行与缩进）。 */
function text(raw: string | undefined): string {
  if (raw === undefined) return "";
  return decodeXml(raw).replace(/\s+/g, " ").trim();
}

function tag(entry: string, name: string): string | undefined {
  const m = entry.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
  return m?.[1];
}

function attr(entry: string, openTag: string, name: string): string | undefined {
  const m = entry.match(new RegExp(`<${openTag}(?:\\s[^>]*)?\\s${name}="([^"]*)"`));
  return m?.[1];
}

function yearOf(published: string, updated: string): number {
  for (const candidate of [published, updated]) {
    const m = candidate.match(/^(\d{4})/);
    if (m) return Number.parseInt(m[1]!, 10);
  }
  return new Date().getUTCFullYear();
}

function parseEntry(entry: string): ArxivPaper | null {
  const rawId = text(tag(entry, "id"));
  // arXiv 用一条伪 entry 报错（id 指向 api/errors），不是真结果。
  if (!rawId || /arxiv\.org\/api\/errors/i.test(rawId)) return null;

  const { arxivId, version } = splitIdAndVersion(rawId);
  if (!arxivIdPattern.test(arxivId)) return null;

  const authors: string[] = [];
  for (const m of entry.matchAll(/<author>([\s\S]*?)<\/author>/g)) {
    const name = text(tag(m[1]!, "name"));
    if (name) authors.push(name);
  }

  const categories: string[] = [];
  for (const m of entry.matchAll(/<category(?:\s[^>]*)?\sterm="([^"]*)"/g)) {
    const term = text(m[1]);
    if (term && !categories.includes(term)) categories.push(term);
  }

  const primaryCategory = text(attr(entry, "arxiv:primary_category", "term")) || categories[0] || "";
  const published = text(tag(entry, "published"));
  const updated = text(tag(entry, "updated")) || published;

  return {
    arxivId,
    version,
    title: text(tag(entry, "title")),
    authors,
    summary: text(tag(entry, "summary")),
    published,
    updated,
    year: yearOf(published, updated),
    primaryCategory,
    categories,
    absUrl: `https://arxiv.org/abs/${arxivId}`,
    pdfUrl: `https://arxiv.org/pdf/${arxivId}`,
    doi: text(tag(entry, "arxiv:doi")) || null,
    comment: text(tag(entry, "arxiv:comment")) || null,
    journalRef: text(tag(entry, "arxiv:journal_ref")) || null,
  };
}

export function parseArxivFeed(xml: string): ArxivPaper[] {
  const papers: ArxivPaper[] = [];
  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const paper = parseEntry(m[1]!);
    if (paper) papers.push(paper);
  }
  return papers;
}

/* ------------------------------------------------------------------ */
/* 礼貌节流 + 重试                                                       */
/* ------------------------------------------------------------------ */

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 进程内全局串行队列：任意两次 arXiv 请求之间至少间隔 MIN_INTERVAL_MS。 */
let queue: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;

function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = MIN_INTERVAL_MS - (Date.now() - lastRequestAt);
    if (wait > 0) await sleep(wait);
    try {
      return await job();
    } finally {
      lastRequestAt = Date.now();
    }
  });
  // 队列本身不因单个任务失败而中断
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function fetchFeed(params: URLSearchParams): Promise<string> {
  const url = `${API_URL}?${params.toString()}`;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) await sleep(MIN_INTERVAL_MS * 2 ** (attempt - 1));
    try {
      return await enqueue(async () => {
        const res = await fetch(url, {
          headers: { "user-agent": USER_AGENT, accept: "application/atom+xml" },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (!res.ok) throw new ArxivError(`arXiv API HTTP ${res.status}`);
        const body = await res.text();
        if (!body.includes("<feed")) throw new ArxivError("arXiv API 返回非 Atom 内容");
        return body;
      });
    } catch (e) {
      lastError = e;
    }
  }
  throw new ArxivError(`arXiv API 请求失败（${MAX_ATTEMPTS} 次尝试后放弃）: ${url}`, {
    cause: lastError,
  });
}

/* ------------------------------------------------------------------ */
/* 公开 API                                                             */
/* ------------------------------------------------------------------ */

export type SortBy = "relevance" | "lastUpdatedDate" | "submittedDate";

const FIELD_PREFIXES = /\b(all|ti|abs|au|cat|co|jr|rn|id):/i;

/**
 * 自由文本 → arXiv search_query。已经写了字段前缀 / 布尔算子的原样透传，
 * 否则整句包成 `all:"..."`，避免被 arXiv 拆成隐式 OR 导致召回噪声。
 */
export function buildSearchQuery(query: string): string {
  const q = query.trim();
  if (!q) throw new ArxivError("检索词为空");
  if (FIELD_PREFIXES.test(q)) return q;
  return `all:"${q.replace(/"/g, " ").trim()}"`;
}

/** 按自由文本检索 arXiv。返回的每条都是 arXiv 实际返回的元数据，无任何本地编造。 */
export async function searchArxiv(
  query: string,
  maxResults = 10,
  options: { sortBy?: SortBy; start?: number } = {},
): Promise<ArxivPaper[]> {
  const capped = Math.max(1, Math.min(100, Math.floor(maxResults)));
  const params = new URLSearchParams({
    search_query: buildSearchQuery(query),
    start: String(Math.max(0, Math.floor(options.start ?? 0))),
    max_results: String(capped),
    sortBy: options.sortBy ?? "relevance",
    sortOrder: "descending",
  });
  return parseArxivFeed(await fetchFeed(params)).slice(0, capped);
}

/**
 * 按 id 精确取全量元数据。非法 id 直接丢弃（不发给 arXiv）。
 * 结果按传入顺序返回，未命中的 id 不出现在结果里 —— 调用方据此判定「查无此文」。
 */
export async function getArxiv(idList: string[]): Promise<ArxivPaper[]> {
  const ids: string[] = [];
  for (const raw of idList) {
    const id = normalizeArxivId(raw);
    if (id && !ids.includes(id)) ids.push(id);
  }
  if (ids.length === 0) return [];

  const found = new Map<string, ArxivPaper>();
  for (let i = 0; i < ids.length; i += ID_CHUNK_SIZE) {
    const chunk = ids.slice(i, i + ID_CHUNK_SIZE);
    const params = new URLSearchParams({
      id_list: chunk.join(","),
      max_results: String(chunk.length),
    });
    for (const paper of parseArxivFeed(await fetchFeed(params))) {
      found.set(paper.arxivId, paper);
    }
  }
  return ids.map((id) => found.get(id)).filter((p): p is ArxivPaper => p !== undefined);
}
