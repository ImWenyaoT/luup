/**
 * campaign memory 自测（**零 API 费**：不碰 arXiv、不碰 LLM，全部用手造的 ArxivPaper）。
 *
 *   node scripts/selftest-memory.ts
 *
 * 覆盖 docs/design/memory.md 的四条验收线：
 *  1. savePaper 落 run 卡后**由代码**同步全局卡，`library/index.md` 整份重建、按学科分组、带反向索引
 *  2. `memory_note` 写后读回，返回 `{written[], failed[]}`；缺 questionId 时进 failed 而不是静默成功
 *  3. `searchMemory` 在 library / questions / lessons 三处都能命中，返回 L0 行 + 路径（无 embedding）
 *  4. **删掉 memory/ 后全部函数静默 no-op**：不抛、不重建目录，run 收尾照跑（可删除性红线）
 *
 * 全程在 os.tmpdir() 下操作，靠 LUUP_RUN_DIR / LUUP_MEMORY_DIR 改指向，
 * 仓库里的 runs/ 与 memory/ 一个字节都不会被改到；退出前恢复现场。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ArxivPaper } from "#lib/arxiv.ts";
import {
  MEMORY_DIR_ENV,
  archiveRunOutcome,
  describeLayout,
  listLibraryCards,
  memoryEnabled,
  searchMemory,
  writeNote,
} from "#lib/campaignMemory.ts";
import { listPapers, readIndex, savePaper } from "#lib/paperStore.ts";
import { RUN_DIR_ENV } from "#lib/runContext.ts";
import { parseTableRows } from "../lib/mdTable.ts";
import memoryNoteTool from "#tools/memory_note.ts";
import memorySearchTool from "#tools/memory_search.ts";

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

/** 与 selftest-literature 同款：直接调 defineTool 的 execute，ctx 用不到。 */
type ToolLike<I, O> = { execute(input: I, ctx: never): Promise<O> | O | AsyncIterable<O> };
async function callTool<I, O>(tool: ToolLike<I, O>, input: I): Promise<O> {
  const result = tool.execute(input, undefined as never);
  if (result !== null && typeof result === "object" && Symbol.asyncIterator in result) {
    throw new Error("selftest 不支持流式工具");
  }
  return await (result as Promise<O> | O);
}

/** 手造论文：零网络、零费用，字段与 agent/lib/arxiv.ts 的 ArxivPaper 一致。 */
function fakePaper(over: Partial<ArxivPaper> & { arxivId: string }): ArxivPaper {
  return {
    version: "v1",
    title: "A Placeholder Title",
    authors: ["Ada Lovelace", "Alan Turing"],
    summary: "We study something. It works. Further work is needed.",
    published: "2024-01-15T00:00:00Z",
    updated: "2024-01-15T00:00:00Z",
    year: 2024,
    primaryCategory: "astro-ph.SR",
    categories: ["astro-ph.SR"],
    absUrl: `https://arxiv.org/abs/${over.arxivId}`,
    pdfUrl: `https://arxiv.org/pdf/${over.arxivId}`,
    doi: null,
    comment: null,
    journalRef: null,
    ...over,
  };
}

/* ---------------------------------------------------------------- */

const sandbox = mkdtempSync(join(tmpdir(), "luup-selftest-memory-"));
const runDir = join(sandbox, "runs", "20260808-000000");
const memoryDir = join(sandbox, "memory");

const savedRunEnv = process.env[RUN_DIR_ENV];
const savedMemoryEnv = process.env[MEMORY_DIR_ENV];
const savedQuestionEnv = process.env.LUUP_QUESTION_ID;

process.env[RUN_DIR_ENV] = runDir;
process.env[MEMORY_DIR_ENV] = memoryDir;
mkdirSync(runDir, { recursive: true });
mkdirSync(memoryDir, { recursive: true }); // 只建根目录，子目录由代码按需补

/**
 * 布局断言走 campaignMemory 的显式测试面 describeLayout()，而不是把十个路径函数
 * 逐个 export 出来当公开接口 —— 后者会让「测试想看的内部结构」变成谁都不敢动的
 * 模块 API。索引行的反解走 lib/mdTable.ts 的共享解析式，与写出端成对。
 */
const layout = describeLayout(memoryDir);
const libraryRows = (markdown: string) =>
  parseTableRows(markdown, 5)
    .filter((c) => c[0] !== "arXiv id")
    .map((c) => ({ arxivId: c[0], year: c[1], title: c[2], oneline: c[3], questions: c[4] }));

console.log(`sandbox : ${sandbox}`);
console.log(`run dir : ${runDir}`);
console.log(`memory  : ${memoryDir}\n`);

