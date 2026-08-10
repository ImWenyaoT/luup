/**
 * 批量驱动（criteria E1b + G5 断点续跑）：按 Science-125 题号列表串行跑多题。
 *
 *   node scripts/run-batch.ts 54 125            # 跑第 54、125 题（已完成的自动跳过）
 *   node scripts/run-batch.ts 54 125 --force    # 无视已有成果，全部重跑
 *   node scripts/run-batch.ts 54 125 --dry-run  # 只打印计划，不起子进程、不写汇总
 *   node scripts/run-batch.ts 54 125 --rescue-model=qwen3.8-max   # 失败题批尾升档重跑一轮
 *
 * 串行原因：百炼端点并发过载阈值低（实测），且 memory/ 是无锁单写者。
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
import { deliveredQuestionId, readRunEvidence } from "../lib/runOutcome.ts";
import { findQuestion } from "../lib/science125.ts";

/* ------------------------------------------------------------------ */
/* argv                                                                */
/* ------------------------------------------------------------------ */

const USAGE =
  "usage: node scripts/run-batch.ts <id 1-125> [<id> ...] [--force] [--dry-run] [--rescue-model=<id>]";
const argv = process.argv.slice(2);
const flags = argv.filter((a) => a.startsWith("--"));
const KNOWN = new Set(["--force", "--dry-run"]);
const VALUED = ["--rescue-model="];
const unknown = flags.filter((f) => !KNOWN.has(f) && !VALUED.some((p) => f.startsWith(p)));
if (unknown.length > 0) {
  console.error(`unknown flag: ${unknown.join(" ")}\n${USAGE}`);
  process.exit(2);
}
const force = flags.includes("--force");
const dryRun = flags.includes("--dry-run");

/**
 * 救援升档（默认关闭）。开启后，主批里 `status=failed` 的题在**本批全部跑完之后**各用该
 * 模型重跑一轮 —— 不是主批内即时重试。
 *
 * 为什么放在批尾：串行批跑一题 ~20 分钟，即时重试会把一道难题的失败代价乘二并推迟后面
 * 所有题；批尾重跑则先拿到整批的覆盖面，再花钱救零头。
 *
 * 档位经 `LUUP_MODEL_ID` 注入子进程，由 `agent/lib/model.ts` 的 qwenModel 覆盖默认档，
 * 整条流水线（四个 agent 节点）随之升档。救援轮的 run **照常走全部 gate 与独立验收** ——
 * 它产出的是一次普通 run，不带任何豁免；判分器不受影响（judge 自己定档）。
 */
const rescueModel = (() => {
  const hit = flags.find((f) => f.startsWith("--rescue-model="));
  if (!hit) return null;
  const id = hit.slice("--rescue-model=".length).trim();
  if (id === "") {
    console.error(`--rescue-model 需要一个模型 id\n${USAGE}`);
    process.exit(2);
  }
  return id;
})();

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
    console.error(`lib/science125.json 里没有第 ${id} 题`);
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
type Lane = "main" | "rescue";
type Row = {
  id: number;
  domain: string;
  runDir: string;
  status: Status;
  pipeline: number | null;
  verify: number | null;
  lane: Lane;
};
const rows: Row[] = [];

/** 跑一题 + 独立验收。主批与救援轮走**同一条**路径，救援只是多注入一个环境变量。 */
async function runQuestion(id: number, lane: Lane, extraEnv: Record<string, string> = {}): Promise<Row> {
  const q = question(id);
  const tag = lane === "rescue" ? `Q${id}（救援 ${rescueModel}）` : `Q${id}`;
  console.log(`\n[batch] ===== ${tag}（${q.domain}）: ${q.question} =====\n`);
  const { code, stdout } = await runNode(["scripts/run.ts", science125Text(q)], {
    LUUP_QUESTION_ID: String(id),
    ...extraEnv,
  });
  const runDir = stdout.match(/\[luup\] run dir : (.+)/)?.[1]?.trim() ?? "";
  let verify: number | null = null;
  if (runDir && code === 0) {
    console.log(`\n[batch] 独立验收 ${tag} → ${runDir}\n`);
    verify = (await runNode(["scripts/verify-proposal.ts", runDir])).code;
  }
  const status: Status = code === 0 && verify === 0 ? "done" : "failed";
  return { id, domain: q.domain, runDir, status, pipeline: code, verify, lane };
}

