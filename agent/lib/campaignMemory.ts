/**
 * campaign-scoped 长期记忆（docs/design/memory.md 第二层，服务 125 题战役）。
 *
 *   memory/
 *     SCHEMA.md          行为契约（给 agent 读；含 non-goals）
 *     index.md           内容目录（代码派生）
 *     log.md             时序日志（append-only，`## [date] <action> | q<id> | <verdict>`）
 *     library/papers/    全局文献卡 L2（代码派生自 run 卡）
 *     library/index.md   全局文献索引 L0/L1，按 arXiv 学科分组（代码派生）
 *     questions/q<id>.md 每题战役页（append-only）
 *     lessons.md         运营级教训（append-only）
 *
 * 三条设计约束，改这个文件前先读一遍：
 *
 *  1. **可删除性红线**（memory.md 验收标准④）：`memory/` 不存在时本模块**每一个**导出
 *     函数都静默 no-op 并返回 `skipped:true`，绝不创建目录、绝不抛异常。长期记忆是
 *     加速层，不是依赖 —— 删掉它流水线必须照常跑通。
 *  2. **无 RAG**：检索是逐行确定性字符匹配，没有 embedding、没有向量、没有 BM25 打分
 *     模型。karpathy 的 llm-wiki 给规模留了 qmd 向量后门，我们不留（SCHEMA.md non-goals）。
 *  3. **索引是派生物**：`library/index.md` 与 `index.md` 每次写入都从磁盘整份重建，
 *     不做增量追加 —— 与 run 层 `paperStore.rebuildIndex` 同一条纪律。agent 不可直写。
 *  4. **单写者假设**：本模块没有文件锁。`upsertLibraryPaper` 是「读卡 → 合并 questionIds
 *     → 写回」，两个 pipeline 进程同时 upsert **同一 arxivId** 会丢反向索引条目
 *     （实测 8 进程并发丢 1~2 个题号）。生产上由 `runs/.active.json` 单并发锁
 *     （`lib/lock.ts`，web 入口）与 `scripts/run-batch.ts` 的串行循环保证单写者，
 *     手工并行跑多个 `scripts/run.ts` 则会踩到。**丢的只是「用于题号」这一列线索**：
 *     卡片元数据、index 行数、B1 证据链都不受影响（index 每次整份重建，下一次
 *     upsert 自愈）。要上多进程并跑，先在这里加锁再说。
 *
 * 依赖方向单向：`paperStore` → `campaignMemory`。本模块对 paperStore 只有 type-only
 * import（编译期擦除），因此运行时没有循环。
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { PaperCard } from "./paperStore.ts";

/* ------------------------------------------------------------------ */
/* 路径解析                                                             */
/* ------------------------------------------------------------------ */

/** 仓库根：本文件在 agent/lib/ 下，向上两级。与 cwd 无关，脚本从哪跑都对。 */
const repoRoot = resolve(import.meta.dirname, "..", "..");

/** 测试用：把 campaign memory 指到临时目录（生产不设，走仓库根 memory/）。 */
export const MEMORY_DIR_ENV = "LUUP_MEMORY_DIR";

export function resolveMemoryDir(): string {
  const fromEnv = process.env[MEMORY_DIR_ENV]?.trim();
  return fromEnv ? resolve(process.cwd(), fromEnv) : join(repoRoot, "memory");
}

/**
 * 唯一的开关：目录在 = 启用，目录不在 = 全模块 no-op。
 * 故意只看根目录 —— 子目录缺失由各写入路径按需补建，但**根目录绝不自动创建**，
 * 否则「删掉 memory/」这个动作就没有意义了。
 */
export function memoryEnabled(memoryDir = resolveMemoryDir()): boolean {
  return existsSync(memoryDir);
}

export const libraryDir = (dir = resolveMemoryDir()) => join(dir, "library");
export const libraryPapersDir = (dir = resolveMemoryDir()) => join(libraryDir(dir), "papers");
export const libraryIndexPath = (dir = resolveMemoryDir()) => join(libraryDir(dir), "index.md");
export const questionsDir = (dir = resolveMemoryDir()) => join(dir, "questions");
export const questionPath = (questionId: number, dir = resolveMemoryDir()) =>
  join(questionsDir(dir), `q${questionId}.md`);
