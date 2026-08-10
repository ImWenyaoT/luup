/**
 * run outcome + 返工预算自测（零 API，零网络）。
 *
 *   node scripts/selftest-outcome.ts
 *
 * 两个 owner 在这里一起守：`lib/runOutcome.ts`（一次 run 的终态）与 `lib/rework.ts`
 * （一个节点还能不能再来一轮）。放同一个进程是因为它们共用同一批 run 目录形态，
 * 且都是「唯一 owner + 纯函数 + 目录即状态」的同一条纪律。
 *
 * 终态判定收敛成一个 owner（lib/runOutcome.ts）之后，这里守住三件事：
 *
 * 1. **两个证据构造器等价**：`readRunEvidence(dir)`（脚本侧）与 `evidenceFromScan(scan)`
 *    （web 侧）对同一个目录必须给出逐字段相同的证据。两条取证通路是这次收敛的唯一分叉点。
 * 2. **四个读者与判定一致**：web 五态、run-batch 续跑认领、rebuild-memory 的
 *    三字符串、run.ts 的退出码。
 *    重点是**续跑判据与 web `passed` 对同一目录必须同判**（只差一个题号）。
 *    锁在 web 五态里是显式入参（deriveStatus 的 activeId），所以这里能对同一个目录
 *    分别摆出「没人持锁」与「锁在自己手上」两半 —— 锁自己的行为在 selftest-lock.ts。
 * 3. **没有回归**：把收编前那六份手写判据作为 oracle 写在下面（`legacy*` 函数），
 *    对每个形态断言新判定与它一致 —— 一致性有意的例外单独标注 `legacy: "changed"`。
 *
 * 形态取自真实 runs/：终态成功、如实 FAILED、中断无 finishedAt、只有报告没有 meta
 * （手工验收过的 eval run）、meta 写坏、渲染了但验收没过、FAILED 与 proposal 并存。
 *
 * 另外三节（[11]–[13]）：崩溃表三形态、返工预算纯函数、以及预算的执行点
 * `artifact_write` 真的拒写第 4 轮。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { writeArtifact } from "#lib/artifacts.ts";
import { RUNS_DIR } from "../lib/paths.ts";
import { check, eq, report } from "./selftestHarness.ts";
import { deriveStatus, evidenceFromScan, scanDir, scanRun } from "../lib/phase.ts";
import { type VerdictFact, admitVerdict, reworkBudget, verdictFact } from "../lib/rework.ts";
import { RUN_ID_RE, isRunId, stampToMs, utcStamp } from "../lib/runId.ts";
import {
  type RunPhase,
  deliveredQuestionId,
  reachedProposal,
  readRunEvidence,
  runOutcome,
} from "../lib/runOutcome.ts";
import { listRunIds } from "../lib/runs.ts";
import type { RunStatus } from "../lib/types.ts";

function readTextOr(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

/* ------------------------------------------------------------------ */
/* 收编前的六份手写判据（oracle）                                         */
/* ------------------------------------------------------------------ */

const legacyAllPass = (report: string | null) => report !== null && /结果:\s*ALL PASS/.test(report);

/** 旧 lib/phase.ts deriveStatus（去掉锁那一支）。 */
function legacyStatus(f: Files): Exclude<RunStatus, "running"> {
  if (f["FAILED.md"] !== undefined) return "failed";
  if (f["proposal.md"] !== undefined) return legacyAllPass(f["verification-report.md"] ?? null) ? "passed" : "completed";
  const exitCode = legacyJson(f["exit.json"])?.exitCode;
  if (typeof exitCode === "number" && exitCode !== 0) return "failed";
  const metaCode = legacyJson(f["meta.json"])?.exitCode;
  if (typeof metaCode === "number" && metaCode !== 0) return "failed";
  return "stale";
}

/** 旧 scripts/run-batch.ts scanCompleted。 */
function legacyDelivered(f: Files): number | null {
  const meta = legacyJson(f["meta.json"]);
  if (typeof meta?.questionId !== "number" || meta.exitCode !== 0) return null;
  return legacyAllPass(f["verification-report.md"] ?? null) ? meta.questionId : null;
}

