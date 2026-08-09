/**
 * campaign-scoped 长期记忆（docs/design/memory.md 第二层，服务 125 题战役）。
 *
 *   memory/
 *     SCHEMA.md          行为契约（给 agent 读；含 non-goals）
 *     index.md           内容目录（代码派生）
 *     log.md             时序日志（append-only，`## [date] <action> | q<id> | <verdict>`）
 *     log.<YYYY-MM>.md   log.md 超阈值后滚出的分片（整条搬移，逐字未改）
 *     library/papers/    全局文献卡 L2（代码派生自 run 卡）
 *     library/index.md   全局文献索引 L0/L1，按 arXiv 学科分组（代码派生）
 *     questions/q<id>.md 每题战役页（append-only）
 *     questions/q<id>.archive.md  题页超预算后降层的旧条目（整条搬移，逐字未改）
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
 *     upsert 自愈）。compaction（约束 5）把这条假设的代价抬高了一档：它是「读整份 →
 *     写分片 → 重写主文件」，另一个进程在这中间追加的条目会被主文件的重写覆盖掉
 *     （分片先落盘，所以丢的是**新条目**，不是已归档的旧条目 —— 永不丢历史）。
 *     要上多进程并跑，先在这里加锁再说。
 *  5. **compaction 只搬不改**（memory.md「compaction」节）：log 分片与题页归档 100% 由
 *     代码按阈值判定，条目**整条搬移**、逐字节不改写，不摘要、不裁剪、不经模型。
 *     run 目录指针与被拒假设的原始陈述是不可压缩字段 —— 它们随条目原样进归档文件。
 *
 * 与 paperStore 的关系：`savePaper` 调用本模块的 `upsertLibraryPaper`，本模块反过来
 * 用 paperStore 的 `paperFilename` —— id↔文件名映射只能有一份实现，两层卡片才可能
 * 一一对应。ESM 循环在这里是安全的：双方在**模块求值期**都不互相调用，
 * 用到的都是被提升的函数声明，调用发生在运行期。
 *
 * 对外只暴露 8 个动词（memoryEnabled / upsertLibraryPaper / listLibraryCards /
 * searchMemory / archiveRunOutcome / writeNote / compactLog / compactQuestionPage）
 * 加一个显式布局面 `describeLayout()`。路径拼接、索引重建、append 三件套全部是私有的：
 * 它们是这些动词的实现，不是接口。两个 compact 动词写入路径里会自动跑，导出只为
 * 「手工整理 + 自测」两个场景。
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
import { escapeCell } from "../../lib/mdTable.ts";
import { REPO_ROOT } from "../../lib/paths.ts";
import { type PaperCard, paperFilename } from "./paperStore.ts";

/* ------------------------------------------------------------------ */
/* 路径解析                                                             */
/* ------------------------------------------------------------------ */

/** 测试用：把 campaign memory 指到临时目录（生产不设，走仓库根 memory/）。 */
export const MEMORY_DIR_ENV = "LUUP_MEMORY_DIR";

function resolveMemoryDir(): string {
  const fromEnv = process.env[MEMORY_DIR_ENV]?.trim();
  return fromEnv ? resolve(process.cwd(), fromEnv) : join(REPO_ROOT, "memory");
}

/**
 * 唯一的开关：目录在 = 启用，目录不在 = 全模块 no-op。
 * 故意只看根目录 —— 子目录缺失由各写入路径按需补建，但**根目录绝不自动创建**，
 * 否则「删掉 memory/」这个动作就没有意义了。
 */
export function memoryEnabled(memoryDir = resolveMemoryDir()): boolean {
  return existsSync(memoryDir);
}

const libraryDir = (dir: string) => join(dir, "library");
const libraryPapersDir = (dir: string) => join(libraryDir(dir), "papers");
const libraryIndexPath = (dir: string) => join(libraryDir(dir), "index.md");
const questionsDir = (dir: string) => join(dir, "questions");
const questionPath = (questionId: number, dir: string) => join(questionsDir(dir), `q${questionId}.md`);
/** 题页归档（降层，不删除）。仍以 `.md` 结尾 ⇒ `memory_search` 照常扫得到。 */
const questionArchivePath = (questionId: number, dir: string) =>
  join(questionsDir(dir), `q${questionId}.archive.md`);
