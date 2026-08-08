/**
 * E2E 驱动（criteria E1：单命令跑通）。
 *
 *   pnpm run:pipeline                       # 用 fixtures/default-question.md
 *   pnpm run:pipeline "<问题原文>"           # 直接给问题
 *   pnpm run:pipeline path/to/question.md   # 从文件读问题
 *
 * 可选环境变量 LUUP_QUESTION_ID=<Science-125 题号>：只写进 meta.json 做续跑索引，
 * 不参与提问（问题原文仍来自 argv/文件），run-batch 靠它认领已完成的题（criteria G5）。
 *
 * 顺序是有讲究的：**先建 runs/<ts>/ 并 export LUUP_RUN_DIR，再启动 eve**。
 * 文献工具与工件工具都在 app runtime 里读这个环境变量来定位 run 目录；
 * 晚设一步，文献就会落到 paperStore 的回退目录里，与本 run 的 proposal.json 分家。
 *
 * 触发方式选 `eve invoke`：headless、自带一次性 host、无需先起 dev server，
 * 且 WP1 已在本仓库真机验证过（eve/client 需要外部常驻 server，多一个失败面）。
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { archiveRunOutcome } from "#lib/campaignMemory.ts";
import { ProposalSchema, type Proposal } from "#lib/contracts.ts";
import { rebuildRunsIndex } from "../lib/runsIndex.ts";

const repoRoot = resolve(import.meta.dirname, "..");
const DEFAULT_QUESTION_FILE = join(repoRoot, "fixtures", "default-question.md");

/* ------------------------------------------------------------------ */
/* 输入                                                                 */
/* ------------------------------------------------------------------ */

function utcStamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`
  );
}

function readQuestion(arg: string | undefined): { question: string; source: string } {
  const raw = arg?.trim();
  if (raw) {
    // 看起来像路径且文件存在 → 读文件；否则当问题原文
    if (!/\s/.test(raw) && existsSync(resolve(repoRoot, raw))) {
      const file = resolve(repoRoot, raw);
      return { question: readFileSync(file, "utf8").trim(), source: file };
    }
    return { question: raw, source: "(argv)" };
  }
  if (!existsSync(DEFAULT_QUESTION_FILE)) {
    throw new Error(`默认问题文件不存在：${DEFAULT_QUESTION_FILE}`);
  }
  return { question: readFileSync(DEFAULT_QUESTION_FILE, "utf8").trim(), source: DEFAULT_QUESTION_FILE };
}

/* ------------------------------------------------------------------ */
/* proposal.json → proposal.md（确定性渲染，无 LLM）                      */
/* ------------------------------------------------------------------ */

const bullet = (items: string[]) => items.map((s) => `- ${s}`).join("\n");

/** 10 字段按 criteria.md 的 A1–A10 顺序，中文小节标题。 */
export function renderProposalMarkdown(p: Proposal, meta: { runDir: string; question: string }): string {
  return [
    `# ${p.paperTitle}`,
    "",
    "> 由 luup 多智能体流水线生成。引用已经确定性反查 arXiv API 核验。",
    "",
    "## 输入问题",
    "",
    meta.question,
    "",
    "## 1. 待研究问题（Problem Statement）",
    "",
    p.problemStatement,
    "",
    "## 2. 解决思路（Rationale）",
    "",
    p.rationale,
    "",
    "## 3. 必要的技术手段（Technical Details）",
    "",
    p.technicalDetails,
    "",
    "## 4. 数据集（Datasets）",
    "",
    `**Source（推演依据的历史数据）**：${p.datasets.source}`,
    "",
    `**Target（验证实验需采集的数据特征）**：${p.datasets.target}`,
    "",
    "## 5. 标题（Paper Title）",
    "",
    p.paperTitle,
    "",
    "## 6. 摘要（Paper Abstract）",
    "",
    p.paperAbstract,
    "",
    "## 7. 方法论（Methods）",
    "",
    p.methods,
    "",
    "## 8. 实验设计（Experiments）",
    "",
    "**Baselines**",
    "",
    bullet(p.experiments.baselines),
    "",
    "**Metrics**",
    "",
    bullet(p.experiments.metrics),
    "",
    "**Design**",
    "",
    p.experiments.design,
    "",
    "## 9. 实验结果与可行性论证（Results）",
    "",
    p.results,
    "",
    "## 10. 参考论文（References）",
    "",
    "| # | arXiv id | 标题 | 作者 | 年份 | 支撑的论点 |",
    "| --- | --- | --- | --- | --- | --- |",
    ...p.references.map((r, i) => {
      const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
      const authors = r.authors.length > 3 ? `${r.authors.slice(0, 3).join(", ")} et al.` : r.authors.join(", ");
      return `| ${i + 1} | [${r.arxivId}](https://arxiv.org/abs/${r.arxivId}) | ${cell(r.title)} | ${cell(authors)} | ${r.year} | ${cell(r.relevance)} |`;
    }),
    "",
  ].join("\n");
}