/** 收编前（已删的 lib/retention.ts）的 TERMINAL_RUN_MARKERS。 */
const legacyTerminal = (f: Files) =>
  f["verification-report.md"] !== undefined || f["FAILED.md"] !== undefined;

/** 旧 scripts/rebuild-memory.ts 的三字符串。 */
const legacyVerdict = (f: Files) =>
  f["FAILED.md"] !== undefined ? "FAILED" : legacyAllPass(f["verification-report.md"] ?? null) ? "ALL PASS" : "UNVERIFIED";

/** 旧 scripts/run.ts 的 `rendered`：proposal.json 过了契约校验 —— 等价于 proposal.md 刚被写出来。 */
const legacyRendered = (f: Files) => f["proposal.md"] !== undefined;

function legacyJson(raw: string | undefined): { questionId?: unknown; exitCode?: unknown } | null {
  if (raw === undefined) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* fixture                                                             */
/* ------------------------------------------------------------------ */

type Files = Record<string, string>;

type Case = {
  id: string;
  note: string;
  files: Files;
  phase: RunPhase;
  terminal: boolean;
  deliverable: boolean;
  status: Exclude<RunStatus, "running">;
  delivered: number | null;
  /** 走到 proposal 正文了吗（run.ts 退出码判定读的那一位）。 */
  reached: boolean;
  /** 与收编前的手写判据是否一致；"changed" 的例外在下面逐条说明。 */
  legacy: "same" | "changed";
};

const HOUR = 60 * 60 * 1000;
const NOW = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();
const meta = (v: Record<string, unknown>) => `${JSON.stringify(v, null, 2)}\n`;
const ALL_PASS_REPORT = "# 独立验收\n\n结果: ALL PASS\n";

const CASES: Case[] = [
  {
    id: "20200101-000000",
    note: "终态成功：proposal 正文 + ALL PASS + exitCode 0",
    files: {
      "question.md": "Q\n",
      "proposal.json": "{}\n",
      "proposal.md": "# p\n",
      "verification-report.md": ALL_PASS_REPORT,
      "meta.json": meta({ questionId: 7, startedAt: iso(NOW - 4 * HOUR), finishedAt: iso(NOW - 3 * HOUR), exitCode: 0 }),
    },
    phase: "verified",
    terminal: true,
    deliverable: true,
    status: "passed",
    delivered: 7,
    reached: true,
    legacy: "same",
  },
  {
    id: "20200102-000000",
    note: "如实 FAILED：FAILED.md + 非零退出码",
    files: {
      "question.md": "Q\n",
      "FAILED.md": "# FAILED\n",
      "meta.json": meta({ questionId: 8, startedAt: iso(NOW - 4 * HOUR), finishedAt: iso(NOW - 3 * HOUR), exitCode: 1 }),
    },
    phase: "failed",
    terminal: true,
    deliverable: false,
    status: "failed",
    delivered: null,
    reached: false,
    legacy: "same",
  },
  {
    id: "20200103-000000",
    note: "中断：meta 落了 startedAt，finishedAt / exitCode 都还是 null",
    files: {
      "question.md": "Q\n",
      "evidence.md": "e\n",
      "meta.json": meta({ questionId: 9, startedAt: iso(NOW - 2 * HOUR), finishedAt: null, exitCode: null }),
    },
    phase: "unsettled",
    terminal: false,
    deliverable: false,
    status: "stale",
    delivered: null,
    reached: false,
    legacy: "same",
  },
  {
    id: "20200104-000000",
    note: "只有报告没有 meta / 没有 proposal.md（手工验收过的 eval run）",
    files: { "proposal.json": "{}\n", "verification-report.md": ALL_PASS_REPORT },
    phase: "unsettled",
    terminal: true,
    deliverable: false,
    status: "stale",
    delivered: null,
    reached: false,
    legacy: "same",
  },
  {
    id: "20200105-000000",
    note: "meta 写坏：交付物齐全，但题号无从得知",
    files: {
      "question.md": "Q\n",
      "proposal.json": "{}\n",
      "proposal.md": "# p\n",
      "verification-report.md": ALL_PASS_REPORT,
      "meta.json": "{ this is not json",
    },
    phase: "verified",
    terminal: true,
    deliverable: true,
    status: "passed",
    delivered: null,
    reached: true,
    legacy: "same",
  },
  {
    id: "20200106-000000",
    note: "渲染了但验收没过",
    files: {
      "question.md": "Q\n",
      "proposal.json": "{}\n",
      "proposal.md": "# p\n",
      "verification-report.md": "结果: 5/17 FAILED\n",
      "meta.json": meta({ questionId: 11, startedAt: iso(NOW - 4 * HOUR), finishedAt: iso(NOW - 3 * HOUR), exitCode: 0 }),
    },
    phase: "rendered",
    terminal: true,
    deliverable: false,
    status: "completed",
    delivered: null,
    // 流水线跑完了就是跑完了：验收没过是 deliverable 的事，不改 run.ts 的退出码
    reached: true,
    legacy: "same",
  },
  {
    id: "20200107-000000",
    note: "FAILED.md 与早轮 proposal 并存 —— 失败凭据压过一切",
    files: {
      "question.md": "Q\n",
      "proposal.json": "{}\n",
      "proposal.md": "# p\n",
      "FAILED.md": "# FAILED\n",
      "meta.json": meta({ questionId: 12, startedAt: iso(NOW - 4 * HOUR), finishedAt: iso(NOW - 3 * HOUR), exitCode: 1 }),
    },
    phase: "failed",
    terminal: true,
    deliverable: false,
    status: "failed",
    delivered: null,
    // 收编前 run.ts 只看 proposal.json，这个形态会退 0 冒充成功；现在退 1。
    reached: false,
    legacy: "same",
  },
  {
    id: "20200108-000000",
    note: "空壳：只有问题，什么都没跑出来",
    files: { "question.md": "Q\n" },
    phase: "unsettled",
    terminal: false,
    deliverable: false,
    status: "stale",
    delivered: null,
    reached: false,
    legacy: "same",
  },
  {
    id: "20200110-000000",
    note: "流水线跑完、独立验收还没跑（批跑里 run.ts 与 verify-proposal 之间的那一刻）",
    files: {
      "question.md": "Q\n",
      "proposal.json": "{}\n",
      "proposal.md": "# p\n",
      "meta.json": meta({ questionId: 14, startedAt: iso(NOW - 4 * HOUR), finishedAt: iso(NOW - 3 * HOUR), exitCode: 0 }),
    },
    phase: "rendered",
    terminal: true,
    deliverable: false,
    status: "completed",
    delivered: null,
    reached: true,
    legacy: "same",
  },
  {
    id: "20200109-000000",
    note: "分叉形态：验收 ALL PASS 但流水线退了非零码",
    files: {
      "question.md": "Q\n",
      "proposal.json": "{}\n",
      "proposal.md": "# p\n",
      "verification-report.md": ALL_PASS_REPORT,
      "meta.json": meta({ questionId: 13, startedAt: iso(NOW - 4 * HOUR), finishedAt: iso(NOW - 3 * HOUR), exitCode: 1 }),
    },
    phase: "rendered",
    terminal: true,
    deliverable: false,
    status: "completed",
    delivered: null,
    reached: true,
    // 收编前：web 判 passed（不看退出码），run-batch 判要重跑（看退出码）—— 同一目录两个结论。
    // 现在两边都走 deliverable，一致判「没交付」。这正是这次收敛要消掉的分叉。
    legacy: "changed",
  },
  {
    id: "20200111-000000",
    note: "provisional 收尾：exitCode 0 已落，离线验收尚未写报告",
    files: {
      "question.md": "Q\n",
      "proposal.json": "{}\n",
      "proposal.md": "# p\n",
      "meta.json": meta({ questionId: 14, startedAt: iso(NOW - HOUR), finishedAt: null, exitCode: 0 }),
    },
    phase: "rendered",
    terminal: true,
    deliverable: false,
    status: "completed",
    delivered: null,
    reached: true,
    legacy: "same",
  },
  {
    id: "20200112-000000",
    note: "provisional 收尾：ALL PASS 已落，最终 finishedAt 尚未回写",
    files: {
      "question.md": "Q\n",
      "proposal.json": "{}\n",
      "proposal.md": "# p\n",
      "verification-report.md": ALL_PASS_REPORT,
      "meta.json": meta({ questionId: 15, startedAt: iso(NOW - HOUR), finishedAt: null, exitCode: 0 }),
    },
    phase: "verified",
    terminal: true,
    deliverable: true,
    status: "passed",
    delivered: 15,
    reached: true,
    legacy: "same",
  },
];

const root = mkdtempSync(join(tmpdir(), "luup-outcome-"));
const runsDir = join(root, "runs");
for (const c of CASES) {
  const dir = join(runsDir, c.id);
  mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(c.files)) writeFileSync(join(dir, name), body, "utf8");
}