const lessonsPath = (dir: string) => join(dir, "lessons.md");
const logPath = (dir: string) => join(dir, "log.md");
/** 时序日志分片，`yearMonth` 形如 `2026-08`。 */
const logShardPath = (yearMonth: string, dir: string) => join(dir, `log.${yearMonth}.md`);
const LOG_SHARD_RE = /^log\.(\d{4}-\d{2})\.md$/;
const memoryIndexPath = (dir: string) => join(dir, "index.md");

/**
 * 布局的**显式**对外面。
 *
 * 上一版把十个路径函数逐个 export 出去，唯一的消费者是自测里的断言 —— 于是「模块的
 * 公开接口」与「测试想看的内部结构」混成了一摊，谁都不敢删。这里把它收成一个函数：
 * 生产代码不需要它，自测拿它做布局断言，而模块自己仍然只在内部用私有拼接式。
 */
export type MemoryLayout = {
  root: string;
  index: string;
  log: string;
  lessons: string;
  libraryIndex: string;
  libraryPapers: string;
  questions: string;
  questionPage: (questionId: number) => string;
  /** 题页归档：超预算后被降层的旧条目（compaction 的落点，不是新写入面）。 */
  questionArchive: (questionId: number) => string;
  /** 日志分片：`yearMonth` 形如 `2026-08`。 */
  logShard: (yearMonth: string) => string;
  /** 全局卡文件名 = run 卡文件名（同一份映射，保证两层卡片一一对应）。 */
  cardFilename: (arxivId: string) => string;
};

export function describeLayout(memoryDir = resolveMemoryDir()): MemoryLayout {
  return {
    root: memoryDir,
    index: memoryIndexPath(memoryDir),
    log: logPath(memoryDir),
    lessons: lessonsPath(memoryDir),
    libraryIndex: libraryIndexPath(memoryDir),
    libraryPapers: libraryPapersDir(memoryDir),
    questions: questionsDir(memoryDir),
    questionPage: (questionId: number) => questionPath(questionId, memoryDir),
    questionArchive: (questionId: number) => questionArchivePath(questionId, memoryDir),
    logShard: (yearMonth: string) => logShardPath(yearMonth, memoryDir),
    cardFilename: paperFilename,
  };
}

/** 对外报路径一律用 `memory/...` 形式：稳定、可 grep，且不泄露临时目录。 */
function display(abs: string, dir = resolveMemoryDir()): string {
  const base = resolve(dir);
  const a = resolve(abs);
  return a === base ? "memory" : `memory/${a.slice(base.length + 1).split(/[\\/]/).join("/")}`;
}

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
function resolveQuestionId(raw = process.env.LUUP_QUESTION_ID): number | null {
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
  const file = join(libraryPapersDir(dir), paperFilename(input.card.arxivId));
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

/** 从 `library/papers/` 整份重建 `library/index.md`，按 arXiv 主学科分组。幂等。 */
function rebuildLibraryIndex(memoryDir = resolveMemoryDir()): WriteOutcome | null {
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
          `| ${escapeCell(c.arxivId)} | ${c.year || "?"} | ${escapeCell(c.title)} | ${escapeCell(c.oneline)} | ${
            c.questionIds.length > 0 ? c.questionIds.map((n) => `q${n}`).join(" ") : "-"
          } |`,
      ),
      "",
    );
  }
  if (cards.length === 0) lines.push("（尚无文献。第一次 `arxiv_save` 落 run 卡时会同步 upsert 到这里。）", "");
  return writeVerified(libraryIndexPath(memoryDir), lines.join("\n"));
}

/* ------------------------------------------------------------------ */
/* log.md：时序层（固定前缀，grep 可解析）                                 */
/* ------------------------------------------------------------------ */

