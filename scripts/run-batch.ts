/**
 * 批量驱动（criteria E1b + G5 断点续跑）：按 Science-125 题号列表串行跑多题。
 *
 *   node scripts/run-batch.ts 54 125            # 跑第 54、125 题（已完成的自动跳过）
 *   node scripts/run-batch.ts 54 125 --force    # 无视已有成果，全部重跑
 *   node scripts/run-batch.ts 54 125 --dry-run  # 只打印计划，不起子进程、不写汇总
 *
 * 串行原因：百炼端点并发过载阈值低（实测），且 eve invoke 同仓库并发未验证。
 * 每题 = 一次 scripts/run.ts 子进程（run 目录由 run.ts 自建，从 stdout 解析），
 * 跑完立刻用 scripts/verify-proposal.ts 独立验收，汇总写 runs/batch-<ts>.md。
 *
 * 续跑判据（两个条件都要满足，缺一不认）：
 *   1. runs/<ts>/meta.json 的 questionId 命中且 exitCode === 0（流水线自己跑完了）
 *   2. 同目录 verification-report.md 含 "ALL PASS"（独立验收也过了）
 * 只看 meta 不够——流水线退 0 但引用被验收打回的情况真实存在；只看报告也不够——
 * 报告不带题号。两者合起来才等价于「这题已经交付」。
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");

type S125 = { questions: { id: number; domain: string; question: string }[] };
const s125 = JSON.parse(
  readFileSync(join(repoRoot, "fixtures", "science125.json"), "utf8"),
) as S125;

/* ------------------------------------------------------------------ */
/* argv                                                                */
/* ------------------------------------------------------------------ */

const USAGE = "usage: node scripts/run-batch.ts <id 1-125> [<id> ...] [--force] [--dry-run]";
const argv = process.argv.slice(2);
const flags = argv.filter((a) => a.startsWith("--"));
const unknown = flags.filter((f) => f !== "--force" && f !== "--dry-run");
if (unknown.length > 0) {
  console.error(`unknown flag: ${unknown.join(" ")}\n${USAGE}`);
  process.exit(2);
}
const force = flags.includes("--force");
const dryRun = flags.includes("--dry-run");

// 去重：同一题号写两遍就是白烧两次 20 分钟的额度（completed 不在循环内刷新）
const ids = [...new Set(argv.filter((a) => !a.startsWith("--")).map((a) => Number.parseInt(a, 10)))];
if (ids.length === 0 || ids.some((i) => !Number.isInteger(i) || i < 1 || i > 125)) {
  console.error(USAGE);
  process.exit(2);
}

/** 按 id 字段查，不按下标——下标对齐是 fixture 的偶然属性，不是契约（web/lib/science125.ts 同）。 */
function question(id: number): { id: number; domain: string; question: string } {
  const q = s125.questions.find((x) => x.id === id);
  if (!q) {
    console.error(`fixtures/science125.json 里没有第 ${id} 题`);
    process.exit(2);
  }
  return q;
}

/* ------------------------------------------------------------------ */
/* 已完成扫描                                                           */
/* ------------------------------------------------------------------ */

type RunMeta = { questionId?: unknown; exitCode?: unknown };

/**
 * 只认报告头部那一行 `结果: ALL PASS`，不做全文 includes——
 * 说明列里嵌的是 LLM 写的标题/作者原文，全文匹配会把失败报告读成通过。
 * 与 web/lib/phase.ts 的 ALL_PASS 保持同一判据。
 */
const ALL_PASS = /结果:\s*ALL PASS/;

/** 扫描 runs/*，返回「已交付」题号 → run 目录（同题多次成功取目录名最大的，即最新）。 */
function scanCompleted(): Map<number, string> {
  const done = new Map<number, string>();
  const runsDir = join(repoRoot, "runs");
  if (!existsSync(runsDir)) return done;
  for (const ent of readdirSync(runsDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!ent.isDirectory()) continue; // batch-*.md 是文件
    const dir = join(runsDir, ent.name);
    let meta: RunMeta;
    try {
      meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")) as RunMeta;
    } catch {
      continue; // 没有 meta.json（老 run）或写坏了 → 当没跑过
    }
    if (typeof meta.questionId !== "number" || meta.exitCode !== 0) continue;
    const report = join(dir, "verification-report.md");
    if (!existsSync(report)) continue;
    if (!ALL_PASS.test(readFileSync(report, "utf8"))) continue;
    done.set(meta.questionId, dir);
  }
  return done;
}