const dirOf = (c: Case) => join(runsDir, c.id);
const evidenceOf = (c: Case) => readRunEvidence(dirOf(c));

/* ------------------------------------------------------------------ */
/* 1. 两个证据构造器等价                                                 */
/* ------------------------------------------------------------------ */

console.log("\n[1] 取证：目录构造器 == Scan 构造器");
for (const c of CASES) {
  const fromDir = evidenceOf(c);
  const scan = scanDir(dirOf(c));
  const fromScan = scan ? evidenceFromScan(scan) : null;
  check(
    `${c.id} 两条取证通路逐字段一致（${c.note}）`,
    fromScan !== null && isDeepStrictEqual(fromDir, fromScan),
    `dir=${JSON.stringify(fromDir)}\n    scan=${JSON.stringify(fromScan)}`,
  );
}

/* ------------------------------------------------------------------ */
/* 2. 判定本身                                                          */
/* ------------------------------------------------------------------ */

console.log("\n[2] runOutcome —— phase / terminal / deliverable / 时间");
for (const c of CASES) {
  const o = runOutcome(evidenceOf(c));
  eq(`${c.id} phase`, o.phase, c.phase);
  eq(`${c.id} terminal`, o.terminal, c.terminal);
  eq(`${c.id} deliverable`, o.deliverable, c.deliverable);
  check(
    `${c.id} 未终结就没有结束时间`,
    c.terminal ? o.finishedMs !== null : o.finishedMs === null,
    `terminal=${o.terminal} finishedMs=${o.finishedMs}`,
  );
  check(`${c.id} 起始时间总能算出来（meta 缺失退到 run id）`, o.startedMs !== null);
}