export const lessonsPath = (dir = resolveMemoryDir()) => join(dir, "lessons.md");
export const logPath = (dir = resolveMemoryDir()) => join(dir, "log.md");
export const memoryIndexPath = (dir = resolveMemoryDir()) => join(dir, "index.md");

/** 对外报路径一律用 `memory/...` 形式：稳定、可 grep，且不泄露临时目录。 */
function display(abs: string, dir = resolveMemoryDir()): string {
  const base = resolve(dir);
  const a = resolve(abs);
  return a === base ? "memory" : `memory/${a.slice(base.length + 1).split(/[\\/]/).join("/")}`;
}

/** 文件名映射与 paperStore 一致（`/` → `__`），保持两层卡片一一对应。 */
export const libraryCardFilename = (arxivId: string) => `${arxivId.replace(/\//g, "__")}.md`;

/* ------------------------------------------------------------------ */
/* frontmatter（本地实现，不 import paperStore 的私有解析器）              */
/* ------------------------------------------------------------------ */

/** 全局卡 = run 卡的字段 + 首次抓取时间 + 反向索引（被哪些题用过）。 */
export type LibraryCard = PaperCard & {
  /** 首次同步进 library 的时间（ISO）。arXiv 元数据不可变，此值只用于审计，不做过期判定。 */
  fetchedAt: string;
  /** 反向索引：哪些 Science-125 题号的 run 引用过它。代码派生，agent 不填。 */
  questionIds: number[];
};

const LIBRARY_KEYS = [
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
  "fetchedAt",
  "questionIds",
] as const;

function splitFrontmatter(content: string): { head: Record<string, unknown>; body: string } {
  if (!content.startsWith("---")) return { head: {}, body: content };
  const end = content.indexOf("\n---", 3);
  if (end === -1) return { head: {}, body: content };
  const raw = content.slice(content.indexOf("\n") + 1, end);
  const head: Record<string, unknown> = {};
  for (const line of raw.split("\n")) {
    const sep = line.indexOf(":");
    if (sep <= 0) continue;
    try {
      head[line.slice(0, sep).trim()] = JSON.parse(line.slice(sep + 1).trim());
    } catch {
      /* 损坏行忽略，由调用方兜默认值 */
    }
  }
  const after = content.indexOf("\n", end + 1);
  return { head, body: after === -1 ? "" : content.slice(after + 1) };
}

function renderLibraryCard(card: LibraryCard, body: string): string {
  const lines = LIBRARY_KEYS.map((k) => `${k}: ${JSON.stringify(card[k])}`);
  return `${["---", ...lines, "---"].join("\n")}\n\n${body.replace(/^\n+/, "")}`;
}

function readLibraryCardFile(file: string): LibraryCard | null {
  if (!existsSync(file)) return null;
  let head: Record<string, unknown>;
  try {
    head = splitFrontmatter(readFileSync(file, "utf8")).head;
  } catch {
    return null;
  }
  const arxivId = typeof head.arxivId === "string" ? head.arxivId : "";
  if (!arxivId) return null;
  const strArr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  return {
    arxivId,
    year: typeof head.year === "number" ? head.year : 0,
    title: typeof head.title === "string" ? head.title : "",
    authors: strArr(head.authors),
    published: typeof head.published === "string" ? head.published : "",
    updated: typeof head.updated === "string" ? head.updated : "",
    primaryCategory: typeof head.primaryCategory === "string" ? head.primaryCategory : "",
    categories: strArr(head.categories),
    url: typeof head.url === "string" ? head.url : `https://arxiv.org/abs/${arxivId}`,
    oneline: typeof head.oneline === "string" ? head.oneline : "",
    fetchedAt: typeof head.fetchedAt === "string" ? head.fetchedAt : "",
    questionIds: Array.isArray(head.questionIds)
      ? head.questionIds.filter((n): n is number => typeof n === "number")
      : [],
  };
}

/* ------------------------------------------------------------------ */
/* 题号                                                                 */
/* ------------------------------------------------------------------ */

/** Science-125 题号；不合法或未设返回 null（直接手跑的 run 没有题号）。 */
export function resolveQuestionId(raw = process.env.LUUP_QUESTION_ID): number | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const n = Number.parseInt(s, 10);
  return Number.isInteger(n) && n >= 1 && n <= 125 ? n : null;
}