// ---- 1. savePaper → library 同步 ---------------------------------------
console.log("[1] savePaper 落 run 卡 → 代码同步全局卡");
process.env.LUUP_QUESTION_ID = "54";
const p1 = fakePaper({
  arxivId: "2401.11111",
  title: "Magnetogram-based Solar Flare Prediction with Transformers",
  primaryCategory: "astro-ph.SR",
  summary: "We predict solar flares from magnetograms. Accuracy improves by 12%.",
});
savePaper(runDir, p1);

check("run 卡仍照常落盘（B1 证据链未受影响）", listPapers(runDir).length === 1, listPapers(runDir).join(", "));
check(
  "全局卡写入 library/papers/2401.11111.md",
  existsSync(join(layout.libraryPapers, layout.cardFilename("2401.11111"))),
);
const card1 = listLibraryCards(memoryDir)[0];
check("全局卡带 fetchedAt（run 卡没有的字段）", !!card1 && /^\d{4}-/.test(card1.fetchedAt), card1?.fetchedAt);
check("全局卡反向索引 questionIds=[54]", JSON.stringify(card1?.questionIds) === "[54]", JSON.stringify(card1?.questionIds));
check("全局卡正文保留了 Abstract（run 卡正文原样搬运）", readFileSync(join(layout.libraryPapers, layout.cardFilename("2401.11111")), "utf8").includes("## Abstract"));

// ---- 2. library/index.md 重建 ------------------------------------------
console.log("\n[2] library/index.md 由代码整份重建 + 按学科分组");
const p2 = fakePaper({
  arxivId: "astro-ph/0601001",
  title: "Cosmic Ray Propagation in the Galactic Halo",
  primaryCategory: "astro-ph.HE",
  categories: ["astro-ph.HE", "hep-ph"],
  year: 2006,
  published: "2006-01-02T00:00:00Z",
  updated: "2006-01-02T00:00:00Z",
  summary: "Cosmic ray propagation is modelled in the halo. Diffusion dominates.",
});
process.env.LUUP_QUESTION_ID = "61";
savePaper(runDir, p2);

const libIndex = readFileSync(layout.libraryIndex, "utf8");
const rows = libraryRows(libIndex);
check("index 有 2 行文献", rows.length === 2, `rows=${rows.length}`);
check("index 覆盖两个 id", new Set(rows.map((r) => r.arxivId)).size === 2, rows.map((r) => r.arxivId).join(", "));
check("按学科分组（astro-ph.HE / astro-ph.SR 两个 ## 段）", libIndex.includes("## astro-ph.HE") && libIndex.includes("## astro-ph.SR"));
check("旧式 id 的 `/` → `__` 文件名映射一致", existsSync(join(layout.libraryPapers, layout.cardFilename("astro-ph/0601001"))));
check("index 顶部声明「代码重建，请勿手改」", libIndex.includes("自动重建，请勿手改"));
check("index 仍写明 B1 不放松", libIndex.includes("criteria B1"));
check("memory/index.md 已派生", existsSync(layout.index) && readFileSync(layout.index, "utf8").includes("library/index.md"));

// 跨题复用：同一篇被第二题再次实检 → 反向索引累加，不是覆盖
console.log("\n[2b] 跨题复用：Q61 也用到 Q54 攒下的那篇");
savePaper(runDir, p1);
const card1b = listLibraryCards(memoryDir).find((c) => c.arxivId === "2401.11111");
check("questionIds 累加为 [54,61]", JSON.stringify(card1b?.questionIds) === "[54,61]", JSON.stringify(card1b?.questionIds));
check("fetchedAt 保留首次值（幂等，不刷新）", card1b?.fetchedAt === card1?.fetchedAt);
check("index 仍是 2 行（upsert 不重复建行）", libraryRows(readFileSync(layout.libraryIndex, "utf8")).length === 2);
check(
  "index 行含反向索引 q54 q61",
  libraryRows(readFileSync(layout.libraryIndex, "utf8")).some((r) => r.questions.includes("q54") && r.questions.includes("q61")),
);
check("run 内 index.md 未被 campaign 层污染", readIndex(runDir).includes("| arXiv id | 年份 | 标题 | 一句话摘要 |"));

// ---- 3. memory_note：写后读回 ------------------------------------------
console.log("\n[3] memory_note 写后读回 → {written[], failed[]}");
const note1 = await callTool(memoryNoteTool, {
  target: "question" as const,
  questionId: 54,
  note: "verdict: SUCCESS。胜出假设：磁图序列的时序注意力可提前 6 小时预警。被拒假设：纯统计外推（无物理机制，critique 一致驳回）。有效检索词：magnetogram flare prediction transformer。",
});
check("written 含 questions/q54.md 与 log.md", note1.written.length === 2, note1.written.map((w) => w.path).join(", "));
check("failed 为空", note1.failed.length === 0, JSON.stringify(note1.failed));
check("written 每条都 verified（读回验证）", note1.written.every((w) => w.verified));
const q54 = readFileSync(layout.questionPage(54), "utf8");
check("q54.md 真的落盘了 note 正文", q54.includes("磁图序列的时序注意力"));
check("q54.md 首次创建带 append-only 表头", q54.startsWith("# q54") && q54.includes("append-only"));

