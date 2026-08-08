/**
 * 文献层自测（真跑 arXiv API，无 LLM、无 mock）。
 *
 *   node scripts/selftest-literature.ts [runDir]
 *
 * 覆盖：
 *  1. arxiv_search 工具 → arXiv 真实返回，id 均匹配 contracts 的 arxivIdPattern
 *  2. arxiv_save 工具 → 只吃 id，元数据自取；落盘 memory/papers/<id>.md
 *  3. index.md 由代码强制同步（每篇一行：id | 年份 | 标题 | 一句话摘要）
 *  4. 文件名 "/" → "__" 映射的**往返性质**：任取一个真实旧式 id，落盘后从磁盘文件名
 *     还原回来必须逐字相等。断言的是性质，不是实现 —— 上一版在这里手抄了一遍
 *     验收器的还原式，于是「两处一致」被证成了「抄写没抄错」。
 *  5. 防虚构：格式非法 id 不发请求；arXiv 查无此文的 id 不落盘
 *
 * 不写入仓库 runs/：默认落 os.tmpdir() 下的临时目录。
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { MEMORY_DIR_ENV } from "#lib/campaignMemory.ts";
import { arxivIdPattern } from "#lib/contracts.ts";
import {
  arxivIdFromFilename,
  listPapers,
  papersDir,
  paperFilename,
  paperPath,
  parseIndexRows,
  readIndex,
} from "#lib/paperStore.ts";
import { RUN_DIR_ENV } from "#lib/runContext.ts";
import arxivSaveTool from "#tools/arxiv_save.ts";
import arxivSearchTool from "#tools/arxiv_search.ts";
import paperIndexReadTool from "#tools/paper_index_read.ts";

/* ---------------------------------------------------------------- */

let passed = 0;
const failures: string[] = [];