/* ------------------------------------------------------------------ */
/* 落盘 + 写后读回（hermes 血教训：「声称写了」≠「写了」）                   */
/* ------------------------------------------------------------------ */

export type WriteOutcome = {
  path: string;
  bytes: number;
  created: boolean;
  /** 写后读回验证的结果。false ⇒ 这条必须进 failed[]，不许被自然语言总结盖过去。 */
  verified: boolean;
  error?: string;
};

function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

/** 覆盖写 + 读回。派生文件（两个 index）用它。 */
function writeVerified(file: string, content: string): WriteOutcome {
  const created = !existsSync(file);
  try {
    ensureDir(dirname(file));
    writeFileSync(file, content, "utf8");
    const back = readFileSync(file, "utf8");
    return {
      path: display(file),
      bytes: Buffer.byteLength(back, "utf8"),
      created,
      verified: back === content,
      ...(back === content ? {} : { error: "写后读回内容不一致" }),
    };
  } catch (e) {
    return { path: display(file), bytes: 0, created: false, verified: false, error: String(e) };
  }
}

/** 追加写 + 读回（确认追加的块确实在文件里）。append-only 页面用它。 */
function appendVerified(file: string, block: string, header?: string): WriteOutcome {
  const created = !existsSync(file);
  try {
    ensureDir(dirname(file));
    if (created && header) writeFileSync(file, header, "utf8");
    const before = existsSync(file) ? readFileSync(file, "utf8") : "";
    const sep = before.length === 0 || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
    appendFileSync(file, `${sep}${block}`, "utf8");
    const back = readFileSync(file, "utf8");
    return {
      path: display(file),
      bytes: Buffer.byteLength(back, "utf8"),
      created,
      verified: back.includes(block) && back.length > before.length,
      ...(back.includes(block) ? {} : { error: "写后读回未找到刚追加的内容" }),
    };
  } catch (e) {
    return { path: display(file), bytes: 0, created: false, verified: false, error: String(e) };
  }
}

/* ------------------------------------------------------------------ */
/* library：run 卡 → 全局卡 + 索引重建（确定性代码，agent 不可直写）        */
/* ------------------------------------------------------------------ */

export type LibraryUpsertResult = {
  skipped: boolean;
  /** skipped=true 时为 null */
  card: WriteOutcome | null;
  index: WriteOutcome | null;
  questionIds: number[];
  reason?: string;
};

/**
 * 把一张 run 文献卡同步进全局 library，并重建 `library/index.md`。
 * 由 `paperStore.savePaper` 在落 run 卡之后调用 —— **代码层，不经模型**。
 *
 * 幂等：同一 id 重复 upsert 只刷新正文与反向索引，`fetchedAt` 保留首次值。
 */
export function upsertLibraryPaper(input: {
  card: PaperCard;
  /** run 卡的完整 Markdown（含 frontmatter）；正文原样搬运，frontmatter 换成 library 版。 */
  markdown: string;
  /** 缺省从 LUUP_QUESTION_ID 取。 */
  questionId?: number | null;
  memoryDir?: string;
}): LibraryUpsertResult {
  const dir = input.memoryDir ?? resolveMemoryDir();
  if (!memoryEnabled(dir)) {
    return { skipped: true, card: null, index: null, questionIds: [], reason: "memory/ 不存在" };
  }
  const qid = input.questionId === undefined ? resolveQuestionId() : input.questionId;
  const file = join(libraryPapersDir(dir), libraryCardFilename(input.card.arxivId));
  const prev = readLibraryCardFile(file);
  const questionIds = [...new Set([...(prev?.questionIds ?? []), ...(qid === null ? [] : [qid])])].sort(
    (a, b) => a - b,
  );
  const merged: LibraryCard = {
    ...input.card,
    fetchedAt: prev?.fetchedAt || new Date().toISOString(),
    questionIds,
  };
  const body = splitFrontmatter(input.markdown).body;
  const card = writeVerified(file, renderLibraryCard(merged, body));
  const index = rebuildLibraryIndex(dir);
  rebuildMemoryIndex(dir);
  return { skipped: false, card, index, questionIds };
}