/* ------------------------------------------------------------------ */
/* 执行                                                                 */
/* ------------------------------------------------------------------ */

const questionText = (q: { id: number; domain: string; question: string }) =>
  [
    `来源：《Science》125 前沿科学问题（fixtures/science125.json）第 ${q.id} 题，${q.domain}。`,
    "",
    `问题：${q.question}`,
    "",
    "任务：围绕该问题识别当前研究的具体知识缺口，生成可验证的科学假设，并给出完整研究计划（10 标准字段）。",
  ].join("\n");

function runNode(args: string[], extraEnv: Record<string, string> = {}): Promise<{ code: number; stdout: string }> {
  return new Promise((res, rej) => {
    const child = spawn("node", args, {
      cwd: repoRoot,
      env: { ...process.env, ...extraEnv },
      stdio: ["ignore", "pipe", "inherit"],
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

type Status = "done" | "skipped" | "failed" | "planned";
type Row = { id: number; domain: string; runDir: string; status: Status; pipeline: number | null; verify: number | null };
const rows: Row[] = [];

const completed = force ? new Map<number, string>() : scanCompleted();
if (force) console.log("[batch] --force：忽略已有成果，全部重跑");
if (dryRun) console.log("[batch] --dry-run：只打印计划，不执行");

for (const id of ids) {
  const q = question(id);
  const prior = completed.get(id);
  if (prior) {
    console.log(`[batch] skip Q${id} → ${prior}（meta.exitCode=0 且 verification-report.md ALL PASS）`);
    rows.push({ id, domain: q.domain, runDir: prior, status: "skipped", pipeline: null, verify: null });
    continue;
  }
  if (dryRun) {
    console.log(`[batch] plan Q${id}（${q.domain}）：node scripts/run.ts <Q${id} 问题>`);
    rows.push({ id, domain: q.domain, runDir: "", status: "planned", pipeline: null, verify: null });
    continue;
  }

  console.log(`\n[batch] ===== Q${id}（${q.domain}）: ${q.question} =====\n`);
  const { code, stdout } = await runNode(["scripts/run.ts", questionText(q)], { LUUP_QUESTION_ID: String(id) });
  const runDir = stdout.match(/\[luup\] run dir : (.+)/)?.[1]?.trim() ?? "";
  let verify: number | null = null;
  if (runDir && code === 0) {
    console.log(`\n[batch] 独立验收 Q${id} → ${runDir}\n`);
    verify = (await runNode(["scripts/verify-proposal.ts", runDir])).code;
  }
  const status: Status = code === 0 && verify === 0 ? "done" : "failed";
  rows.push({ id, domain: q.domain, runDir, status, pipeline: code, verify });
}

/* ------------------------------------------------------------------ */
/* 汇总                                                                 */
/* ------------------------------------------------------------------ */

const STATUS_CELL: Record<Status, string> = {
  done: "✅ done",
  skipped: "⏭ skipped",
  failed: "❌ failed",
  planned: "· planned",
};

const count = (s: Status) => rows.filter((r) => r.status === s).length;
const tally =
  `done ${count("done")}｜skipped ${count("skipped")}｜failed ${count("failed")}` +
  (dryRun ? `｜planned ${count("planned")}` : "");

const report = [
  `# 批量运行报告`,
  ``,
  `| Q# | 学科 | 状态 | run 目录 | pipeline | 独立验收 |`,
  `|----|------|------|----------|----------|----------|`,
  ...rows.map(
    (r) =>
      `| ${r.id} | ${r.domain} | ${STATUS_CELL[r.status]} | ${r.runDir || "（未建立）"} | ${
        r.pipeline === null ? "—" : r.pipeline === 0 ? "✅" : `❌ exit ${r.pipeline}`
      } | ${r.verify === null ? "—" : r.verify === 0 ? "✅ ALL PASS" : `❌ exit ${r.verify}`} |`,
  ),
  ``,
  tally,
  ``,
].join("\n");

if (dryRun) {
  console.log(`\n${report}`);
} else {
  const stamp = new Date().toISOString().replace(/[:.]/g, "").slice(0, 15);
  const reportPath = join(repoRoot, "runs", `batch-${stamp}.md`);
  writeFileSync(reportPath, report);
  console.log(`\n[batch] ${tally}`);
  console.log(`[batch] 汇总 → ${reportPath}`);
}
process.exit(rows.some((r) => r.status === "failed") ? 1 : 0);