type LogAction = "run" | "note" | "library-sync";

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
 *
 * 写完顺手查一次阈值：分片是**存储层**的事，调用者不该知道、也没有第二个地方能可靠地
 * 想起来做（memory.md：触发 100% 代码）。分片失败不影响本次追加的返回值 —— 条目已经
 * 在盘上了，只是文件还没瘦下来。
 */
function appendLog(input: {
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
  const outcome = appendVerified(logPath(dir), block, LOG_HEADER);
  compactLog({ memoryDir: dir });
  return outcome;
}

/** 读最近 n 条日志首行（master 开跑时的低成本定向）。 */
function tailLog(n = 20, memoryDir = resolveMemoryDir()): string[] {
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

/**
 * 追加一条题页记录。memory/ 不存在时静默 no-op。
 * 与 `appendLog` 同款：写完顺手查字数预算，超了就地归档（见 `compactQuestionPage`）。
 * append-only 语义不变 —— 归档是搬移，不是删除，条目一条不少、一字不改。
 */
function appendQuestionNote(input: {
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
  const outcome = appendVerified(
    questionPath(input.questionId, dir),
    noteBlock(input.note, input.source ?? "note"),
    questionHeader(input.questionId),
  );
  compactQuestionPage({ questionId: input.questionId, memoryDir: dir });
  return outcome;
}

/** 追加一条运营教训。memory/ 不存在时静默 no-op。 */
function appendLesson(input: {
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
/* compaction：log 分片 + 题页归档（memory.md「compaction」节）             */
/* ------------------------------------------------------------------ */

/**
 * 阈值全部**代码判定**，不问模型；导出是为了让调用方（自测、将来的运维脚本）能按字段覆盖。
 *
 * 为什么是「搬移」而不是「摘要」：questions/ 有 125 的硬上界、文件名稳定，本来就不膨胀；
 * 无界的只有 log 行数与单题页字数。搬移是确定性的、可逆的、逐字节可校验的；摘要要引入
 * 模型、引入不确定性、引入「摘丢了什么」的新问题。MVP 取搬移。
 *
 * **将来钩子（现在不做）**：题页归档时可以让 LLM 对被搬走的条目产一段**增量摘要片段**，
 * 追加到主页面（旧正文一字节不动，摘要只是新增的一段）。落点就是 `compactQuestionPage`
 * 里搬移完成、重写主页面之前那一步。上这个钩子之前先确认三件事：①摘要片段与被搬条目
 * 一一可追溯；②不可压缩字段（run 指针、被拒假设原文）不进摘要、只留指针；③摘要失败
 * 时归档仍照常完成（模型永远不在关键路径上）。
 */
export type CompactionThresholds = {
  /** log.md 超过这么多行就滚分片。 */
  logMaxLines: number;
  /** 滚完之后主 log 保留的「最近段」行数预算（按条目对齐，绝不腰斩一条）。 */
  logKeepLines: number;
  /** 题页超过这么多字节就归档。 */
  questionMaxBytes: number;
  /** 归档后主页面保留的最近条目数（≥1 ⇒ 刚写完的那条永远还在主页面上）。 */
  questionKeepEntries: number;
};

export const COMPACTION_DEFAULTS: CompactionThresholds = {
  logMaxLines: 500,
  logKeepLines: 200,
  questionMaxBytes: 16 * 1024,
  questionKeepEntries: 3,
};

/** 条目首行前缀：log 与题页共用（`countBlocks` / `tailLog` 也认这个）。 */
const ENTRY_HEAD = "## [";

export type CompactionResult = {
  /** memory/ 不在、文件不在、或没到阈值 —— 都不算错。 */
  skipped: boolean;
  /** 真的搬了东西才为 true。 */
  compacted: boolean;
  /** 搬走的条目数。 */
  moved: number;
  /** 落点文件（`memory/...` 形式）。 */
  targets: string[];
  written: WriteOutcome[];
  failed: Array<{ path: string; reason: string }>;
  reason?: string;
};

const noCompaction = (reason: string, skipped = true): CompactionResult => ({
  skipped,
  compacted: false,
  moved: 0,
  targets: [],
  written: [],
  failed: [],
  reason,
});

/**
 * 按 `## [` 首行把文本切成「前言 + 条目」。
 *
 * **逐字节可逆**：`[preamble, ...blocks].join("\n")` 恒等于原文 —— 切分只是把
 * `text.split("\n")` 的结果按顺序分组再用同一个分隔符接回去。归档「一字不改」这条
 * 纪律因此是由构造保证的，不靠事后比对。
 */
function splitEntries(text: string): { preamble: string; blocks: string[] } {
  const preamble: string[] = [];
  const blocks: string[][] = [];
  for (const line of text.split("\n")) {
    if (line.startsWith(ENTRY_HEAD)) blocks.push([line]);
    else if (blocks.length === 0) preamble.push(line);
    else blocks[blocks.length - 1]?.push(line);
  }
  return { preamble: preamble.join("\n"), blocks: blocks.map((b) => b.join("\n")) };
}

const logShardHeader = (yearMonth: string) =>
  [
    "<!--",
    `时序日志分片 ${yearMonth}（由 campaignMemory.compactLog 从 log.md 滚出）。`,
    "条目整条搬移、逐字未改 —— 这是审计线的一段，请勿手改、请勿删除。",
    "-->",
    "",
  ].join("\n");

const questionArchiveHeader = (questionId: number) =>
  [
    `# q${questionId} · 归档`,
    "",
    `\`q${questionId}.md\` 超出字数预算时，较早的条目被**整条搬移**到这里：降层，不删除、不改写、不摘要。`,
    "run 目录指针与被拒假设的原始陈述在此完整保留 —— 它们是不可压缩字段。",
    "`memory_search` 照常扫描本文件，检索面不因归档变窄。",
    "",
  ].join("\n");

/**
 * log.md **只分片，永不压缩**：超行数阈值 → 较早条目按其自身日期滚进
 * `log.<YYYY-MM>.md`，主 log 留最近段。时序审计线一字不改。
 *
 * 落盘顺序是有意的：**先写分片、验证通过，再重写主 log**。分片写失败就原地放弃，
 * 主 log 一个字节都不动 —— 宁可文件继续变长，也不能在搬运途中把审计线搞丢。
 */
export function compactLog(input?: {
  memoryDir?: string;
  thresholds?: Partial<CompactionThresholds>;
}): CompactionResult {
  const dir = input?.memoryDir ?? resolveMemoryDir();
  if (!memoryEnabled(dir)) return noCompaction("memory/ 不存在");
  const t = { ...COMPACTION_DEFAULTS, ...input?.thresholds };
  const file = logPath(dir);
  if (!existsSync(file)) return noCompaction("log.md 不存在");

  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (e) {
    return { ...noCompaction(String(e), false), failed: [{ path: display(file, dir), reason: String(e) }] };
  }
  if (text.split("\n").length <= t.logMaxLines) return { ...noCompaction("未到阈值"), skipped: false };

  const { preamble, blocks } = splitEntries(text);
  // 从最新往回收，收满「最近段」预算为止；至少留 1 条，且绝不腰斩条目。
  let keep = 0;
  let lines = 0;
  for (let i = blocks.length - 1; i >= 0; i--) {
    const n = (blocks[i] ?? "").split("\n").length;
    if (keep > 0 && lines + n > t.logKeepLines) break;
    lines += n;
    keep++;
  }
  const moved = blocks.slice(0, Math.max(0, blocks.length - keep));
  if (moved.length === 0) return { ...noCompaction("条目数不足以分片"), skipped: false };

  // 按条目自身日期的年月分组；解析不出来（手改过）就跟随上一条，保持分片连续。
  const groups: Array<{ month: string; blocks: string[] }> = [];
  let month = isoDate().slice(0, 7);
  for (const b of moved) {
    const m = /^## \[(\d{4}-\d{2})-\d{2}\]/.exec(b);
    if (m?.[1]) month = m[1];
    const last = groups[groups.length - 1];
    if (last && last.month === month) last.blocks.push(b);
    else groups.push({ month, blocks: [b] });
  }

  const written: WriteOutcome[] = [];
  const failed: Array<{ path: string; reason: string }> = [];
  const targets: string[] = [];
  for (const g of groups) {
    const shard = logShardPath(g.month, dir);
    const out = appendVerified(shard, g.blocks.join("\n"), logShardHeader(g.month));
    targets.push(display(shard, dir));
    if (out.verified) written.push(out);
    else failed.push({ path: out.path, reason: out.error ?? "写后读回失败" });
  }
  if (failed.length > 0) {
    // 分片没落稳 —— 主 log 保持原样，下次再试。
    return { skipped: false, compacted: false, moved: 0, targets, written, failed, reason: "分片写入失败，主 log 未改动" };
  }

  const main = writeVerified(file, [preamble, ...blocks.slice(moved.length)].join("\n"));
  if (main.verified) written.push(main);
  else failed.push({ path: main.path, reason: main.error ?? "写后读回失败" });
  // 条目搬家了，index 的「N 条」就不再成立 —— 只在真搬过时重建，日常追加不受影响。
  if (failed.length === 0) rebuildMemoryIndex(dir);
  return { skipped: false, compacted: failed.length === 0, moved: moved.length, targets, written, failed };
}

/** 主页面上那行指针；重写时按前缀识别并替换，永不叠加第二行。 */
const ARCHIVE_POINTER_PREFIX = "> 更早记录见 ";
const archivePointer = (questionId: number) =>
  `${ARCHIVE_POINTER_PREFIX}[q${questionId}.archive.md](./q${questionId}.archive.md)（整条搬移，内容一字未改）。`;

/**
 * 题页**大页追加 + 归档**：超字数预算 → 除最近 N 条外的旧条目整条搬进
 * `q<id>.archive.md`（降层不删除），主页面留最近 N 条 + 一行指针。
 *
 * 保留最近 N 条（N≥1）这条保证了**刚写完的条目永远还在主页面上**，调用方拿到的
 * WriteOutcome 不会指向一个「内容已经被搬走了」的文件。
 * 与 compactLog 同款落盘顺序：先写归档并验证，再重写主页面。
 */
export function compactQuestionPage(input: {
  questionId: number;
  memoryDir?: string;
  thresholds?: Partial<CompactionThresholds>;
}): CompactionResult {
  const dir = input.memoryDir ?? resolveMemoryDir();
  if (!memoryEnabled(dir)) return noCompaction("memory/ 不存在");
  if (!Number.isInteger(input.questionId)) return noCompaction("questionId 非法");
  const t = { ...COMPACTION_DEFAULTS, ...input.thresholds };
  const file = questionPath(input.questionId, dir);
  if (!existsSync(file)) return noCompaction("题页不存在");

  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (e) {
    return { ...noCompaction(String(e), false), failed: [{ path: display(file, dir), reason: String(e) }] };
  }
  if (Buffer.byteLength(text, "utf8") <= t.questionMaxBytes) return { ...noCompaction("未到阈值"), skipped: false };

  const { preamble, blocks } = splitEntries(text);
  const keep = Math.max(1, t.questionKeepEntries);
  if (blocks.length <= keep) return { ...noCompaction("条目数不足以归档"), skipped: false };
  const moved = blocks.slice(0, blocks.length - keep);

  const archive = questionArchivePath(input.questionId, dir);
  const out = appendVerified(archive, moved.join("\n"), questionArchiveHeader(input.questionId));
  const targets = [display(archive, dir)];
  if (!out.verified) {
    return {
      skipped: false,
      compacted: false,
      moved: 0,
      targets,
      written: [],
      failed: [{ path: out.path, reason: out.error ?? "写后读回失败" }],
      reason: "归档写入失败，题页未改动",
    };
  }

  // 前言里可能已经有上一次留下的指针行 —— 按前缀剔掉再补一行，指针永远只有一行。
  const head = preamble.split("\n").filter((l) => !l.startsWith(ARCHIVE_POINTER_PREFIX));
  while (head.length > 0 && (head[head.length - 1] ?? "").trim() === "") head.pop();
  const main = writeVerified(
    file,
    [[...head, "", archivePointer(input.questionId), ""].join("\n"), ...blocks.slice(moved.length)].join("\n"),
  );
  const written = [out];
  const failed: Array<{ path: string; reason: string }> = [];
  if (main.verified) written.push(main);
  else failed.push({ path: main.path, reason: main.error ?? "写后读回失败" });
  if (failed.length === 0) rebuildMemoryIndex(dir);
  return { skipped: false, compacted: failed.length === 0, moved: moved.length, targets, written, failed };
}

/* ------------------------------------------------------------------ */
/* index.md：内容目录（代码派生）                                          */
/* ------------------------------------------------------------------ */

function countBlocks(file: string): number {
  if (!existsSync(file)) return 0;
  return readFileSync(file, "utf8").split("\n").filter((l) => l.startsWith(ENTRY_HEAD)).length;
}

/** 重建顶层 index.md（「有什么」）。与 log.md（「发生过什么」）职责严格分开。 */
function rebuildMemoryIndex(memoryDir = resolveMemoryDir()): WriteOutcome | null {
  if (!memoryEnabled(memoryDir)) return null;
  const cards = listLibraryCards(memoryDir);
  const subjects = new Set(cards.map((c) => c.primaryCategory || "(uncategorized)"));
  const qDir = questionsDir(memoryDir);
  const qFiles = existsSync(qDir)
    ? readdirSync(qDir)
        .filter((f) => /^q\d+\.md$/.test(f))
        .sort((a, b) => Number.parseInt(a.slice(1), 10) - Number.parseInt(b.slice(1), 10))
    : [];
  // compaction 之后「一页」不再等于「一个文件」：主文件旁边可能躺着归档/分片。
  // index 管「有什么」，所以这里如实把降层掉的条目数也报出来，否则读 index 的人会
  // 以为记录变少了。
  const shards = existsSync(memoryDir) ? readdirSync(memoryDir).filter((f) => LOG_SHARD_RE.test(f)).sort() : [];
  const shardedEntries = shards.reduce((n, f) => n + countBlocks(join(memoryDir, f)), 0);
  const rows = [
    `| SCHEMA.md | 契约 | 本目录的行为契约与 non-goals |`,
    `| library/index.md | 文献索引 | ${cards.length} 篇 · ${subjects.size} 个学科 |`,
    ...qFiles.map((f) => {
      const archived = countBlocks(join(qDir, `${f.slice(0, -3)}.archive.md`));
      return `| questions/${f} | 战役页 | ${countBlocks(join(qDir, f))} 条记录${
        archived > 0 ? ` · 另有 ${archived} 条见 ${f.slice(0, -3)}.archive.md` : ""
      } |`;
    }),
    `| lessons.md | 教训 | ${countBlocks(lessonsPath(memoryDir))} 条 |`,
    `| log.md | 时序日志 | ${tailLog(Number.MAX_SAFE_INTEGER, memoryDir).length} 条${
      shards.length > 0 ? ` · 另有 ${shardedEntries} 条见 ${shards.length} 个 log.<YYYY-MM>.md 分片` : ""
    } |`,
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
function tokenize(query: string): string[] {
  const raw = query.toLowerCase().match(/[a-z0-9][a-z0-9+._-]*|[一-鿿]+/g) ?? [];
  return [...new Set(raw.filter((t) => (/^[a-z0-9]/.test(t) ? t.length >= 2 : true)))];
}

function searchTargets(memoryDir: string): string[] {
  const out: string[] = [];
  const libIndex = libraryIndexPath(memoryDir);
  if (existsSync(libIndex)) out.push(libIndex);
  const qDir = questionsDir(memoryDir);
  if (existsSync(qDir)) {
    // 归档页 `q<id>.archive.md` 也在这个筛子里 —— 有意的：归档是降层不是删除，
    // 被搬走的旧条目必须仍然搜得到，否则 compaction 就变成了丢知识。
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