/** 读全部全局卡（升序）。 */
export function listLibraryCards(memoryDir = resolveMemoryDir()): LibraryCard[] {
  const dir = libraryPapersDir(memoryDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md") && f !== "README.md")
    .map((f) => readLibraryCardFile(join(dir, f)))
    .filter((c): c is LibraryCard => c !== null)
    .sort((a, b) => a.arxivId.localeCompare(b.arxivId));
}

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();

/** 从 `library/papers/` 整份重建 `library/index.md`，按 arXiv 主学科分组。幂等。 */
export function rebuildLibraryIndex(memoryDir = resolveMemoryDir()): WriteOutcome | null {
  if (!memoryEnabled(memoryDir)) return null;
  const cards = listLibraryCards(memoryDir);
  const groups = new Map<string, LibraryCard[]>();
  for (const c of cards) {
    const key = c.primaryCategory || "(uncategorized)";
    const list = groups.get(key);
    if (list) list.push(c);
    else groups.set(key, [c]);
  }
  const lines = [
    "# 全局文献索引",
    "",
    "由 `agent/lib/campaignMemory.ts` 从 `library/papers/` 自动重建，请勿手改。",
    `共 ${cards.length} 篇 · ${groups.size} 个学科 · 更新于 ${new Date().toISOString()}`,
    "",
    "> 本索引只是**线索**。引用必须经 `arxiv_save` 在本次 run 实检落盘才算数（criteria B1）。",
    "",
  ];
  for (const key of [...groups.keys()].sort((a, b) => a.localeCompare(b))) {
    lines.push(
      `## ${key}`,
      "",
      "| arXiv id | 年份 | 标题 | 一句话摘要 | 用于题号 |",
      "| --- | --- | --- | --- | --- |",
      ...(groups.get(key) ?? []).map(
        (c) =>
          `| ${cell(c.arxivId)} | ${c.year || "?"} | ${cell(c.title)} | ${cell(c.oneline)} | ${
            c.questionIds.length > 0 ? c.questionIds.map((n) => `q${n}`).join(" ") : "-"
          } |`,
      ),
      "",
    );
  }
  if (cards.length === 0) lines.push("（尚无文献。第一次 `arxiv_save` 落 run 卡时会同步 upsert 到这里。）", "");
  return writeVerified(libraryIndexPath(memoryDir), lines.join("\n"));
}

/** 解析 library/index.md 的数据行 —— 供自测断言，不给模型。 */
export function parseLibraryIndexRows(markdown: string): Array<{
  arxivId: string;
  year: string;
  title: string;
  oneline: string;
  questions: string;
}> {
  const rows: Array<{ arxivId: string; year: string; title: string; oneline: string; questions: string }> = [];
  for (const line of markdown.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("|") || !t.endsWith("|")) continue;
    const cells = t
      .slice(1, -1)
      .split(/(?<!\\)\|/)
      .map((c) => c.trim().replace(/\\\|/g, "|"));
    if (cells.length !== 5) continue;
    if (cells[0] === "arXiv id" || /^-{2,}$/.test(cells[0] ?? "")) continue;
    rows.push({
      arxivId: cells[0] ?? "",
      year: cells[1] ?? "",
      title: cells[2] ?? "",
      oneline: cells[3] ?? "",
      questions: cells[4] ?? "",
    });
  }
  return rows;
}

/* ------------------------------------------------------------------ */
/* log.md：时序层（固定前缀，grep 可解析）                                 */
/* ------------------------------------------------------------------ */

export type LogAction = "run" | "note" | "library-sync";

const LOG_HEADER = [
  "<!--",
  "时序日志（append-only）。首行格式固定：`## [YYYY-MM-DD] <action> | q<id> | <verdict>`。",
  "由代码追加（scripts/run.ts 收尾 + memory_note），请勿手改。",
  "-->",
  "",
].join("\n");

const isoDate = (d = new Date()) => d.toISOString().slice(0, 10);

/** 单行明细：压成一行，避免破坏 `## [` 前缀的可 grep 性。 */
const flat = (s: string, max = 300) => {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
};

/**
 * 追加一条日志。前缀固定为 `## [date] <action> | q<id> | <verdict>`，
 * 明细走其下的 `- ` 行 —— `grep "^## \[" memory/log.md | tail -20` 因此永远可用。
 */
