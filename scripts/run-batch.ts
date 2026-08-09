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
 * 续跑判据 = run outcome 的 `deliverable`（proposal 正文已渲染 + 验收 ALL PASS +
 * 没有失败退出码）再加一个题号命中 —— 报告本身不带题号，所以还要 meta.questionId。
 * 判定本身一个字都不在这里：唯一 owner 是 lib/runOutcome.ts，web 的 passed 与这条
 * 续跑判据因此永远同判（scripts/selftest-outcome.ts 逐目录断言这件事）。
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT, RUNS_DIR } from "../lib/paths.ts";
import { science125Text } from "../lib/questionText.ts";
import { formatBytes, planPrune, summarize } from "../lib/retention.ts";
import { deliveredQuestionId, readRunEvidence } from "../lib/runOutcome.ts";
import { findQuestion } from "../lib/science125.ts";

/* ------------------------------------------------------------------ */
/* argv                                                                */
/* ------------------------------------------------------------------ */

const USAGE =
  "usage: node scripts/run-batch.ts <id 1-125> [<id> ...] [--force] [--dry-run] [--no-prune] [--prune-grace-min=N]";
const argv = process.argv.slice(2);
const flags = argv.filter((a) => a.startsWith("--"));
const KNOWN = new Set(["--force", "--dry-run", "--no-prune"]);
const unknown = flags.filter((f) => !KNOWN.has(f) && !f.startsWith("--prune-grace-min="));
if (unknown.length > 0) {
  console.error(`unknown flag: ${unknown.join(" ")}\n${USAGE}`);
  process.exit(2);
}
const force = flags.includes("--force");
const dryRun = flags.includes("--dry-run");
const noPrune = flags.includes("--no-prune");

/**
 * 每题验收完立刻清理 workflow 流数据。
 *
 * 不清理的话，.eve/.workflow-data/streams/chunks 每题涨 ~20MB（每个流 delta 一个 .bin，
 * 且每个 .bin 嵌全文快照），125 全量跑 = 2G+ 纯重放工件。判据见 prune-eve-state.ts ——
 * 在跑的 run 由「活跃窗口 + workflow 未终态 + run 无终态凭据」三条各自独立挡住。
 */
const pruneGraceMin = (() => {
  const hit = flags.find((f) => f.startsWith("--prune-grace-min="));
  if (!hit) return 60;
  const n = Number.parseInt(hit.slice("--prune-grace-min=".length), 10);
  if (!Number.isInteger(n) || n < 0) {
    console.error(`--prune-grace-min 必须是非负整数\n${USAGE}`);
    process.exit(2);
  }
  return n;
})();

function pruneNow(label: string): void {
  if (noPrune) return;
  try {
    const r = planPrune({ apply: true, graceMs: pruneGraceMin * 60 * 1000 });
    console.log(`[batch] prune ${label}：${summarize(r)}（状态盘余量 ${formatBytes(r.totalBytes - r.freedBytes)}）`);
  } catch (e) {
    // 清理是运维加速，不是交付的一部分：失败只告警，绝不打断批跑
    console.error(`[batch] prune ${label} 失败（不影响批跑）：${String(e)}`);
  }
}

// 去重：同一题号写两遍就是白烧两次 20 分钟的额度（completed 不在循环内刷新）
const ids = [...new Set(argv.filter((a) => !a.startsWith("--")).map((a) => Number.parseInt(a, 10)))];
if (ids.length === 0 || ids.some((i) => !Number.isInteger(i) || i < 1 || i > 125)) {
  console.error(USAGE);
  process.exit(2);
}

/** 题目查找与 web 入口同一份实现（lib/science125.ts）：按 id 字段查，不按下标。 */
function question(id: number): { id: number; domain: string; question: string } {
  const q = findQuestion(id);
  if (!q) {
    console.error(`fixtures/science125.json 里没有第 ${id} 题`);
    process.exit(2);
  }
  return q;
}

/* ------------------------------------------------------------------ */
/* 已完成扫描                                                           */
/* ------------------------------------------------------------------ */

/** 扫描 runs/*，返回「已交付」题号 → run 目录（同题多次成功取目录名最大的，即最新）。 */
function scanCompleted(): Map<number, string> {
  const done = new Map<number, string>();
  if (!existsSync(RUNS_DIR)) return done;
  for (const ent of readdirSync(RUNS_DIR, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!ent.isDirectory()) continue; // batch-*.md 是文件
    const dir = join(RUNS_DIR, ent.name);
    const qid = deliveredQuestionId(readRunEvidence(dir, ent.name));
    if (qid !== null) done.set(qid, dir);
  }
  return done;
}

/* ------------------------------------------------------------------ */
/* 执行                                                                 */
/* ------------------------------------------------------------------ */

function runNode(args: string[], extraEnv: Record<string, string> = {}): Promise<{ code: number; stdout: string }> {
  return new Promise((res, rej) => {
    const child = spawn("node", args, {
      cwd: REPO_ROOT,
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
    console.log(`[batch] skip Q${id} → ${prior}（run outcome: deliverable）`);
    rows.push({ id, domain: q.domain, runDir: prior, status: "skipped", pipeline: null, verify: null });
    continue;
  }
  if (dryRun) {
    console.log(`[batch] plan Q${id}（${q.domain}）：node scripts/run.ts <Q${id} 问题>`);
    rows.push({ id, domain: q.domain, runDir: "", status: "planned", pipeline: null, verify: null });
    continue;
  }

  console.log(`\n[batch] ===== Q${id}（${q.domain}）: ${q.question} =====\n`);
  const { code, stdout } = await runNode(["scripts/run.ts", science125Text(q)], { LUUP_QUESTION_ID: String(id) });
  const runDir = stdout.match(/\[luup\] run dir : (.+)/)?.[1]?.trim() ?? "";
  let verify: number | null = null;
  if (runDir && code === 0) {
    console.log(`\n[batch] 独立验收 Q${id} → ${runDir}\n`);
    verify = (await runNode(["scripts/verify-proposal.ts", runDir])).code;
  }
  const status: Status = code === 0 && verify === 0 ? "done" : "failed";
  rows.push({ id, domain: q.domain, runDir, status, pipeline: code, verify });

  // 验收已经结束 = 这一题的工件都落到了 runs/<ts>/，流数据自此无人消费
  pruneNow(`Q${id}`);
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
  const reportPath = join(RUNS_DIR, `batch-${stamp}.md`);
  writeFileSync(reportPath, report);
  console.log(`\n[batch] ${tally}`);
  console.log(`[batch] 汇总 → ${reportPath}`);
}
process.exit(rows.some((r) => r.status === "failed") ? 1 : 0);