/* ------------------------------------------------------------------ */
/* meta.json（断点续跑索引，criteria G5）                                 */
/* ------------------------------------------------------------------ */

export type RunMeta = {
  /** Science-125 题号；直接手跑（无 LUUP_QUESTION_ID）时为 null。 */
  questionId: number | null;
  question: string;
  startedAt: string;
  /** 未写完 = 进程中途死掉；续跑时按「未完成」处理。 */
  finishedAt: string | null;
  exitCode: number | null;
};

function readQuestionId(): number | null {
  const raw = process.env.LUUP_QUESTION_ID?.trim();
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n >= 1 && n <= 125 ? n : null;
}

/* ------------------------------------------------------------------ */
/* 触发 eve                                                             */
/* ------------------------------------------------------------------ */

function buildPrompt(question: string, runDir: string, questionId: number | null): string {
  return [
    "运行一次完整的科研假设流水线。",
    "",
    "科学问题：",
    question,
    "",
    // 题号是 memory_note 的定位键：没有它，master 无法把战役记录归到正确的 q 页。
    ...(questionId === null
      ? ["本次运行没有 Science-125 题号（直接手跑）：memory_note 只能用 target=\"lessons\"。", ""]
      : [`Science-125 题号：Q${questionId}（memory_note 的 questionId 用这个数字）。`, ""]),
    `本次 run 目录：${runDir}（已建好；artifact_write / artifact_read 的路径一律相对它）。`,
    "按 instructions 里的 DAG 与循环控制硬规格执行：literature → hypothesis → critique → proposal，",
    "逐节点认证并落盘 verdicts/，最后必须跑 verify_references 并拿到 ok:true 才算成功；",
    "否则写 FAILED.md 如实报失败。",
  ].join("\n");
}

/**
 * `eve invoke` 的退出码是有语义的（node_modules/eve/docs/reference/cli.md）：
 * 0 = 完成，1 = 失败，**3 = 挂起（paused）**。
 *
 * root 会话触及 `limits.maxInputTokensPerSession` 时 eve 并不判失败，而是在下一次
 * 模型调用前挂起会话，发出 Approve / Stop 的续跑提示（agent-config.md「Runtime
 * limits」）。把 3 混同成 1，run 目录里就没有任何失败凭据，外层只看到一个说不清
 * 缘由的非零码 —— 与 instructions「预算耗尽写 FAILED.md」的硬规格自相矛盾。
 */
const EXIT_PAUSED = 3;

function renderPausedReport(runDir: string): string {
  const resultFile = join(runDir, "invoke-result.json");
  return [
    "# FAILED：会话因 token 配额暂停",
    "",
    `- 判定时间：${new Date().toISOString()}`,
    `- run 目录：${runDir}`,
    `- 直接原因：\`eve invoke\` 退出码 ${EXIT_PAUSED}（paused）。root 会话触及 \`agent/agent.ts\` 的`,
    "  `limits.maxInputTokensPerSession`，eve 在下一次模型调用前挂起会话，等待 **Approve**",
    "  （再发一个同样大小的预算窗口）或 **Stop**（取消在途 turn）。",
    "- 这是预算闸门生效，**不是**流水线按判据判定的不合格：已产出的工件仍然有效，",
    "  但流水线没有走到 `verify_references` 拿到 `ok:true` 那一步。",
    "",
    "## 续跑",
    "",
    "`invoke-result.json` 就是可续跑的结果对象（`--resume` 从 stdin 读它）：",
    "",
    "```sh",
    "# 批准：再发一个预算窗口继续跑（会继续花钱）",
    `cat ${resultFile} | npx eve invoke --resume "Approve"`,
    "",
    "# 停止：取消在途 turn，会话终结",
    `cat ${resultFile} | npx eve invoke --resume "Stop"`,
    "```",
    "",
    "要根治：调高 `agent/agent.ts` 的 `limits.maxInputTokensPerSession`，或缩小输入规模后重跑。",
    "",
  ].join("\n");
}