const note2 = await callTool(memoryNoteTool, {
  target: "question" as const,
  questionId: 54,
  note: "第二次跑：假设「用 GOES X 射线单通道即可」被拒——数据分辨率不足。",
});
const q54b = readFileSync(layout.questionPage(54), "utf8");
check("append-only：第二条追加后第一条仍在", q54b.includes("磁图序列的时序注意力") && q54b.includes("GOES X 射线单通道"), `bytes ${q54.length} → ${q54b.length}`);
check("第二次 written 仍为 2 条且无 failed", note2.written.length === 2 && note2.failed.length === 0);

const note3 = await callTool(memoryNoteTool, {
  target: "question" as const,
  questionId: null,
  note: "没有题号，应当进 failed 而不是静默成功。",
});
check("target=question 缺 questionId → failed 非空", note3.failed.length === 1, JSON.stringify(note3.failed));
check("此时 hint 明说没写成（不许被总结盖过去）", note3.hint.includes("未写入"), note3.hint);

const note4 = await callTool(memoryNoteTool, {
  target: "lessons" as const,
  questionId: null,
  note: "教训：astro-ph.SR 的 arXiv 覆盖良好，hep-ex 的实验细节多在 CERN 内部报告，检索命中率低（样本：3 题）。",
});
check("lessons 写入成功且无 failed", note4.written.length === 2 && note4.failed.length === 0, note4.written.map((w) => w.path).join(", "));

