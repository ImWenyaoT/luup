/**
 * run outcome 自测（零 API，零网络）。
 *
 *   node scripts/selftest-outcome.ts
 *
 * 终态判定收敛成一个 owner（lib/runOutcome.ts）之后，这里守住三件事：
 *
 * 1. **两个证据构造器等价**：`readRunEvidence(dir)`（脚本侧）与 `evidenceFromScan(scan)`
 *    （web 侧）对同一个目录必须给出逐字段相同的证据。两条取证通路是这次收敛的唯一分叉点。
 * 2. **六个读者与判定一致**：web 五态、runs 索引的定型集合、run-batch 续跑认领、
 *    retention 的终态、rebuild-memory 的三字符串、run.ts 的退出码。
 *    重点是**续跑判据与 web `passed` 对同一目录必须同判**（只差一个题号）。
 * 3. **没有回归**：把收编前那六份手写判据作为 oracle 写在下面（`legacy*` 函数），
 *    对每个形态断言新判定与它一致 —— 一致性有意的例外单独标注 `legacy: "changed"`。
 *
 * 形态取自真实 runs/：终态成功、如实 FAILED、中断无 finishedAt、只有报告没有 meta
 * （手工验收过的 eval run）、meta 写坏、渲染了但验收没过、FAILED 与 proposal 并存。
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { RUNS_DIR } from "../lib/paths.ts";
import { SETTLED_STATUSES, deriveStatus, evidenceFromScan, scanDir, scanRun } from "../lib/phase.ts";
import { planPrune } from "../lib/retention.ts";
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
/* 断言                                                                 */
/* ------------------------------------------------------------------ */

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed += 1;
    console.log(`  ✔ ${name}`);
  } else {
    failed += 1;
    console.error(`  ✘ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function eq<T>(name: string, actual: T, expected: T): void {
  check(name, Object.is(actual, expected), `期望 ${String(expected)}，实际 ${String(actual)}`);
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

/** 旧 lib/retention.ts TERMINAL_RUN_MARKERS。 */
const legacyTerminal = (f: Files) =>
  f["verification-report.md"] !== undefined || f["FAILED.md"] !== undefined;

/** 旧 scripts/rebuild-memory.ts 的三字符串。 */
const legacyVerdict = (f: Files) =>
  f["FAILED.md"] !== undefined ? "FAILED" : legacyAllPass(f["verification-report.md"] ?? null) ? "ALL PASS" : "UNVERIFIED";

/** 旧 lib/runsIndex.ts SETTLED。 */
const LEGACY_SETTLED = new Set<RunStatus>(["passed", "failed", "completed"]);

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
];

const root = mkdtempSync(join(tmpdir(), "luup-outcome-"));
const runsDir = join(root, "runs");
for (const c of CASES) {
  const dir = join(runsDir, c.id);
  mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(c.files)) writeFileSync(join(dir, name), body, "utf8");
  // workflow 直连键：retention 靠它把流映射回 run，不必依赖时间窗
  writeFileSync(
    join(dir, "invoke-result.json"),
    `${JSON.stringify({ resume: { session: { sessionId: `wrun_${c.id}` } } })}\n`,
    "utf8",
  );
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

console.log("\n[3] 读者 ① web 五态 ② runs 索引定型集合");
for (const c of CASES) {
  const scan = scanDir(dirOf(c));
  const status = scan ? deriveStatus(scan) : null;
  eq(`${c.id} deriveStatus`, status, c.status);
  eq(
    `${c.id} 定型集合与 phase 同步`,
    status !== null && SETTLED_STATUSES.has(status),
    c.phase !== "unsettled",
  );
}
check(
  "定型集合就是收编前手写的那三个状态",
  isDeepStrictEqual(new Set(SETTLED_STATUSES), LEGACY_SETTLED),
  `实际 ${JSON.stringify([...SETTLED_STATUSES])}`,
);

console.log("\n[4] 读者 ③ run-batch 续跑认领 —— 与 web passed 同判");
for (const c of CASES) {
  const e = evidenceOf(c);
  const scan = scanDir(dirOf(c));
  const status = scan ? deriveStatus(scan) : null;
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

console.log("\n[5] 读者 ④ retention 终态 —— 能不能删这个 run 的重放数据");
const stateDir = join(root, "state");
const chunksDir = join(stateDir, "streams", "chunks");
mkdirSync(chunksDir, { recursive: true });
for (const c of CASES) {
  const wrun = `wrun_${c.id}`;
  const wf = join(stateDir, "runs");
  mkdirSync(wf, { recursive: true });
  writeFileSync(
    join(wf, `${wrun}.json`),
    meta({ runId: wrun, status: "completed", startedAt: iso(NOW - 4 * HOUR), completedAt: iso(NOW - 3 * HOUR) }),
    "utf8",
  );
  const owners = join(stateDir, "streams", "runs");
  mkdirSync(owners, { recursive: true });
  writeFileSync(join(owners, `${wrun}.json`), meta({ streams: [`strm_${c.id}`] }), "utf8");
  const sd = join(chunksDir, `strm_${c.id}`);
  mkdirSync(sd, { recursive: true });
  const f = join(sd, "chnk_0.bin");
  writeFileSync(f, "x".repeat(64), "utf8");
  utimesSync(f, new Date(NOW - 3.5 * HOUR), new Date(NOW - 3.5 * HOUR));
  utimesSync(sd, new Date(NOW - 3.5 * HOUR), new Date(NOW - 3.5 * HOUR));
}
const plan = planPrune({ stateDir, runsDir, graceMs: HOUR, apply: false, now: NOW });
for (const c of CASES) {
  const p = plan.plans.find((x) => x.id === `strm_${c.id}`);
  eq(`${c.id} 流的去留跟着 terminal 走`, p?.decision, c.terminal ? "delete" : "keep");
  if (!c.terminal) eq(`${c.id} 保留理由 = run-not-terminal`, p?.reason, "run-not-terminal");
}

console.log("\n[6] 读者 ⑤ rebuild-memory 三态 ⑥ run.ts 退出码");
for (const c of CASES) {
  const o = runOutcome(evidenceOf(c));
  // rebuild-memory 的映射（表示层在脚本里，这里断言它是全的且互斥）
  const verdict = o.phase === "failed" ? "FAILED" : o.deliverable ? "ALL PASS" : "UNVERIFIED";
  check(`${c.id} 三态互斥`, !(o.phase === "failed" && o.deliverable));
  eq(`${c.id} verdict`, verdict, c.phase === "failed" ? "FAILED" : c.deliverable ? "ALL PASS" : "UNVERIFIED");
  // run.ts：eve 退 0 时才有资格谈成功，走没走到 proposal 正文由 outcome 说了算
  eq(`${c.id} reachedProposal`, reachedProposal(o), c.reached);
}

/* ------------------------------------------------------------------ */
/* 4. 与收编前的手写判据比对                                              */
/* ------------------------------------------------------------------ */

console.log("\n[7] 回归 —— 新判定 == 收编前六份手写判据");
for (const c of CASES) {
  if (c.legacy === "changed") {
    check(`${c.id} 有意分叉：旧 web 判 passed，旧续跑判要重跑（${c.note}）`, legacyStatus(c.files) === "passed" && legacyDelivered(c.files) === null);
    eq(`${c.id} 收敛后两边一致判「没交付」`, c.status, "completed");
    continue;
  }
  const scan = scanDir(dirOf(c));
  eq(`${c.id} 状态未变`, scan ? deriveStatus(scan) : null, legacyStatus(c.files));
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
 * terminal 是这次唯一一处有意放宽：收编前 retention 只认 verification-report.md 与
 * FAILED.md 两个 marker，现在 proposal 正文 / 退出码 / 结束时间同样算终结凭据 ——
 * 它们全都只可能在 eve 退出之后落盘。放宽必须是单向的（旧判终态的新一定也判终态），
 * 否则 retention 会开始留住本该清掉的重放数据。
 */
console.log("\n[8] terminal 的放宽是单向的");
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
  const status = deriveStatus(scan);
  // 锁只有 web API 走：真有 run 在跑时它判 running，旧判据看不到锁，这一条不比
  if (status !== "running") eq(`${id} 状态未变`, status, legacyStatus(files));
  eq(`${id} 续跑认领未变`, deliveredQuestionId(fromDir), legacyDelivered(files));
}

/* ------------------------------------------------------------------ */

rmSync(root, { recursive: true, force: true });

console.log(`\n[selftest-outcome] ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