function invokeEve(prompt: string, runDir: string): Promise<{ code: number; stdout: string }> {
  return new Promise((res, rej) => {
    const child = spawn("npx", ["eve", "invoke", prompt], {
      cwd: repoRoot,
      env: { ...process.env, LUUP_RUN_DIR: runDir },
      stdio: ["ignore", "pipe", "inherit"], // stderr 直通，进度可见
    });
    let stdout = "";
    child.stdout.on("data", (c: Buffer) => {
      const s = c.toString();
      stdout += s;
      process.stdout.write(s);
    });
    child.on("error", rej);
    child.on("close", (code) => res({ code: code ?? -1, stdout }));
  });
}

/* ------------------------------------------------------------------ */
/* main                                                                */
/* ------------------------------------------------------------------ */

const { question, source } = readQuestion(process.argv[2]);
const runDir = join(repoRoot, "runs", utcStamp());
mkdirSync(runDir, { recursive: true });
// 关键顺序：先 export，再启动 eve（工具在 app runtime 读它定位 run 目录）
process.env.LUUP_RUN_DIR = runDir;

writeFileSync(join(runDir, "question.md"), `${question}\n`, "utf8");

const meta: RunMeta = {
  questionId: readQuestionId(),
  question,
  startedAt: new Date().toISOString(),
  finishedAt: null,
  exitCode: null,
};
const metaPath = join(runDir, "meta.json");
const writeMeta = () => writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
// 先落一次：中途被 Ctrl-C / OOM 打断也留下 finishedAt=null，续跑不会误判为已完成
writeMeta();

console.log(`[luup] run dir : ${runDir}`);
console.log(`[luup] question: ${source}${meta.questionId === null ? "" : `（Q${meta.questionId}）`}`);
console.log(`[luup] ${"-".repeat(60)}`);

const started = Date.now();
const { code, stdout } = await invokeEve(buildPrompt(question, runDir, meta.questionId), runDir);
const elapsed = ((Date.now() - started) / 1000).toFixed(1);

writeFileSync(join(runDir, "invoke-result.json"), stdout.trim() ? stdout : `{"exitCode":${code}}\n`, "utf8");
console.log(`\n[luup] eve invoke exit=${code}，耗时 ${elapsed}s`);

/* exit 3 = paused：不是失败，是被预算闸门挂起 —— 必须留下凭据，否则外层无从判断 */
if (code === EXIT_PAUSED) {
  console.error(
    "\n[luup] 会话因 token 配额暂停：root 触及 limits.maxInputTokensPerSession，" +
      "eve 已挂起会话并等待 Approve / Stop，这不是流水线判定的失败。",
  );
  const failedPath = join(runDir, "FAILED.md");
  if (existsSync(failedPath)) {
    console.error(`[luup] ${failedPath} 已存在（master 自己写过），保留原文不覆盖。`);
  } else {
    writeFileSync(failedPath, renderPausedReport(runDir), "utf8");
    console.error(`[luup] 已写 ${failedPath}（含 --resume 续跑指引）。`);
  }
}

/* 确定性渲染 proposal.md */
const proposalPath = join(runDir, "proposal.json");
let rendered = false;
if (existsSync(proposalPath)) {
  const parsed = ProposalSchema.safeParse(JSON.parse(readFileSync(proposalPath, "utf8")));
  if (parsed.success) {
    writeFileSync(join(runDir, "proposal.md"), renderProposalMarkdown(parsed.data, { runDir, question }), "utf8");
    rendered = true;
  } else {
    console.error("[luup] proposal.json 不符合 10 字段契约，跳过 Markdown 渲染：");
    for (const i of parsed.error.issues) console.error(`  - ${i.path.join(".") || "(root)"}: ${i.message}`);
  }
} else {
  console.error("[luup] 未产出 proposal.json（流水线未走到终点或已判 FAILED）。");
}