// ---- 4. log.md 固定前缀 -------------------------------------------------
console.log("\n[4] log.md 固定前缀（grep 可解析）");
// 日志由公开动词写出（archiveRunOutcome 是 run.ts 的收尾路径），不直接戳内部 append
archiveRunOutcome({ questionId: 54, verdict: "SUCCESS", summary: "refs=7", runDir });
const logText = readFileSync(layout.log, "utf8");
const headers = logText.split("\n").filter((l) => l.startsWith("## ["));
check("全部条目匹配 `## [date] <action> | q<id> | <verdict>`", headers.length >= 4 && headers.every((h) => /^## \[\d{4}-\d{2}-\d{2}\] (run|note|library-sync) \| q(-|\d+) \| \S+/.test(h)), `${headers.length} 条`);
check("存在 run|q54|SUCCESS 条目", headers.some((h) => /\] run \| q54 \| SUCCESS/.test(h)));
check("无题号条目写作 q-", headers.some((h) => /\| q- \|/.test(h)), headers.join(" ／ "));
check("明细行不破坏前缀（`- ` 开头另起一行）", logText.includes(`\n- ${runDir} refs=7`), runDir);

// ---- 5. searchMemory 命中 -----------------------------------------------
console.log("\n[5] searchMemory：grep 式，三处都能命中");
const hitLib = searchMemory({ query: "magnetogram flare prediction", memoryDir });
check("library/index.md 命中", hitLib.hits.some((h) => h.path === "memory/library/index.md"), hitLib.hits.map((h) => h.path).join(", "));
check("命中行是 L0 行（含标题原文）", hitLib.hits.some((h) => h.text.includes("Magnetogram-based Solar Flare Prediction")));
check("hits 带路径与行号", hitLib.hits.every((h) => h.path.startsWith("memory/") && h.line > 0));

const hitQ = searchMemory({ query: "GOES 单通道", memoryDir });
check("questions/q54.md 命中（跨 run 负结果）", hitQ.hits.some((h) => h.path === "memory/questions/q54.md"), hitQ.hits.map((h) => h.path).join(", "));

const hitL = searchMemory({ query: "hep-ex 覆盖", memoryDir });
check("lessons.md 命中", hitL.hits.some((h) => h.path === "memory/lessons.md"), hitL.hits.map((h) => h.path).join(", "));

const hitNone = searchMemory({ query: "quantum chromodynamics lattice", memoryDir });
check("无关 query 零命中（不做相似度兜底）", hitNone.hitCount === 0, `hitCount=${hitNone.hitCount}`);

const viaTool = await callTool(memorySearchTool, { query: "cosmic ray propagation", limit: 20 });
check("memory_search 工具可用且 enabled", viaTool.enabled && viaTool.hitCount > 0, `hitCount=${viaTool.hitCount}`);
check("工具 hint 明说命中只是线索（B1 不放松）", viaTool.hint.includes("arxiv_save"), viaTool.hint);

// ---- 6. run 收尾归档（代码兜底路径） ------------------------------------
console.log("\n[6] archiveRunOutcome（scripts/run.ts 的收尾兜底）");
const arch = archiveRunOutcome({ questionId: 61, verdict: "FAILED", summary: "critique 三轮未过：新颖性不足。", runDir });
check("归档写了 q61.md + log.md", !arch.skipped && arch.written.length === 2, arch.written.map((w) => w.path).join(", "));
check("归档无 failed", arch.failed.length === 0, JSON.stringify(arch.failed));
check("q61.md 含 verdict 与 run 指针", readFileSync(layout.questionPage(61), "utf8").includes("verdict: FAILED") && readFileSync(layout.questionPage(61), "utf8").includes(runDir));

/* ================================================================ */
/* 7. 可删除性红线：删掉 memory/ 后一切照常                            */
/* ================================================================ */
console.log("\n[7] 删除 memory/ → 全部函数静默 no-op（memory.md 验收标准④）");
rmSync(memoryDir, { recursive: true, force: true });
check("memory/ 确已删除", !existsSync(memoryDir) && !memoryEnabled(memoryDir));

let threw: string | null = null;
let noop = { upsert: false, log: false, note: false, search: false, archive: false, tool: false, toolSearch: false };
try {
  const before = listPapers(runDir).length;
  savePaper(runDir, fakePaper({ arxivId: "2402.22222", title: "Post-deletion paper" }));
  noop.upsert = listPapers(runDir).length === before + 1;

  // 题页与日志页是同一条写入路径的两端：公开动词静默 = 两者都没被建出来
  const n = writeNote({ target: "question", questionId: 54, note: "should be dropped" });
  noop.note = n.skipped === true && n.written.length === 0 && n.failed.length === 0;
  noop.log = !existsSync(layout.log) && !existsSync(layout.questionPage(54));

  const s = searchMemory({ query: "magnetogram", memoryDir });
  noop.search = s.enabled === false && s.hits.length === 0;

  const a = archiveRunOutcome({ questionId: 54, verdict: "SUCCESS", summary: "x", runDir });
  noop.archive = a.skipped === true && a.written.length === 0 && a.failed.length === 0;

  const w = writeNote({ target: "lessons", note: "should be dropped" });
  noop.tool = w.skipped === true;

  const t = await callTool(memoryNoteTool, { target: "lessons" as const, questionId: null, note: "dropped" });
  noop.tool = noop.tool && t.skipped === true && t.written.length === 0 && t.failed.length === 0;

  const ts = await callTool(memorySearchTool, { query: "magnetogram flare", limit: 20 });
  noop.toolSearch = ts.enabled === false && ts.hits.length === 0 && ts.hint.includes("不是错误");
} catch (e) {
  threw = String(e);
}

check("没有任何函数抛异常", threw === null, threw ?? "");
check("savePaper 照常落 run 卡（B1 不依赖 campaign 层）", noop.upsert);
check("日志页与题页均未被重建", noop.log);
check("writeNote(target=question) 静默 skipped", noop.note);
check("searchMemory 返回 enabled:false + 空 hits", noop.search);
check("archiveRunOutcome 静默 skipped（run.ts 收尾不炸）", noop.archive);
check("memory_note 工具返回 skipped、written/failed 皆空", noop.tool);
check("memory_search 工具返回 enabled:false 且 hint 说明不是错误", noop.toolSearch);
check("**未偷偷重建 memory/**（删掉就是删掉）", !existsSync(memoryDir));

// run.ts 收尾那段的等价调用：整段包 try 后仍能算出退出码
let finalizeOk = true;
try {
  const a = archiveRunOutcome({ questionId: null, verdict: "FAILED", summary: "无题号 + 无 memory/", runDir });
  finalizeOk = a.skipped === true;
} catch {
  finalizeOk = false;
}
check("run.ts 收尾逻辑（无题号 + 无 memory/）不炸", finalizeOk);

/* ---------------------------------------------------------------- */
/* 恢复现场                                                           */
/* ---------------------------------------------------------------- */
rmSync(sandbox, { recursive: true, force: true });
if (savedRunEnv === undefined) delete process.env[RUN_DIR_ENV];
else process.env[RUN_DIR_ENV] = savedRunEnv;
if (savedMemoryEnv === undefined) delete process.env[MEMORY_DIR_ENV];
else process.env[MEMORY_DIR_ENV] = savedMemoryEnv;
if (savedQuestionEnv === undefined) delete process.env.LUUP_QUESTION_ID;
else process.env.LUUP_QUESTION_ID = savedQuestionEnv;
check("现场已恢复（临时沙箱删除）", !existsSync(sandbox));

console.log(`\n${failures.length === 0 ? "ALL PASS" : "FAILED"}: ${passed} passed, ${failures.length} failed`);
if (failures.length > 0) console.log(failures.map((f) => `  - ${f}`).join("\n"));
process.exit(failures.length === 0 ? 0 : 1);
