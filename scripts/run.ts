/**
 * E2E 驱动（criteria E1：单命令跑通）。
 *
 *   pnpm run:pipeline                       # 默认题：Science-125 #61（题库+模板派生）
 *   pnpm run:pipeline "<问题原文>"           # 直接给问题
 *   pnpm run:pipeline path/to/question.md   # 从文件读问题
 *
 * 可选环境变量 LUUP_QUESTION_ID=<Science-125 题号>：只写进 meta.json 做续跑索引，
 * 不参与提问（问题原文仍来自 argv/文件），run-batch 靠它认领已完成的题（criteria G5）。
 *
 * 顺序是有讲究的：**先拿单并发锁，再建 runs/<ts>/ 并 export LUUP_RUN_DIR，最后启动 eve**。
 * 文献工具与工件工具都在 app runtime 里读这个环境变量来定位 run 目录；
 * 晚设一步，文献就会落到 paperStore 的回退目录里，与本 run 的 proposal.json 分家。
 * 锁则要在建目录之前 —— 撞锁时不该留下一个空 run 目录。
 *
 * 触发方式选 `eve invoke`：headless、自带一次性 host、无需先起 dev server，
 * 且 WP1 已在本仓库真机验证过（eve/client 需要外部常驻 server，多一个失败面）。
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { archiveRunOutcome } from "#lib/campaignMemory.ts";
import { ProposalSchema, type Proposal } from "#lib/contracts.ts";
// 题号的解析只有一份实现（agent/lib/runContext.ts）：驱动写进 meta.json 的那个数字，
// 与 app runtime 里 memory_note 定位题页用的那个数字，必须是同一个判定。
import { resolveQuestionId } from "#lib/runContext.ts";
import { type Held, acquire, parentHoldsLock } from "../lib/lock.ts";
import { NODES } from "../lib/nodes.ts";
import { science125Text } from "../lib/questionText.ts";
import { findQuestion } from "../lib/science125.ts";
import { REPO_ROOT, RUNS_DIR } from "../lib/paths.ts";
import { utcStamp } from "../lib/runId.ts";
import { reachedProposal, readRunEvidence, runOutcome } from "../lib/runOutcome.ts";
import { rebuildRunsIndex } from "../lib/runsIndex.ts";

const DEFAULT_QUESTION_ID = 61; // 默认演示题：Science-125 #61（How are pulsars formed?）

/* ------------------------------------------------------------------ */
/* 输入                                                                 */
/* ------------------------------------------------------------------ */

function readQuestion(arg: string | undefined): { question: string; source: string; defaultId?: number } {
  const raw = arg?.trim();
  if (raw) {
    // 看起来像路径且文件存在 → 读文件；否则当问题原文
    if (!/\s/.test(raw) && existsSync(resolve(REPO_ROOT, raw))) {
      const file = resolve(REPO_ROOT, raw);
      return { question: readFileSync(file, "utf8").trim(), source: file };
    }
    return { question: raw, source: "(argv)" };
  }
  // 默认题从题库+模板派生（lib/science125.json 是唯一事实源，没有第二份默认题文件）
  const q = findQuestion(DEFAULT_QUESTION_ID);
  if (!q) throw new Error(`题库里没有第 ${DEFAULT_QUESTION_ID} 题`);
  return { question: science125Text(q), source: `science125 #${DEFAULT_QUESTION_ID}`, defaultId: DEFAULT_QUESTION_ID };
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

/* ------------------------------------------------------------------ */
/* 单并发锁：lib/lock.ts 的 CLI adapter                                   */
/* ------------------------------------------------------------------ */

/**
 * 拿锁，或者退 2。返回 null = 锁已经在父进程手里（web 入口起的子进程），不重复拿也不由我们放。
 *
 * 撞锁不排队：批内的串行由 run-batch 的循环保证（子进程逐个起，本来就撞不上），撞上了
 * 就说明真有两个入口同时在起流水线 —— 那必须当场看得见，而不是排一个谁也没要求的队。
 */
function holdLock(): Held | null {
  if (parentHoldsLock()) return null;
  const got = acquire();
  if (got.ok) return got;
  const { runId, pid, startedAt } = got.holder;
  console.error(`[luup] 已有 pipeline 在跑：run=${runId ?? "(目录未定)"} pid=${pid} 起于 ${startedAt}`);
  console.error("[luup] 单并发是硬约束（端点并发阈值 + memory 单写者）；等它跑完再来。");
  process.exit(2);
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
    // 题号只是知会：memory_note 的定位键取自 LUUP_QUESTION_ID（agent/lib/runContext.ts），不经模型。
    ...(questionId === null
      ? ["本次运行没有 Science-125 题号（直接手跑）：memory_note 只能用 target=\"lessons\"。", ""]
      : [`Science-125 题号：Q${questionId}（memory_note 写题页时由运行环境自动定位，你不必也不能传题号）。`, ""]),
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
      cwd: REPO_ROOT,
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

const { question, source, defaultId } = readQuestion(process.argv[2]);

const lock = holdLock();
// 怎么退都要放锁：正常收尾、未捕获异常、Ctrl-C 都会走到 exit；SIGKILL 只能靠陈旧锁接管
process.on("exit", () => {
  lock?.release();
});
process.on("SIGINT", () => process.exit(130));
process.on("SIGTERM", () => process.exit(143));

const runId = utcStamp();
const runDir = join(RUNS_DIR, runId);
mkdirSync(runDir, { recursive: true });
lock?.setRunId(runId);
// 关键顺序：先 export，再启动 eve（工具在 app runtime 读它定位 run 目录）
process.env.LUUP_RUN_DIR = runDir;

writeFileSync(join(runDir, "question.md"), `${question}\n`, "utf8");

const meta: RunMeta = {
  questionId: resolveQuestionId() ?? defaultId ?? null,
  question,
  startedAt: new Date().toISOString(),
  finishedAt: null,
  exitCode: null,
};
const metaPath = join(runDir, "meta.json");
/** 失败凭据：paused 时可能由这里写，也可能 master 早就自己写过 —— 路径只有一份。 */
const failedPath = join(runDir, "FAILED.md");
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
  if (existsSync(failedPath)) {
    console.error(`[luup] ${failedPath} 已存在（master 自己写过），保留原文不覆盖。`);
  } else {
    writeFileSync(failedPath, renderPausedReport(runDir), "utf8");
    console.error(`[luup] 已写 ${failedPath}（含 --resume 续跑指引）。`);
  }
}

/* 确定性渲染 proposal.md */
const proposalPath = join(runDir, "proposal.json");

/**
 * 读 proposal.json 并按契约校验。**缺失 / JSON 写坏 / 不合契约一律只降级，不抛。**
 * 这里是收尾段的第一步：一个裸 JSON.parse 抛出去，后面的 meta.exitCode 回写、
 * campaign memory 归档、runs 索引重建全部不会执行，而且进程会以未捕获异常的 1 退出 ——
 * 一次「被预算闸门挂起」的 run（exit 3）会因为一份写坏的 proposal.json 退化成
 * 一个说不清缘由的 1，外层再也分不出是暂停还是失败。
 */
function readProposal(): { data: Proposal | null; issues: string[] } {
  if (!existsSync(proposalPath)) return { data: null, issues: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(proposalPath, "utf8"));
  } catch (e) {
    return { data: null, issues: [`proposal.json 不是合法 JSON：${String(e)}`] };
  }
  const parsed = ProposalSchema.safeParse(raw);
  return parsed.success
    ? { data: parsed.data, issues: [] }
    : {
        data: null,
        issues: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
      };
}