/* 工件清单 */
const artifacts = [
  "question.md",
  "meta.json",
  "evidence.md",
  "hypotheses.md",
  "critique.json",
  "proposal.json",
  "proposal.md",
  "FAILED.md",
  "memory/index.md",
  "memory/rejected.md",
  "invoke-result.json",
];
console.log(`\n[luup] 工件（${runDir}）：`);
for (const a of artifacts) {
  const p = join(runDir, a);
  console.log(`  ${existsSync(p) ? "✔" : "·"} ${a}${existsSync(p) ? `  ${p}` : ""}`);
}
const verdictsDir = join(runDir, "verdicts");
if (existsSync(verdictsDir)) {
  const { readdirSync } = await import("node:fs");
  for (const f of readdirSync(verdictsDir).sort()) console.log(`  ✔ verdicts/${f}`);
}
const papersDir = join(runDir, "memory", "papers");
if (existsSync(papersDir)) {
  const { readdirSync } = await import("node:fs");
  console.log(`  ✔ memory/papers/  (${readdirSync(papersDir).length} 篇)`);
}

console.log(`\n[luup] 确定性验收：node scripts/verify-proposal.ts ${runDir}`);

// 退出码透传：paused 原样带出 3（run-batch 会打印 exit 3），其余非成功一律 1
const exitCode = code === 0 && rendered ? 0 : code === EXIT_PAUSED ? EXIT_PAUSED : 1;
meta.finishedAt = new Date().toISOString();
meta.exitCode = exitCode;
writeMeta();

/* ------------------------------------------------------------------ */
/* campaign memory 归档（docs/design/memory.md「写入有两条独立路径」）      */
/*                                                                     */
/* 这是代码那条：master 忘了调 memory_note 也不致命。题号取自刚落盘的      */
/* meta.json（它才是断点续跑与批跑认领的权威）。                          */
/* 整段包在 try 里 —— memory/ 被删、磁盘只读、目录损坏，一律只告警：       */
/* 加速层绝不允许改变一次真实 run 的退出码。                              */
/* ------------------------------------------------------------------ */
function summarizeOutcome(): { verdict: string; summary: string } {
  const persisted = (() => {
    try {
      return JSON.parse(readFileSync(metaPath, "utf8")) as Partial<RunMeta>;
    } catch {
      return {} as Partial<RunMeta>;
    }
  })();
  const verdict = exitCode === 0 ? "SUCCESS" : exitCode === EXIT_PAUSED ? "PAUSED" : "FAILED";
  const parts: string[] = [];
  if (existsSync(proposalPath)) {
    const parsed = ProposalSchema.safeParse(JSON.parse(readFileSync(proposalPath, "utf8")));
    if (parsed.success) {
      parts.push(`胜出方案：${parsed.data.paperTitle}`);
      parts.push(`引用 ${parsed.data.references.length} 篇：${parsed.data.references.map((r) => r.arxivId).join(", ")}`);
    } else {
      parts.push("proposal.json 存在但不符合 10 字段契约。");
    }
  }
  const failedPath = join(runDir, "FAILED.md");
  if (existsSync(failedPath)) {
    const head = readFileSync(failedPath, "utf8").split("\n").filter((l) => l.trim()).slice(0, 8);
    parts.push(`FAILED.md 摘要：\n${head.join("\n")}`);
  }
  if (parts.length === 0) parts.push("未产出 proposal.json，也没有 FAILED.md（流水线中途死亡）。");
  parts.push(`问题：${(persisted.question ?? question).replace(/\s+/g, " ").slice(0, 200)}`);
  return { verdict, summary: parts.join("\n\n") };
}

try {
  const { verdict, summary } = summarizeOutcome();
  const archived = archiveRunOutcome({ questionId: meta.questionId, verdict, summary, runDir });
  if (archived.skipped) {
    console.log(`[luup] campaign memory 未启用（${archived.reason ?? "memory/ 不存在"}），跳过归档。`);
  } else {
    for (const w of archived.written) console.log(`[luup] memory 归档 ✔ ${w.path}`);
    for (const f of archived.failed) console.error(`[luup] memory 归档 ✘ ${f.path} — ${f.reason}`);
  }
} catch (e) {
  console.error(`[luup] campaign memory 归档异常（不影响本次 run 结果）：${String(e)}`);
}

/* runs/index.json 派生缓存：meta.json 刚落盘，这里重建才能把本次 run 算进去。
   与 memory 归档同理包在 try 里 —— 加速层不允许改变一次真实 run 的退出码。 */
try {
  const { path, count } = rebuildRunsIndex();
  console.log(`[luup] runs 索引 ✔ ${path}（${count} 条）`);
} catch (e) {
  console.error(`[luup] runs 索引重建失败（不影响本次 run 结果）：${String(e)}`);
}

process.exit(exitCode);
