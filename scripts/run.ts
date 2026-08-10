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
 * 顺序是有讲究的：**先拿单并发锁，再建 runs/<ts>/ 并 export LUUP_RUN_DIR，最后起 master**。
 * 工具层（文献/工件）都经 runContext 读这个环境变量来定位 run 目录；
 * 晚设一步，文献就会落到 paperStore 的回退目录里，与本 run 的 proposal.json 分家。
 * 锁则要在建目录之前 —— 撞锁时不该留下一个空 run 目录。
 *
 * 触发方式 = 进程内 `run(masterAgent)`（@openai/agents）：无外部 host、无子进程、
 * 退出码语义由本文件独占。`.env` 也因此必须由本文件自己加载（原先由 eve invoke 代劳）。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { run } from "@openai/agents";
import { MASTER_MAX_TURNS, MASTER_TIMEOUT_MS, buildMasterAgent } from "#lib/agents/master.ts";
import { archiveRunOutcome } from "#lib/agents/campaignMemory.ts";
import { ProposalSchema, type Proposal } from "#lib/agents/contracts.ts";
// 题号的解析只有一份实现（lib/agents/runContext.ts）：驱动写进 meta.json 的那个数字，
// 与 app runtime 里 memory_note 定位题页用的那个数字，必须是同一个判定。
import { resolveQuestionId } from "#lib/agents/runContext.ts";
import { type Held, acquire, parentHoldsLock } from "../lib/lock.ts";
import { NODES } from "../lib/nodes.ts";
import { finalizeRun, verifyOffline } from "../lib/postflight.ts";
import { science125Text } from "../lib/questionText.ts";
import { findQuestion } from "../lib/science125.ts";
import { REPO_ROOT, RUNS_DIR } from "../lib/paths.ts";
import { utcStamp } from "../lib/runId.ts";
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
  // 默认题从共享 Science-125 题库+模板派生，没有第二份默认题文件。
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
/* 触发 master（进程内 @openai/agents run()）                            */
/* ------------------------------------------------------------------ */

/**
 * master 的开场 message。**顺序是判据，不是排版**：稳定段在前、每 run 变的段在后。
 *
 * 前缀缓存按 token 前缀命中，第一个不同的 token 之后全部作废（docs/design/architecture.md
 * 「KV cache 经营」）。题目、题号、run 目录三样每 run 都变；执行规格三行 125 次 run 一字不改。
 * 把变的放在不变的前面，等于把那三行永远排除在可复用前缀之外——**改动顺序不改动语义，
 * 但反过来写就白扔一段稳定前缀**。往这里加内容时照此归位：常量进上半段，每 run 变的进下半段。
 */
function buildPrompt(question: string, runDir: string, questionId: number | null): string {
  return [
    /* ---- 稳定段：125 次 run 逐字相同，与 instructions 一起构成可复用前缀 ---- */
    "运行一次完整的科研假设流水线。",
    "按 instructions 里的最小流程执行：scientist → reviewer → 最多一次 scientist 返修 → verify，",
    "只落 evidence.md、proposal.json、review.json；最后必须跑 verify_references 并拿到 ok:true 才算成功；",
    "否则写 FAILED.md 如实报失败。",
    "",
    /* ---- 易变段：每 run 都不同，一律后置 ---- */
    // 题号只是知会：memory_note 的定位键取自 LUUP_QUESTION_ID（lib/agents/runContext.ts），不经模型。
    questionId === null
      ? "本次运行没有 Science-125 题号（直接手跑）：memory_note 只能用 target=\"lessons\"。"
      : `Science-125 题号：Q${questionId}（memory_note 写题页时由运行环境自动定位，你不必也不能传题号）。`,
    `本次 run 目录：${runDir}（已建好；artifact_write / artifact_read 的路径一律相对它）。`,
    "",
    "科学问题：",
    question,
  ].join("\n");
}

