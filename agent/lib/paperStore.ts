/**
 * 文件式文献 memory（architecture.md「memory 布局」，criteria C5）。
 *
 *   runs/<ts>/memory/
 *     papers/<arxivId>.md   # L2 全文卡：标题/作者/摘要/日期 + 机器可读 frontmatter
 *     index.md              # L0/L1：每篇一行（id | 年份 | 标题 | 一句话摘要）
 *
 * 关键不变式：**index.md 是 papers/ 的派生物**。每次 savePaper 都从磁盘重建整份
 * index，不做增量追加 —— 索引因此不可能与 papers/ 漂移，也不依赖模型自觉登记。
 *
 * 文件名映射：`"/" → "__"`，与 scripts/verify-proposal.ts 的还原逻辑
 * （`f.replace(/\.md$/,"").replace(/__/g,"/")`）严格互逆。arXiv id 字符集不含
 * 下划线，因此该映射是单射。
 *
 * 无 LLM、无 embedding、无 vector DB：一句话摘要是抽取式的（摘要首句），不是生成的。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { ArxivPaper } from "./arxiv.ts";
import { upsertLibraryPaper } from "./campaignMemory.ts";

/* ------------------------------------------------------------------ */
/* runDir 解析                                                          */
/* ------------------------------------------------------------------ */

/**
 * runDir 通过环境变量 `LUUP_RUN_DIR` 传递，**不作为工具入参**。
 *
 * 理由（依 eve tool 执行环境约定）：
 *  1. eve 的 tool 跑在 app runtime，`process.env` 全量可读（docs/tools/overview.mdx），
 *     而 sandbox 才是隔离的 —— 环境变量是这里最自然的进程级配置通道。
 *  2. 引用真实性防线要求「papers/ 只装本次运行实检命中的文献」。若 runDir 是入参，
 *     模型就能把 run 目录指向历史 run 或任意路径，B1 的「本次运行」语义当场失效。
 *     把它移出模型可控面，是 schema/机制层的约束，不是 prompt 层的约定。
 *  3. 外层驱动（eve invoke / 脚本）本来就要先建 runs/<ts>/ 再触发，顺手 export 即可。
 */
export const RUN_DIR_ENV = "LUUP_RUN_DIR";

let fallbackRunDir: string | null = null;

function utcStamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`
  );
}

/**
 * 取当前 run 目录。未设 `LUUP_RUN_DIR` 时退化为进程内一次性创建的
 * `runs/<utc-ts>/`（每个进程只创建一次并记忆），保证 `eve dev` 手工试跑也能用，
 * 且同一进程内多次调用始终落在同一个 run 里。
 */
export function resolveRunDir(): string {
  const fromEnv = process.env[RUN_DIR_ENV]?.trim();
  if (fromEnv) return resolve(process.cwd(), fromEnv);
  if (fallbackRunDir) return fallbackRunDir;
  fallbackRunDir = resolve(process.cwd(), "runs", utcStamp());
  console.warn(`[paperStore] ${RUN_DIR_ENV} 未设置，本进程回退到 ${fallbackRunDir}`);
  return fallbackRunDir;
}

/** 仅供测试：清掉回退目录记忆。 */
export function resetRunDirFallback(): void {
  fallbackRunDir = null;
}

export const memoryDir = (runDir: string) => join(runDir, "memory");
export const papersDir = (runDir: string) => join(memoryDir(runDir), "papers");
export const indexPath = (runDir: string) => join(memoryDir(runDir), "index.md");

/* ------------------------------------------------------------------ */
/* 文件名映射（与 verify-proposal.ts 互逆）                                */
/* ------------------------------------------------------------------ */

/** `astro-ph/0601001` → `astro-ph__0601001.md` */
export function paperFilename(arxivId: string): string {
  return `${arxivId.replace(/\//g, "__")}.md`;
}

/** `astro-ph__0601001.md` → `astro-ph/0601001`（verify-proposal.ts 用的同一还原式） */
export function arxivIdFromFilename(filename: string): string {
  return filename.replace(/\.md$/, "").replace(/__/g, "/");
}

export function paperPath(runDir: string, arxivId: string): string {
  return join(papersDir(runDir), paperFilename(arxivId));
}

/* ------------------------------------------------------------------ */
/* 抽取式一句话摘要（确定性，无 LLM）                                      */
/* ------------------------------------------------------------------ */

/** 取摘要的前若干句，凑够 minLen 字符即停，最长 maxLen。 */
export function firstSentence(abstract: string, minLen = 60, maxLen = 240): string {
  const flat = abstract.replace(/\s+/g, " ").trim();
  if (!flat) return "";
  const parts = flat.split(/(?<=[.!?。！？])\s+/);
  let out = "";
  for (const part of parts) {
    out = out ? `${out} ${part}` : part;
    if (out.length >= minLen) break;
  }
  if (out.length > maxLen) out = `${out.slice(0, maxLen - 1).trimEnd()}…`;
  return out;
}

/* ------------------------------------------------------------------ */
/* 卡片 frontmatter                                                     */
/* ------------------------------------------------------------------ */

/** 落盘卡片的机器可读头部；每行 `key: <JSON 值>`，无第三方 YAML 依赖。 */
export type PaperCard = {
  arxivId: string;
  year: number;
  title: string;
  authors: string[];
  published: string;
  updated: string;
  primaryCategory: string;
  categories: string[];
  url: string;
  oneline: string;
};

const CARD_KEYS = [
  "arxivId",
  "year",
  "title",
  "authors",
  "published",
  "updated",
  "primaryCategory",
  "categories",
  "url",
  "oneline",
] as const;

export function toCard(paper: ArxivPaper): PaperCard {
  return {
    arxivId: paper.arxivId,
    year: paper.year,
    title: paper.title,
    authors: paper.authors,
    published: paper.published,
    updated: paper.updated,
    primaryCategory: paper.primaryCategory,
    categories: paper.categories,
    url: paper.absUrl,
    oneline: firstSentence(paper.summary),
  };
}

function renderFrontmatter(card: PaperCard): string {
  const lines = CARD_KEYS.map((k) => `${k}: ${JSON.stringify(card[k])}`);
  return ["---", ...lines, "---"].join("\n");
}

function parseFrontmatter(content: string): Partial<PaperCard> | null {
  if (!content.startsWith("---")) return null;
  const end = content.indexOf("\n---", 3);
  if (end === -1) return null;
  const body = content.slice(content.indexOf("\n") + 1, end);
  const out: Record<string, unknown> = {};
  for (const line of body.split("\n")) {
    const sep = line.indexOf(":");
    if (sep <= 0) continue;
    const key = line.slice(0, sep).trim();
    try {
      out[key] = JSON.parse(line.slice(sep + 1).trim());
    } catch {
      /* 忽略无法解析的行，由 readCard 兜底 */
    }
  }
  return out as Partial<PaperCard>;
}

export function renderPaperMarkdown(paper: ArxivPaper): string {
  const card = toCard(paper);
  return [
    renderFrontmatter(card),
    "",
    `# ${paper.title || paper.arxivId}`,
    "",
    `- **arXiv**: [${paper.arxivId}](${paper.absUrl})`,
    `- **Authors**: ${paper.authors.join(", ") || "(unknown)"}`,
    `- **Published**: ${paper.published || "(unknown)"}${
      paper.updated && paper.updated !== paper.published ? `　**Updated**: ${paper.updated}` : ""
    }`,
    `- **Categories**: ${paper.primaryCategory}${
      paper.categories.length > 1 ? ` (${paper.categories.join(", ")})` : ""
    }`,
    ...(paper.doi ? [`- **DOI**: ${paper.doi}`] : []),
    ...(paper.journalRef ? [`- **Journal ref**: ${paper.journalRef}`] : []),
    ...(paper.comment ? [`- **Comment**: ${paper.comment}`] : []),
    "",
    "## Abstract",
    "",
    paper.summary || "(arXiv 未提供摘要)",
    "",
  ].join("\n");
}

/* ------------------------------------------------------------------ */
/* 读写                                                                 */
/* ------------------------------------------------------------------ */

function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

export type SaveResult = {
  arxivId: string;
  path: string;
  /** false 表示同一 run 内已存在，本次为覆盖更新 */
  created: boolean;
};

/**
 * 落盘一篇文献卡片，并**强制重建** index.md。
 * `paper` 必须来自 arXiv API 的真实返回（见 agent/lib/tools/arxiv_save.ts），
 * 本函数不校验内容真伪，只保证「写进来的东西同时进索引」。
 */
export function savePaper(runDir: string, paper: ArxivPaper): SaveResult {
  const dir = papersDir(runDir);
  ensureDir(dir);
  const file = paperPath(runDir, paper.arxivId);
  const created = !existsSync(file);
  const markdown = renderPaperMarkdown(paper);
  writeFileSync(file, markdown, "utf8");
  rebuildIndex(runDir);

  /*
   * campaign 层同步（docs/design/memory.md「library/ agent 不可直写」）：
   * 全局卡与 library/index.md 由**代码**在这里派生，模型没有任何通道插手。
   * 两条纪律：memory/ 不存在时 upsert 静默 no-op（可删除性红线）；即便它出错，
   * 也只告警不抛 —— run 层的 B1 证据链绝不能被加速层拖垮。
   */
  try {
    upsertLibraryPaper({ card: toCard(paper), markdown });
  } catch (e) {
    console.warn(`[paperStore] campaign memory 同步失败（不影响本 run）：${String(e)}`);
  }

  return { arxivId: paper.arxivId, path: file, created };
}

export function savePapers(runDir: string, papers: ArxivPaper[]): SaveResult[] {
  return papers.map((p) => savePaper(runDir, p));
}

/** 本次 run 已实检命中的 arXiv id 列表（升序）。 */
export function listPapers(runDir: string): string[] {
  const dir = papersDir(runDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map(arxivIdFromFilename)
    .sort((a, b) => a.localeCompare(b));
}

/** 读回一篇卡片的结构化头部；文件缺失或头部损坏返回 null。 */
export function readCard(runDir: string, arxivId: string): PaperCard | null {
  const file = paperPath(runDir, arxivId);
  if (!existsSync(file)) return null;
  const parsed = parseFrontmatter(readFileSync(file, "utf8"));
  if (!parsed) return null;
  return {
    arxivId: typeof parsed.arxivId === "string" ? parsed.arxivId : arxivId,
    year: typeof parsed.year === "number" ? parsed.year : 0,
    title: typeof parsed.title === "string" ? parsed.title : "",
    authors: Array.isArray(parsed.authors) ? parsed.authors : [],
    published: typeof parsed.published === "string" ? parsed.published : "",
    updated: typeof parsed.updated === "string" ? parsed.updated : "",
    primaryCategory: typeof parsed.primaryCategory === "string" ? parsed.primaryCategory : "",
    categories: Array.isArray(parsed.categories) ? parsed.categories : [],
    url: typeof parsed.url === "string" ? parsed.url : `https://arxiv.org/abs/${arxivId}`,
    oneline: typeof parsed.oneline === "string" ? parsed.oneline : "",
  };
}

export function readCards(runDir: string): PaperCard[] {
  return listPapers(runDir)
    .map((id) => readCard(runDir, id))
    .filter((c): c is PaperCard => c !== null);
}

const escapeCell = (s: string) => s.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();

/** 从 papers/ 重建整份 index.md。幂等；savePaper 每次都调。 */
export function rebuildIndex(runDir: string): string {
  const cards = readCards(runDir);
  const lines = [
    "# 文献索引",
    "",
    `由 \`agent/lib/paperStore.ts\` 从 \`memory/papers/\` 自动重建，请勿手改。`,
    `共 ${cards.length} 篇 · 更新于 ${new Date().toISOString()}`,
    "",
    "| arXiv id | 年份 | 标题 | 一句话摘要 |",
    "| --- | --- | --- | --- |",
    ...cards.map(
      (c) =>
        `| ${escapeCell(c.arxivId)} | ${c.year || "?"} | ${escapeCell(c.title)} | ${escapeCell(c.oneline)} |`,
    ),
    "",
  ];
  const content = lines.join("\n");
  const target = indexPath(runDir);
  ensureDir(dirname(target));
  writeFileSync(target, content, "utf8");
  return content;
}

/** 读 index.md 原文；不存在时按当前 papers/ 现场重建（可能是空索引）。 */
export function readIndex(runDir: string): string {
  const target = indexPath(runDir);
  if (!existsSync(target)) return rebuildIndex(runDir);
  return readFileSync(target, "utf8");
}

/** 解析 index.md 的数据行 —— 供自测/验收断言用，不给模型。 */
export function parseIndexRows(indexMarkdown: string): Array<{
  arxivId: string;
  year: string;
  title: string;
  oneline: string;
}> {
  const rows: Array<{ arxivId: string; year: string; title: string; oneline: string }> = [];
  for (const line of indexMarkdown.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("|") || !t.endsWith("|")) continue;
    const cells = t
      .slice(1, -1)
      .split(/(?<!\\)\|/)
      .map((c) => c.trim().replace(/\\\|/g, "|"));
    if (cells.length !== 4) continue;
    if (cells[0] === "arXiv id" || /^-{2,}$/.test(cells[0] ?? "")) continue;
    rows.push({
      arxivId: cells[0] ?? "",
      year: cells[1] ?? "",
      title: cells[2] ?? "",
      oneline: cells[3] ?? "",
    });
  }
  return rows;
}