function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    passed++;
    console.log(`  PASS ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    failures.push(label);
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/**
 * 直接调 defineTool 的 execute。eve 的 ToolContext 只在真实 runtime 里存在，
 * 这三个工具都不碰 ctx，所以传 undefined 即可；同时把 `Promise|value|AsyncIterable`
 * 的返回联合收窄成普通值。
 */
type ToolLike<I, O> = { execute(input: I, ctx: never): Promise<O> | O | AsyncIterable<O> };

async function callTool<I, O>(tool: ToolLike<I, O>, input: I): Promise<O> {
  const result = tool.execute(input, undefined as never);
  if (result !== null && typeof result === "object" && Symbol.asyncIterator in result) {
    throw new Error("selftest 不支持流式（async generator）工具");
  }
  return await (result as Promise<O> | O);
}

/* ---------------------------------------------------------------- */

const keepDir = process.argv[2];
const runDir = keepDir
  ? resolve(process.cwd(), keepDir)
  : mkdtempSync(join(tmpdir(), "luup-selftest-"));
process.env[RUN_DIR_ENV] = runDir;
/*
 * savePaper 会把每篇卡同步进 campaign library（agent/lib/campaignMemory.ts）。
 * 自测的论文不该混进 125 题战役的长期记忆里 —— 把 campaign 目录改指到临时沙箱，
 * 仓库根的 memory/ 一个字节都不会被改到。
 */
const memoryDir = mkdtempSync(join(tmpdir(), "luup-selftest-memory-"));
process.env[MEMORY_DIR_ENV] = memoryDir;

console.log(`run dir   : ${runDir}`);
console.log(`memory dir: ${memoryDir}（临时沙箱，跑完删除）\n`);

// ---- 1. arxiv_search --------------------------------------------------
console.log("[1] arxiv_search: 真实检索 solar flare prediction");
const search = await callTool(arxivSearchTool, {
  query: "solar flare prediction",
  maxResults: 5,
  sortBy: "relevance" as const,
});
check("检索返回 ≥3 条", search.count >= 3, `count=${search.count}`);
check(
  "所有 id 匹配 arxivIdPattern",
  search.results.every((r) => arxivIdPattern.test(r.arxivId)),
  search.results.map((r) => r.arxivId).join(", "),
);
check(
  "所有条目带非空标题与摘要",
  search.results.every((r) => r.title.length > 0 && r.summary.length > 0),
);
check(
  "摘要截断 ≤401 字（400 + 省略号）",
  search.results.every((r) => r.summary.length <= 401),
  `max=${Math.max(...search.results.map((r) => r.summary.length))}`,
);
for (const r of search.results.slice(0, 5)) {
  console.log(`    ${r.arxivId} (${r.year}) ${r.title.slice(0, 70)}`);
}

// ---- 2. arxiv_save ----------------------------------------------------
const targets = search.results.slice(0, 3).map((r) => r.arxivId);
console.log(`\n[2] arxiv_save: 保存 ${targets.join(", ")}`);
const saved = await callTool(arxivSaveTool, { arxivIds: targets });
check("savedCount === 3", saved.savedCount === 3, `savedCount=${saved.savedCount}`);
check("无 rejectedIds", saved.rejectedIds.length === 0, JSON.stringify(saved.rejectedIds));
check("无 notFoundIds", saved.notFoundIds.length === 0, JSON.stringify(saved.notFoundIds));
check(
  "保存条目均带作者与年份（元数据来自 arXiv，非调用方）",
  saved.saved.every((s) => s.authors.length >= 1 && s.year >= 1990),
);

// ---- 3. papers/ 落盘 ---------------------------------------------------
console.log("\n[3] memory/papers/ 落盘");
for (const id of targets) {
  const p = paperPath(runDir, id);
  const ok = existsSync(p);
  const body = ok ? readFileSync(p, "utf8") : "";
  check(`papers/${paperFilename(id)} 存在`, ok);
  check(`  卡片含 frontmatter + Abstract`, body.startsWith("---\n") && body.includes("## Abstract"));
}
check("listPapers 返回 3 篇", listPapers(runDir).length === 3, listPapers(runDir).join(", "));

// ---- 4. index.md 强制同步 ----------------------------------------------
console.log("\n[4] memory/index.md 同步");
const indexMd = readIndex(runDir);
const rows = parseIndexRows(indexMd);
check("index.md 有 3 行文献", rows.length === 3, `rows=${rows.length}`);
check(
  "index 行 id 集合 == 保存 id 集合",
  new Set(rows.map((r) => r.arxivId)).size === 3 && rows.every((r) => targets.includes(r.arxivId)),
  rows.map((r) => r.arxivId).join(", "),
);
check(
  "每行含 年份/标题/一句话摘要",
  rows.every((r) => /^\d{4}$/.test(r.year) && r.title.length > 0 && r.oneline.length > 0),
);
check(
  "index 行 id 均匹配 arxivIdPattern",
  rows.every((r) => arxivIdPattern.test(r.arxivId)),
);
for (const r of rows) console.log(`    | ${r.arxivId} | ${r.year} | ${r.title.slice(0, 50)} |`);

const viaTool = await callTool(paperIndexReadTool, {});
check("paper_index_read.count === 3", viaTool.count === 3, `count=${viaTool.count}`);
check("paper_index_read.index 与磁盘一致", viaTool.index === indexMd);

// ---- 5. 旧式 id 的 "/" → "__" 映射与验收器互逆 -------------------------
const legacyId = "astro-ph/0601001";
console.log(`\n[5] 旧式 id 映射：${legacyId}`);
const legacySave = await callTool(arxivSaveTool, { arxivIds: [legacyId] });
check("旧式 id 保存成功", legacySave.savedCount === 1, JSON.stringify(legacySave.notFoundIds));
check(
  `文件名为 astro-ph__0601001.md`,
  paperFilename(legacyId) === "astro-ph__0601001.md" && existsSync(paperPath(runDir, legacyId)),
);
check(
  "往返：arxivIdFromFilename ∘ paperFilename === id",
  arxivIdFromFilename(paperFilename(legacyId)) === legacyId,
);
// 磁盘侧的往返：验收器 B1 认的就是「readdir 的文件名 → id」这一步
const onDisk = readdirSync(papersDir(runDir)).filter((f) => f.endsWith(".md"));
const restored = new Set(onDisk.map(arxivIdFromFilename));
const expectedIds = new Set([...targets, legacyId]);
check(
  "从磁盘文件名能还原出全部已保存的 id（B1 的还原步）",
  expectedIds.size === restored.size && [...expectedIds].every((id) => restored.has(id)),
  [...restored].join(", "),
);
check(
  "还原出的 id 均匹配 arxivIdPattern",
  [...restored].every((id) => arxivIdPattern.test(id)),
);
check(
  "每个磁盘文件名都是它自己 id 的像（双向闭合）",
  onDisk.every((f) => paperFilename(arxivIdFromFilename(f)) === f),
  onDisk.join(", "),
);
check("index.md 增至 4 行", parseIndexRows(readIndex(runDir)).length === 4);

// ---- 6. 防虚构 ---------------------------------------------------------
console.log("\n[6] 防虚构：非法 / 不存在的 id");
const before = listPapers(runDir).length;
const bogus = await callTool(arxivSaveTool, {
  arxivIds: ["totally-made-up", "9999.99999"],
});
check("非法格式 id 进 rejectedIds（不发请求）", bogus.rejectedIds.includes("totally-made-up"));
check("arXiv 查无此文的 id 进 notFoundIds", bogus.notFoundIds.includes("9999.99999"));
check("savedCount === 0", bogus.savedCount === 0);
check("papers/ 数量未变", listPapers(runDir).length === before, `${before} → ${listPapers(runDir).length}`);

/* ---------------------------------------------------------------- */

console.log(`\n${failures.length === 0 ? "ALL PASS" : "FAILED"}: ${passed} passed, ${failures.length} failed`);
if (failures.length > 0) console.log(failures.map((f) => `  - ${f}`).join("\n"));
if (!keepDir) rmSync(runDir, { recursive: true, force: true });
rmSync(memoryDir, { recursive: true, force: true });
process.exit(failures.length === 0 ? 0 : 1);