export function appendLog(input: {
  action: LogAction;
  questionId?: number | null;
  verdict?: string;
  detail?: string;
  memoryDir?: string;
}): WriteOutcome | { skipped: true; reason: string } {
  const dir = input.memoryDir ?? resolveMemoryDir();
  if (!memoryEnabled(dir)) return { skipped: true, reason: "memory/ 不存在" };
  const q = input.questionId === undefined || input.questionId === null ? "-" : String(input.questionId);
  const head = `## [${isoDate()}] ${input.action} | q${q} | ${(input.verdict || "-").trim()}`;
  const block = `${head}\n${input.detail ? `- ${flat(input.detail)}\n` : ""}`;
  return appendVerified(logPath(dir), block, LOG_HEADER);
}

/** 读最近 n 条日志首行（master 开跑时的低成本定向）。 */
export function tailLog(n = 20, memoryDir = resolveMemoryDir()): string[] {
  const file = logPath(memoryDir);
  if (!memoryEnabled(memoryDir) || !existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.startsWith("## ["))
    .slice(-n);
}

/* ------------------------------------------------------------------ */
/* questions/ 与 lessons.md：append-only + 写后读回                       */
/* ------------------------------------------------------------------ */

const questionHeader = (questionId: number) =>
  [
    `# q${questionId}`,
    "",
    `Science-125 第 ${questionId} 题的跨 run 战役页。**append-only**：新记录追加在文末，`,
    "旧记录不改写、不删除（覆盖会让已经走死的路重新变得可走）。",
    "由 `memory_note`（agent 主动）与 `scripts/run.ts` 收尾（代码兜底）两条独立路径写入。",
    "",
    "记录内容：状态与 verdict、成功 run 的目录指针、跨 run 被拒假设与理由、有效检索词、领域文献覆盖评估。",
    "",
  ].join("\n");

const LESSONS_HEADER = ["# 运营级教训", "", "append-only：新条目追加在文末，旧条目不改写、不删除。", ""].join("\n");

function noteBlock(note: string, source: string): string {
  return `## [${new Date().toISOString()}] ${source}\n\n${note.trim()}\n`;
}

/** 追加一条题页记录。memory/ 不存在时静默 no-op。 */
export function appendQuestionNote(input: {
  questionId: number;
  note: string;
  /** 写入来源标记，便于日后分辨 agent 主动写与代码兜底写。 */
  source?: string;
  memoryDir?: string;
}): WriteOutcome | { skipped: true; reason: string } {
  const dir = input.memoryDir ?? resolveMemoryDir();
  if (!memoryEnabled(dir)) return { skipped: true, reason: "memory/ 不存在" };
  if (!Number.isInteger(input.questionId)) return { skipped: true, reason: "questionId 非法" };
  if (!input.note.trim()) return { skipped: true, reason: "note 为空" };
  return appendVerified(
    questionPath(input.questionId, dir),
    noteBlock(input.note, input.source ?? "note"),
    questionHeader(input.questionId),
  );
}

/** 追加一条运营教训。memory/ 不存在时静默 no-op。 */
export function appendLesson(input: {
  note: string;
  source?: string;
  memoryDir?: string;
}): WriteOutcome | { skipped: true; reason: string } {
  const dir = input.memoryDir ?? resolveMemoryDir();
  if (!memoryEnabled(dir)) return { skipped: true, reason: "memory/ 不存在" };
  if (!input.note.trim()) return { skipped: true, reason: "note 为空" };
  return appendVerified(lessonsPath(dir), noteBlock(input.note, input.source ?? "note"), LESSONS_HEADER);
}

/* ------------------------------------------------------------------ */
/* index.md：内容目录（代码派生）                                          */
/* ------------------------------------------------------------------ */

function countBlocks(file: string): number {
  if (!existsSync(file)) return 0;
  return readFileSync(file, "utf8").split("\n").filter((l) => l.startsWith("## [")).length;
}