const noEvidence = runOutcome(readRunEvidence(join(runsDir, "20200131-000000")));
eq("目录根本不存在时不抛，判 unsettled", noEvidence.phase, "unsettled");
eq("目录根本不存在时不算终结", noEvidence.terminal, false);
eq("目录根本不存在时仍能从 run id 取到起始时间", noEvidence.startedMs, Date.UTC(2020, 0, 31));

/* ------------------------------------------------------------------ */
/* 3. 六个读者                                                          */
/* ------------------------------------------------------------------ */

console.log("\n[3] 读者 ① web 五态 —— 锁是显式入参，同一个目录能摆出两半");
for (const c of CASES) {
  const scan = scanDir(dirOf(c));
  eq(`${c.id} deriveStatus（没人持锁）`, scan ? deriveStatus(scan, null) : null, c.status);
  eq(`${c.id} deriveStatus（锁在别的 run 手上）`, scan ? deriveStatus(scan, "20201231-000000") : null, c.status);
  eq(`${c.id} deriveStatus（锁就在自己手上）`, scan ? deriveStatus(scan, c.id) : null, "running");
}

console.log("\n[4] 读者 ③ run-batch 续跑认领 —— 与 web passed 同判");
for (const c of CASES) {
  const e = evidenceOf(c);
  const scan = scanDir(dirOf(c));
  const status = scan ? deriveStatus(scan, null) : null;
  const o = runOutcome(e);
  eq(`${c.id} deliveredQuestionId`, deliveredQuestionId(e), c.delivered);
  // 同判：两个读者只允许差一个题号（报告不带题号，meta 写坏就认不出来）
  eq(`${c.id} web passed == deliverable`, status === "passed", o.deliverable);
  eq(
    `${c.id} 续跑跳过 == deliverable 且题号可知`,
    deliveredQuestionId(e) !== null,
    o.deliverable && e.meta?.questionId !== null && e.meta?.questionId !== undefined,
  );
}