const completed = force ? new Map<number, string>() : scanCompleted();
if (force) console.log("[batch] --force：忽略已有成果，全部重跑");
if (dryRun) console.log("[batch] --dry-run：只打印计划，不执行");
if (rescueModel) console.log(`[batch] --rescue-model=${rescueModel}：失败题将在本批结束后升档重跑一轮`);

for (const id of ids) {
  const q = question(id);
  const prior = completed.get(id);
  if (prior) {
    console.log(`[batch] skip Q${id} → ${prior}（run outcome: deliverable）`);
    rows.push({ id, domain: q.domain, runDir: prior, status: "skipped", pipeline: null, verify: null, lane: "main" });
    continue;
  }
  if (dryRun) {
    console.log(`[batch] plan Q${id}（${q.domain}）：node scripts/run.ts <Q${id} 问题>`);
    rows.push({ id, domain: q.domain, runDir: "", status: "planned", pipeline: null, verify: null, lane: "main" });
    continue;
  }
  rows.push(await runQuestion(id, "main"));
}

/* ------------------------------------------------------------------ */
/* 救援轮（批尾，仅 --rescue-model）                                      */
/* ------------------------------------------------------------------ */

if (rescueModel) {
  // dry-run 下没有真失败可捞：候选 = 这一批实际会去跑的题（skipped 的不算，它们已有成果）
  const candidates = rows.filter((r) => r.status === (dryRun ? "planned" : "failed")).map((r) => r.id);
  if (dryRun) {
    console.log(
      `[batch] plan rescue：本批结束后，失败题各用 ${rescueModel} 重跑一轮` +
        `（候选 ${candidates.length === 0 ? "无" : candidates.map((i) => `Q${i}`).join(" ")}）`,
    );
  } else if (candidates.length === 0) {
    console.log("[batch] rescue：本批没有失败题，救援轮跳过");
  } else {
    console.log(`\n[batch] ===== 救援轮：${candidates.map((i) => `Q${i}`).join(" ")} → ${rescueModel} =====\n`);
    for (const id of candidates) {
      rows.push(await runQuestion(id, "rescue", { LUUP_MODEL_ID: rescueModel }));
    }
  }
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
/** 救援救回来的题：主批 failed，救援轮 done。 */
const rescued = rows.filter((r) => r.lane === "rescue" && r.status === "done").length;
const tally =
  `done ${count("done")}｜skipped ${count("skipped")}｜failed ${count("failed")}` +
  (dryRun ? `｜planned ${count("planned")}` : "") +
  (rescueModel && !dryRun ? `｜救回 ${rescued}` : "");

const report = [
  `# 批量运行报告`,
  ``,
  ...(rescueModel ? [`救援升档：\`--rescue-model=${rescueModel}\`（失败题批尾各重跑一轮，照常走全部 gate 与独立验收）`, ``] : []),
  `| Q# | 学科 | 轮次 | 状态 | run 目录 | pipeline | 独立验收 |`,
  `|----|------|------|------|----------|----------|----------|`,
  ...rows.map(
    (r) =>
      `| ${r.id} | ${r.domain} | ${r.lane === "rescue" ? `救援 ${rescueModel}` : "主批"} | ${
        STATUS_CELL[r.status]
      } | ${r.runDir || "（未建立）"} | ${
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
/**
 * 退出码按**题**算，不按行算：一题只要有任意一轮交付成功（含救援轮）就不算失败。
 * 没有救援时每题恰好一行，与旧语义逐字等价。
 */
const unresolved = [...new Set(rows.filter((r) => r.status === "failed").map((r) => r.id))].filter(
  (id) => !rows.some((r) => r.id === id && (r.status === "done" || r.status === "skipped")),
);
process.exit(unresolved.length > 0 ? 1 : 0);