/** 重建顶层 index.md（「有什么」）。与 log.md（「发生过什么」）职责严格分开。 */
export function rebuildMemoryIndex(memoryDir = resolveMemoryDir()): WriteOutcome | null {
  if (!memoryEnabled(memoryDir)) return null;
  const cards = listLibraryCards(memoryDir);
  const subjects = new Set(cards.map((c) => c.primaryCategory || "(uncategorized)"));
  const qDir = questionsDir(memoryDir);
  const qFiles = existsSync(qDir)
    ? readdirSync(qDir)
        .filter((f) => /^q\d+\.md$/.test(f))
        .sort((a, b) => Number.parseInt(a.slice(1), 10) - Number.parseInt(b.slice(1), 10))
    : [];
  const rows = [
    `| SCHEMA.md | 契约 | 本目录的行为契约与 non-goals |`,
    `| library/index.md | 文献索引 | ${cards.length} 篇 · ${subjects.size} 个学科 |`,
    ...qFiles.map((f) => `| questions/${f} | 战役页 | ${countBlocks(join(qDir, f))} 条记录 |`),
    `| lessons.md | 教训 | ${countBlocks(lessonsPath(memoryDir))} 条 |`,
    `| log.md | 时序日志 | ${tailLog(Number.MAX_SAFE_INTEGER, memoryDir).length} 条 |`,
  ];
  return writeVerified(
    memoryIndexPath(memoryDir),
    [
      "# campaign memory 索引",
      "",
      "由 `agent/lib/campaignMemory.ts` 自动重建，请勿手改。",
      `更新于 ${new Date().toISOString()}`,
      "",
      "| 页 | 类型 | 一行摘要 |",
      "| --- | --- | --- |",
      ...rows,
      "",
    ].join("\n"),
  );
}

/* ------------------------------------------------------------------ */
/* 检索：grep 式，零 embedding（SCHEMA.md non-goals）                     */
/* ------------------------------------------------------------------ */

export type MemoryHit = {
  /** `memory/...` 形式的路径，可直接拿去读 L2。 */
  path: string;
  line: number;
  /** 命中的 L0 行原文 */
  text: string;
  /** 命中的 query token 数（确定性计数，不是相似度） */
  score: number;
};

export type MemorySearchResult = {
  enabled: boolean;
  query: string;
  tokens: string[];
  scanned: string[];
  hitCount: number;
  hits: MemoryHit[];
  truncated: boolean;
};

/** 拉丁词 + 连续 CJK 串；单字符拉丁 token 丢弃（噪声太大）。 */
export function tokenize(query: string): string[] {
  const raw = query.toLowerCase().match(/[a-z0-9][a-z0-9+._-]*|[一-鿿]+/g) ?? [];
  return [...new Set(raw.filter((t) => (/^[a-z0-9]/.test(t) ? t.length >= 2 : true)))];
}

function searchTargets(memoryDir: string): string[] {
  const out: string[] = [];
  const libIndex = libraryIndexPath(memoryDir);
  if (existsSync(libIndex)) out.push(libIndex);
  const qDir = questionsDir(memoryDir);
  if (existsSync(qDir)) {
    for (const f of readdirSync(qDir).filter((f) => f.endsWith(".md") && f !== "README.md").sort()) {
      out.push(join(qDir, f));
    }
  }
  const lessons = lessonsPath(memoryDir);
  if (existsSync(lessons)) out.push(lessons);
  return out;
}

/**
 * 对 `library/index.md` + `questions/**` + `lessons.md` 做逐行确定性匹配，
 * 返回命中的 L0 行与路径。**没有向量、没有 embedding、没有重排模型**（无 RAG 红线）。
 * agent 拿到路径后再按需读 L2，避免把整个知识库灌进上下文。
 */
export function searchMemory(input: {
  query: string;
  limit?: number;
  memoryDir?: string;
}): MemorySearchResult {
  const dir = input.memoryDir ?? resolveMemoryDir();
  const tokens = tokenize(input.query ?? "");
  const limit = Math.max(1, Math.min(input.limit ?? 20, 100));
  const base: MemorySearchResult = {
    enabled: memoryEnabled(dir),
    query: input.query ?? "",
    tokens,
    scanned: [],
    hitCount: 0,
    hits: [],
    truncated: false,
  };
  if (!base.enabled || tokens.length === 0) return base;

  const targets = searchTargets(dir);
  base.scanned = targets.map((t) => display(t, dir));
  const all: MemoryHit[] = [];
  for (const file of targets) {
    let lines: string[];
    try {
      lines = readFileSync(file, "utf8").split("\n");
    } catch {
      continue;
    }
    for (let i = 0; i < lines.length; i++) {
      const text = (lines[i] ?? "").trim();
      if (!text || /^\|?\s*-{2,}/.test(text) || text.startsWith("<!--")) continue;
      const lower = text.toLowerCase();
      let score = 0;
      for (const t of tokens) if (lower.includes(t)) score++;
      if (score > 0) all.push({ path: display(file, dir), line: i + 1, text, score });
    }
  }
  all.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path) || a.line - b.line);
  base.hitCount = all.length;
  base.hits = all.slice(0, limit);
  base.truncated = all.length > limit;
  return base;
}