console.log("\n[5] 读者 ④ rebuild-memory 三态 ⑤ run.ts 退出码");
for (const c of CASES) {
  const o = runOutcome(evidenceOf(c));
  // rebuild-memory 的映射（表示层在脚本里，这里断言它是全的且互斥）
  const verdict = o.phase === "failed" ? "FAILED" : o.deliverable ? "ALL PASS" : "UNVERIFIED";
  check(`${c.id} 三态互斥`, !(o.phase === "failed" && o.deliverable));
  eq(`${c.id} verdict`, verdict, c.phase === "failed" ? "FAILED" : c.deliverable ? "ALL PASS" : "UNVERIFIED");
  // run.ts：master 退 0 时才有资格谈成功，走没走到 proposal 正文由 outcome 说了算
  eq(`${c.id} reachedProposal`, reachedProposal(o), c.reached);
}

/* ------------------------------------------------------------------ */
/* 4. 与收编前的手写判据比对                                              */
/* ------------------------------------------------------------------ */

console.log("\n[6] 回归 —— 新判定 == 收编前六份手写判据");
for (const c of CASES) {
  if (c.legacy === "changed") {
    check(`${c.id} 有意分叉：旧 web 判 passed，旧续跑判要重跑（${c.note}）`, legacyStatus(c.files) === "passed" && legacyDelivered(c.files) === null);
    eq(`${c.id} 收敛后两边一致判「没交付」`, c.status, "completed");
    continue;
  }
  const scan = scanDir(dirOf(c));
  eq(`${c.id} 状态未变`, scan ? deriveStatus(scan, null) : null, legacyStatus(c.files));
  eq(`${c.id} 续跑认领未变`, deliveredQuestionId(evidenceOf(c)), legacyDelivered(c.files));
  const o = runOutcome(evidenceOf(c));
  if (c.id === "20200107-000000") {
    // 有意修正：收编前 run.ts 只看 proposal 有没有渲染，FAILED.md 与早轮 proposal 并存时
    // 会退 0 冒充成功；现在失败凭据压过一切，退 1。
    check(`${c.id} 有意修正：不再用早轮 proposal 冒充成功`, legacyRendered(c.files) && !reachedProposal(o));
  } else {
    eq(`${c.id} run.ts 退出码判定未变`, reachedProposal(o), legacyRendered(c.files));
  }
  const verdict = o.phase === "failed" ? "FAILED" : o.deliverable ? "ALL PASS" : "UNVERIFIED";
  // 题页只在题号已知时回填，所以只对那些 run 要求三字符串不变
  if (typeof legacyJson(c.files["meta.json"])?.questionId === "number") {
    eq(`${c.id} 题页 verdict 未变`, verdict, legacyVerdict(c.files));
  }
}

/**
 * terminal 是收编时唯一一处有意放宽：此前只认 verification-report.md 与 FAILED.md
 * 两个 marker，现在 proposal 正文 / 退出码 / 结束时间同样算终结凭据 —— 它们全都
 * 只可能在 master 退出之后落盘。放宽必须是单向的（旧判终态的新一定也判终态）。
 */