type MasterOutcome = {
  code: number;
  /** master 收尾报告全文（run() 的 finalOutput）；失败时为空串。 */
  finalOutput: string;
  usage: { requests: number; inputTokens: number; outputTokens: number; totalTokens: number } | null;
  error?: string;
};

/**
 * 进程内跑 master。三种熔断都走 catch：轮数（MASTER_MAX_TURNS）、绝对时限
 * （MASTER_TIMEOUT_MS 的 AbortSignal）、模型/工具的不可恢复错误。eve 的
 * paused(exit 3)/Approve 续跑协议已不存在——预算一次性给足，超限即失败凭据
 * 落盘（失败诚实，criteria C4），不留人工续跑通道（human over the loop）。
 */
async function invokeMaster(prompt: string): Promise<MasterOutcome> {
  const master = buildMasterAgent();
  try {
    const result = await run(master, prompt, {
      maxTurns: MASTER_MAX_TURNS,
      signal: AbortSignal.timeout(MASTER_TIMEOUT_MS),
      // 百炼对回放的 reasoning item id 可能报 400（SDK 文档明示的兼容旋钮）
      reasoningItemIdPolicy: "omit",
    });
    const finalOutput =
      typeof result.finalOutput === "string" ? result.finalOutput : JSON.stringify(result.finalOutput ?? "");
    // master 收尾报告直通 stdout：外层（lib/spawn.ts / eval）从这里取工件路径清单
    process.stdout.write(`${finalOutput}\n`);
    const u = result.state.usage;
    return {
      code: 0,
      finalOutput,
      usage: {
        requests: u.requests,
        inputTokens: u.inputTokens,
        outputTokens: u.outputTokens,
        totalTokens: u.totalTokens,
      },
    };
  } catch (e) {
    return { code: 1, finalOutput: "", usage: null, error: String(e) };
  }
}

/** master 异常终止且自己没留失败凭据时的兜底报告（崩溃表「盘上留下什么」）。 */
function renderCrashReport(runDir: string, error: string): string {
  return [
    "# FAILED：master 会话异常终止",
    "",
    `- 判定时间：${new Date().toISOString()}`,
    `- run 目录：${runDir}`,
    `- 直接原因：${error}`,
    "- 可能的熔断源：轮数上限（MaxTurnsExceededError）、2h 绝对时限（TimeoutError/AbortError）、",
    "  模型端点不可恢复错误。这是预算/故障闸门生效，不是流水线按判据判定的不合格：",
    "  已落盘的工件仍然有效，但流水线没有走到 `verify_references` 拿到 `ok:true` 那一步。",
    "",
    "处置：整题重跑（续跑粒度是「题」不是「节点」）；反复撞轮数/时限则缩小输入规模，",
    "或经 `--rescue-model` 升档重跑（scripts/run-batch.ts 救援通道）。",
    "",
  ].join("\n");
}

/* ------------------------------------------------------------------ */
/* main                                                                */
/* ------------------------------------------------------------------ */

/* .env 由本文件自己加载（原先由 eve invoke 代劳）；缺 key 提前失败，不留空 run 目录 */
try {
  process.loadEnvFile(join(REPO_ROOT, ".env"));
} catch {
  // .env 不存在时不报错：环境变量也可能已经由外层注入
}
if (!process.env.QWEN_API_KEY || !process.env.QWEN_BASE_URL) {
  console.error("[luup] 缺 QWEN_API_KEY / QWEN_BASE_URL（.env 或环境变量），流水线无法调用模型。");
  process.exit(2);
}

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
// 关键顺序：先 export，再起 master（工具经 runContext 读它定位 run 目录）
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
/** 失败凭据：崩溃兜底可能由这里写，也可能 master 早就自己写过 —— 路径只有一份。 */
const failedPath = join(runDir, "FAILED.md");
const writeMeta = () => writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
// 先落一次：中途被 Ctrl-C / OOM 打断也留下 finishedAt=null，续跑不会误判为已完成
writeMeta();