/* ------------------------------------------------------------------ */
/* run 收尾归档（代码兜底路径；agent 忘写不致命）                           */
/* ------------------------------------------------------------------ */

export type ArchiveResult = {
  skipped: boolean;
  written: WriteOutcome[];
  failed: Array<{ path: string; reason: string }>;
  reason?: string;
};

function collect(
  outcome: WriteOutcome | { skipped: true; reason: string },
  written: WriteOutcome[],
  failed: Array<{ path: string; reason: string }>,
  label: string,
): void {
  if ("skipped" in outcome) {
    failed.push({ path: label, reason: outcome.reason });
    return;
  }
  if (outcome.verified) written.push(outcome);
  else failed.push({ path: outcome.path, reason: outcome.error ?? "写后读回失败" });
}

/**
 * run 结束时把 verdict/FAILED 摘要归档：题页一条 + 日志一条。
 * `scripts/run.ts` 调用，**不依赖模型**——这是 memory.md「写入两条独立路径」的代码那条。
 * memory/ 不存在、questionId 缺失、磁盘出错都只降级不抛：收尾绝不能炸掉一次真实 run。
 */
export function archiveRunOutcome(input: {
  questionId: number | null;
  verdict: string;
  summary: string;
  runDir?: string;
  memoryDir?: string;
}): ArchiveResult {
  const dir = input.memoryDir ?? resolveMemoryDir();
  if (!memoryEnabled(dir)) return { skipped: true, written: [], failed: [], reason: "memory/ 不存在" };
  const written: WriteOutcome[] = [];
  const failed: Array<{ path: string; reason: string }> = [];
  const note = [
    `- verdict: ${input.verdict}`,
    ...(input.runDir ? [`- run: ${input.runDir}`] : []),
    "",
    input.summary.trim() || "(无摘要)",
  ].join("\n");

  if (input.questionId !== null) {
    collect(
      appendQuestionNote({ questionId: input.questionId, note, source: "run.ts", memoryDir: dir }),
      written,
      failed,
      `memory/questions/q${input.questionId}.md`,
    );
  }
  collect(
    appendLog({
      action: "run",
      questionId: input.questionId,
      verdict: input.verdict,
      detail: `${input.runDir ?? ""} ${input.summary}`.trim(),
      memoryDir: dir,
    }),
    written,
    failed,
    "memory/log.md",
  );
  rebuildMemoryIndex(dir);
  return { skipped: false, written, failed };
}

/** memory_note 工具的落盘实现：题页/教训 + 一条日志，全部写后读回。 */
export function writeNote(input: {
  target: "question" | "lessons";
  questionId?: number | null;
  note: string;
  source?: string;
  memoryDir?: string;
}): ArchiveResult {
  const dir = input.memoryDir ?? resolveMemoryDir();
  if (!memoryEnabled(dir)) return { skipped: true, written: [], failed: [], reason: "memory/ 不存在" };
  const written: WriteOutcome[] = [];
  const failed: Array<{ path: string; reason: string }> = [];

  if (input.target === "question") {
    const qid = input.questionId ?? null;
    if (qid === null || !Number.isInteger(qid)) {
      failed.push({ path: "memory/questions/q<id>.md", reason: "target=question 必须给 questionId（1–125）" });
    } else {
      collect(
        appendQuestionNote({ questionId: qid, note: input.note, source: input.source ?? "memory_note", memoryDir: dir }),
        written,
        failed,
        `memory/questions/q${qid}.md`,
      );
    }
  } else {
    collect(
      appendLesson({ note: input.note, source: input.source ?? "memory_note", memoryDir: dir }),
      written,
      failed,
      "memory/lessons.md",
    );
  }

  collect(
    appendLog({
      action: "note",
      questionId: input.target === "question" ? (input.questionId ?? null) : null,
      verdict: "-",
      detail: input.note,
      memoryDir: dir,
    }),
    written,
    failed,
    "memory/log.md",
  );
  rebuildMemoryIndex(dir);
  return { skipped: false, written, failed };
}