console.log("\n[7] terminal 的放宽是单向的");
for (const c of CASES) {
  const o = runOutcome(evidenceOf(c));
  check(`${c.id} 旧终态 ⇒ 新终态`, !legacyTerminal(c.files) || o.terminal);
}
const widened = CASES.filter((c) => runOutcome(evidenceOf(c)).terminal && !legacyTerminal(c.files));
check(
  "放宽真的命中了「跑完但还没验收」这一形态",
  widened.some((c) => c.id === "20200110-000000"),
  `实际命中 ${JSON.stringify(widened.map((c) => c.id))}`,
);

/* ------------------------------------------------------------------ */
/* 5. run id 三合一                                                     */
/* ------------------------------------------------------------------ */

console.log("\n[9] lib/runId —— 生成 / 校验 / 解析互为逆运算");
const now = new Date(Date.UTC(2026, 7, 8, 6, 28, 29));
eq("utcStamp 就是目录名的样子", utcStamp(now), "20260808-062829");
check("生成的 id 过校验", isRunId(utcStamp(now)));
eq("解析回同一时刻", stampToMs(utcStamp(now)), now.getTime());
eq("非法 id 解析成 null", stampToMs("batch-2026-08-08T0733"), null);
check("非法 id 过不了校验", !isRunId("20260808_062829") && !isRunId("index.json") && !isRunId(42));
check("同一个正则同时承担校验与解析", RUN_ID_RE.test("20260808-062829"));

/* ------------------------------------------------------------------ */
/* 6. 真实 runs/ 回归                                                    */
/* ------------------------------------------------------------------ */

const realIds = listRunIds();
console.log(`\n[10] 真实 runs/（${realIds.length} 个）—— 取证等价 + 状态未变`);
for (const id of realIds) {
  const scan = scanRun(id);
  if (!scan) continue;
  const fromScan = evidenceFromScan(scan);
  const fromDir = readRunEvidence(join(RUNS_DIR, id), id);
  check(`${id} 两条取证通路一致`, isDeepStrictEqual(fromScan, fromDir));
  const files: Files = {};
  for (const rel of scan.files.keys()) {
    if (rel.includes("/")) continue;
    files[rel] = readTextOr(join(RUNS_DIR, id, rel));
  }
  // activeId 传 null：旧判据看不到锁，比的就是「不算锁」的那一半
  eq(`${id} 状态未变`, deriveStatus(scan, null), legacyStatus(files));
  eq(`${id} 续跑认领未变`, deliveredQuestionId(fromDir), legacyDelivered(files));
}

/* ------------------------------------------------------------------ */
/* 7. 崩溃表五形态（docs/design/architecture.md「run 终态判定」）           */
/* ------------------------------------------------------------------ */

/**
 * 文档那张崩溃表的可执行版本。五个崩溃点取自 `scripts/run.ts` 的落盘顺序：
 * ① meta.json 写之前 ② invoke 尚未结束 ③ provisional exitCode 已落、报告未落
 * ④ ALL PASS 已落、finishedAt 未落 ⑤ 最终收尾之后。
 * 表里每一格（phase / terminal / 续跑认领）在这里各有一条断言 —— 文档改了这里会挂。
 */
console.log("\n[11] 崩溃表 —— 进程死在五个点上各是什么终态判定");
const caseById = (id: string) => CASES.find((c) => c.id === id)!;

for (const [point, id, expect] of [
  ["① meta.json 写之前（只有 question.md）", "20200108-000000", "unsettled"],
  ["② invoke 尚未结束（finishedAt/exitCode 皆 null）", "20200103-000000", "unsettled"],
  ["③ provisional exitCode 已落、报告未落", "20200111-000000", "rendered"],
  ["④ ALL PASS 已落、finishedAt 未落", "20200112-000000", "verified"],
  ["⑤ 最终收尾之后", "20200101-000000", "verified"],
] as const) {
  const c = caseById(id);
  const o = runOutcome(evidenceOf(c));
  eq(`崩溃点 ${point} → phase`, o.phase, expect);
  eq(
    `崩溃点 ${point} → terminal`,
    o.terminal,
    id !== "20200108-000000" && id !== "20200103-000000",
  );
  eq(
    `崩溃点 ${point} → 续跑认领（null = 这题要重跑）`,
    deliveredQuestionId(evidenceOf(c)),
    id === "20200112-000000" ? 15 : id === "20200101-000000" ? 7 : null,
  );
}
// ②的补注：终结判定不等 run.ts 收尾——proposal 正文或验收报告先落盘就已经 terminal
{
  const c = caseById("20200104-000000");
  const o = runOutcome(evidenceOf(c));
  check("崩溃点 ② 补注：报告先落盘 ⇒ 没有 meta 也算 terminal", o.terminal && c.files["meta.json"] === undefined);
  eq("崩溃点 ② 补注：但 proposal 正文没渲染出来就仍是 unsettled", o.phase, "unsettled");
}