const proposal = readProposal();
if (proposal.data) {
  writeFileSync(join(runDir, "proposal.md"), renderProposalMarkdown(proposal.data, { runDir, question }), "utf8");
} else if (proposal.issues.length > 0) {
  console.error("[luup] proposal.json 不可用，跳过 Markdown 渲染：");
  for (const i of proposal.issues) console.error(`  - ${i}`);
} else {
  console.error("[luup] 未产出 proposal.json（流水线未走到终点或已判 FAILED）。");
}

/* 工件清单：节点工件从注册表派生（改名只改 lib/nodes.ts），run 自己写的那几个显式列 */
const artifacts = [
  "question.md",
  "meta.json",
  ...NODES.filter((n) => n.inManifest).map((n) => n.artifact),
  "proposal.md",
  "FAILED.md",
  "memory/index.md",
  "memory/rejected.md",
  "invoke-result.json",
];
console.log(`\n[luup] 工件（${runDir}）：`);
for (const a of artifacts) {
  const p = join(runDir, a);
  const there = existsSync(p);
  console.log(`  ${there ? "✔" : "·"} ${a}${there ? `  ${p}` : ""}`);
}
const verdictsDir = join(runDir, "verdicts");
if (existsSync(verdictsDir)) {
  for (const f of readdirSync(verdictsDir).sort()) console.log(`  ✔ verdicts/${f}`);
}
const papersDir = join(runDir, "memory", "papers");
if (existsSync(papersDir)) console.log(`  ✔ memory/papers/  (${readdirSync(papersDir).length} 篇)`);

console.log(`\n[luup] 确定性验收：node scripts/verify-proposal.ts ${runDir}`);

/**
 * 退出码透传：paused 原样带出 3（run-batch 会打印 exit 3），其余非成功一律 1。
 *
 * 「跑完了没有」不在这里手写：此刻 meta.exitCode 还没回写，run 目录就是最完整的证据，
 * 交给同一个 owner 判（lib/runOutcome.ts）。reachedProposal = proposal 正文已渲染
 * 且没有被 FAILED.md / 退出码否掉 —— master 写了 FAILED.md 却留着早轮 proposal 的
 * run 不再冒充成功（收编前 `rendered` 只看 proposal.json，会给出 exit 0）。
 * 验收过没过是另一件事（deliverable），由 scripts/verify-proposal.ts 单独判。
 */
const outcome = runOutcome(readRunEvidence(runDir));
const exitCode = code === 0 && reachedProposal(outcome) ? 0 : code === EXIT_PAUSED ? EXIT_PAUSED : 1;
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
  const verdict = exitCode === 0 ? "SUCCESS" : exitCode === EXIT_PAUSED ? "PAUSED" : "FAILED";
  const parts: string[] = [];
  if (proposal.data) {
    parts.push(`胜出方案：${proposal.data.paperTitle}`);
    parts.push(
      `引用 ${proposal.data.references.length} 篇：${proposal.data.references.map((r) => r.arxivId).join(", ")}`,
    );
  } else if (proposal.issues.length > 0) {
    parts.push(`proposal.json 存在但不可用：${proposal.issues[0]}`);
  }
  if (existsSync(failedPath)) {
    const head = readFileSync(failedPath, "utf8").split("\n").filter((l) => l.trim()).slice(0, 8);
    parts.push(`FAILED.md 摘要：\n${head.join("\n")}`);
  }
  if (parts.length === 0) parts.push("未产出 proposal.json，也没有 FAILED.md（流水线中途死亡）。");
  // 问题原文就在作用域里（meta.question 写的正是它）——不必再把刚写的 meta.json 读回来
  parts.push(`问题：${question.replace(/\s+/g, " ").slice(0, 200)}`);
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