// 题号从 meta 回灌运行环境：memory_note 写题页与 arxiv_save 的反查索引都经
// resolveQuestionId() 读 LUUP_QUESTION_ID（lib/agents/runContext.ts 头注：meta 写的
// 数字与工具定位用的数字必须是同一个判定）。默认题路径（defaultId）外层没人设
// 这个变量，不回灌的话 master 收尾的 memory_note(target="question") 必然 failed。
if (meta.questionId !== null) process.env.LUUP_QUESTION_ID = String(meta.questionId);

console.log(`[luup] run dir : ${runDir}`);
console.log(`[luup] question: ${source}${meta.questionId === null ? "" : `（Q${meta.questionId}）`}`);
console.log(`[luup] ${"-".repeat(60)}`);

const started = Date.now();
const master = await invokeMaster(buildPrompt(question, runDir, meta.questionId));
const { code } = master;
const elapsed = ((Date.now() - started) / 1000).toFixed(1);

writeFileSync(
  join(runDir, "invoke-result.json"),
  `${JSON.stringify(
    {
      status: code === 0 ? "completed" : "failed",
      finalOutput: master.finalOutput,
      usage: master.usage,
      ...(master.error === undefined ? {} : { error: master.error }),
    },
    null,
    2,
  )}\n`,
  "utf8",
);
console.log(`\n[luup] master run exit=${code}，耗时 ${elapsed}s`);

/* master 异常终止（轮数/时限熔断、端点故障）：必须留下失败凭据，否则外层无从判断 */
if (code !== 0) {
  console.error(`\n[luup] master 会话异常终止：${master.error ?? "(未知原因)"}`);
  if (existsSync(failedPath)) {
    console.error(`[luup] ${failedPath} 已存在（master 自己写过），保留原文不覆盖。`);
  } else {
    writeFileSync(failedPath, renderCrashReport(runDir, master.error ?? "(未知原因)"), "utf8");
    console.error(`[luup] 已写 ${failedPath}（崩溃兜底凭据）。`);
  }
}

/* 确定性渲染 proposal.md */
const proposalPath = join(runDir, "proposal.json");

/**
 * 读 proposal.json 并按契约校验。**缺失 / JSON 写坏 / 不合契约一律只降级，不抛。**
 * 这里是收尾段的第一步：一个裸 JSON.parse 抛出去，后面的 meta.exitCode 回写、
 * campaign memory 归档、runs 索引重建全部不会执行，而且进程会以未捕获异常的 1 退出 ——
 * 一次本可如实归档收尾的 run 会因为一份写坏的 proposal.json 丢掉全部收尾凭据
 * （meta 回写 / 归档 / 索引），只剩一个说不清缘由的 1。
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

console.log(`\n[luup] 自动执行确定性验收：node scripts/verify-proposal.ts ${runDir}`);

/*
 * 先落一个 provisional exitCode，再进入可能持续较久的离线验收。这样即使进程在
 * verification-report.md 写成 ALL PASS 后、最终 meta 回写前崩溃，盘上也已有明确的
 * 成功收尾凭据；若验收中途崩溃则没有 ALL PASS，仍不可交付、batch 会重跑。
 * finishedAt 只在 postflight 真正结束后填写，墙钟时间不提前冒充完成。
 */
meta.exitCode = code === 0 ? 0 : 1;
writeMeta();

/**
 * 「跑完了没有」与「验收过没过」都交给 postflight（lib/postflight.ts）：它先按
 * runOutcome 判断是否走到 proposal 正文，再自动运行独立验收。只有报告 ALL PASS 的
 * run 才退出 0；master 写了 FAILED.md、离线验收失败或验收器自身异常都不会冒充成功。
 * CLI、web 与 batch 都经本文件进入这道闸门，不再有「只有 batch 验收」的分叉。
 */
const postflight = await finalizeRun({ runDir, pipelineExitCode: code, verify: verifyOffline });
const exitCode = postflight.exitCode;
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
  const verdict = exitCode === 0 ? "SUCCESS" : "FAILED";
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