/* ------------------------------------------------------------------ */
/* 8. 返工预算（lib/rework.ts）—— verdicts/ 目录即计数器                   */
/* ------------------------------------------------------------------ */

console.log("\n[12] reworkBudget —— 纯函数：轮数 / 熔断 / 格式重试 / 跨节点独立");

const facts = (...files: Array<[file: string, node: string, verdict: string]>): VerdictFact[] =>
  files.map(([file, node, verdict]) => verdictFact(file, { node, verdict }));

const budgetOf = (verdicts: VerdictFact[], drafts: string[] = []) => reworkBudget({ verdicts, drafts });

{
  const b = budgetOf([]);
  eq("没跑过：literature remaining=3", b.literature.remaining, 3);
  eq("没跑过：verdict=allow", b.literature.verdict, "allow");
  eq("四个节点都在表里（verify 不在，它没有返工一说）", Object.keys(b).length, 4);
}
{
  const b = budgetOf(facts(["literature-r1.json", "literature", "reject"]));
  eq("r1 落盘：semanticRounds=1", b.literature.semanticRounds, 1);
  eq("r1 落盘：remaining=2，仍 allow", b.literature.verdict === "allow" ? b.literature.remaining : -1, 2);
  eq("跨节点独立计数：hypothesis 余额未动", b.hypothesis.remaining, 3);
}
{
  const b = budgetOf(
    facts(
      ["literature-r1.json", "literature", "reject"],
      ["literature-r2.json", "literature", "reject"],
    ),
  );
  eq("r1..r2 全 reject：还剩 1 轮", b.literature.remaining, 1);
  eq("r1..r2 全 reject：尚未熔断", b.literature.verdict, "allow");
}
{
  const b = budgetOf(
    facts(
      ["literature-r1.json", "literature", "reject"],
      ["literature-r2.json", "literature", "reject"],
      ["literature-r3.json", "literature", "reject"],
    ),
  );
  eq("连续 3 次 reject → exhausted", b.literature.verdict, "exhausted");
  eq(
    "管事的是熔断器而不是轮数（governingCap 必须说清）",
    b.literature.verdict === "exhausted" ? b.literature.governingCap : null,
    "node.circuitBreaker",
  );
  eq("熔断时 remaining=0", b.literature.remaining, 0);
}
{
  const b = budgetOf(
    facts(
      ["critique-r1.json", "critique", "reject"],
      ["critique-r2.json", "critique", "reject"],
      ["critique-r3.json", "critique", "pass"],
    ),
  );
  eq("3 轮用满但末轮 pass → 仍 exhausted", b.critique.verdict, "exhausted");
  eq(
    "此时管事的是轮数上限（不是熔断器）",
    b.critique.verdict === "exhausted" ? b.critique.governingCap : null,
    "node.maxRounds",
  );
  eq("末轮 pass ⇒ consecutiveRejects 归零", b.critique.consecutiveRejects, 0);
}
{
  const b = budgetOf(facts(["proposal-r1.json", "proposal", "reject"]), [
    "proposal-r1.json.rejected.json",
    "proposal-r2.json.rejected.json",
  ]);
  eq("格式重试计数独立：formatRetries=2", b.proposal.formatRetries, 2);
  eq("**格式重试不占语义轮**：semanticRounds 仍是 1", b.proposal.semanticRounds, 1);
  eq("格式重试不吃余额：remaining 仍是 2", b.proposal.remaining, 2);
  eq("格式重试再多也不熔断", b.proposal.verdict, "allow");
}
{
  const e = { verdicts: facts(["literature-r1.json", "literature", "reject"]), drafts: [] };
  const fourth = admitVerdict(e, { node: "literature", file: "literature-r4.json" });
  eq("轮号 r4 就算文件数没到 3 也拒（挡改名绕行）", fourth.ok, false);
  eq(
    "拒写带 governingCap",
    fourth.ok ? null : fourth.governingCap,
    "node.maxRounds",
  );
  const rewrite = admitVerdict(e, { node: "literature", file: "literature-r1.json" });
  eq("覆写已落盘的同一轮 → 放行（容忍瞬时失败重放）", rewrite.ok, true);
  eq("且不新增轮次", rewrite.ok ? rewrite.reason : null, "same-round-rewrite");
}

/* ------------------------------------------------------------------ */
/* 9. 执行点：artifact_write 真的拒写第 4 轮                              */
/* ------------------------------------------------------------------ */

console.log("\n[13] artifact_write —— 预算的执行点（fail-closed：模型数错也过不去）");
const budgetRun = join(root, "budget-run");
mkdirSync(budgetRun, { recursive: true });

const verdictJson = (node: string, verdict: "pass" | "reject") =>
  JSON.stringify({
    node,
    verdict,
    checks: [{ criterion: "B1", pass: verdict === "pass", reason: "自测用" }],
    ...(verdict === "reject" ? { rework: "补齐证据后重来" } : {}),
  });

const writeVerdict = (node: string, round: number, verdict: "pass" | "reject" = "reject") =>
  writeArtifact(`verdicts/${node}-r${round}.json`, verdictJson(node, verdict), budgetRun);

for (const round of [1, 2, 3]) {
  const r = writeVerdict("literature", round);
  eq(`literature-r${round} 落盘`, r.ok, true);
  eq(`literature-r${round} 返回余额 remaining=${3 - round}`, r.budget?.remaining, 3 - round);
}
{
  const r4 = writeVerdict("literature", 4);
  eq("第 4 轮被拒写", r4.ok, false);
  eq("拒写理由是预算而不是 schema（deniedBy 显式）", r4.deniedBy, "node.circuitBreaker");
  check("拒写不落文件", !existsSync(join(budgetRun, "verdicts", "literature-r4.json")));
  check("拒写也不留 .rejected.json 草稿（草稿会被算成格式重试）", !existsSync(join(budgetRun, "verdicts", "literature-r4.json.rejected.json")));
  check("拒写的理由里带得走的下一步：写 FAILED.md", (r4.issues[0] ?? "").includes("FAILED.md"), r4.issues[0]);
}
{
  // 格式重试走的是另一本账：schema 打回留草稿，语义轮一分不扣
  const bad = writeArtifact("verdicts/hypothesis-r1.json", '{"node":"hypothesis"}', budgetRun);
  eq("schema 不合格 → 拒写", bad.ok, false);
  eq("这类拒写不是预算拒写（deniedBy 不设）", bad.deniedBy, undefined);
  check("草稿留存", existsSync(join(budgetRun, "verdicts", "hypothesis-r1.json.rejected.json")));
  const good = writeVerdict("hypothesis", 1);
  eq("改对之后照样能落 r1", good.ok, true);
  eq("格式重试没吃掉语义轮：remaining 仍是 2", good.budget?.remaining, 2);
  eq("但格式重试记在账上：formatRetries=1", good.budget?.formatRetries, 1);
}
{
  // literature 已经熔断，别的节点不受牵连
  const c = writeVerdict("critique", 1, "pass");
  eq("跨节点独立：critique 照常落盘", c.ok, true);
  eq("critique 余额未被 literature 的熔断牵连", c.budget?.remaining, 2);
}

/* ------------------------------------------------------------------ */

rmSync(root, { recursive: true, force: true });

report("selftest-outcome");
