import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import {
  compactIds,
  parseIds,
  readSourceIdentity,
  remainingPath,
  runBatch,
  type BatchOptions,
  type BatchReport,
  type QuestionOutcome,
  type RunQuestion,
} from "../src/batch/runner.ts";
import { findQuestion, readScience125, science125Text } from "../src/domain/science125.ts";
import { SqliteStore } from "../src/store/store.ts";

function workspace(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), "luup-batch-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** 一个不花钱的批次：内存库、临时仓根、毫秒级期限。 */
function batch(
  t: TestContext,
  ids: number[],
  runQuestion: RunQuestion,
  overrides: Partial<BatchOptions> = {},
): { store: SqliteStore; repoRoot: string; report: Promise<BatchReport> } {
  const store = overrides.store ?? new SqliteStore(":memory:");
  const repoRoot = overrides.repoRoot ?? workspace(t);
  t.after(() => store.close());
  return {
    store,
    repoRoot,
    report: runBatch(ids, {
      timeoutMs: 200,
      graceMs: 50,
      log: () => {},
      ...overrides,
      store,
      runQuestion,
      repoRoot,
    }),
  };
}

const passes: RunQuestion = () => Promise.resolve({ status: "completed" as const, errorCode: null });

const classes = (outcomes: QuestionOutcome[]) =>
  outcomes.map((item) => `${item.status}/${item.classification ?? "-"}`);

test("--ids accepts a single id, a list, a range, and any mixture", () => {
  assert.deepEqual(parseIds("61"), [61]);
  assert.deepEqual(parseIds("3,54,61"), [3, 54, 61]);
  assert.equal(parseIds("1-125").length, 125);
  // 去重升序：混写里重复的题号只跑一次，顺序与写法无关。
  assert.deepEqual(parseIds("10, 1-3 ,2,10"), [1, 2, 3, 10]);
});

test("--ids rejects malformed input before any money is spent", () => {
  for (const spec of ["", " , ", "abc", "1-", "-3", "1..3", "1-2-3", "5-1"]) {
    assert.throws(() => parseIds(spec), /题号|--ids/, `expected ${JSON.stringify(spec)} to be rejected`);
  }
});

test("remaining ids compact back into a pasteable --ids", () => {
  assert.equal(compactIds([1, 2, 3, 10]), "1-3,10");
  // 两个连号不值一个区间：`1,2` 并不比 `1-2` 长。
  assert.equal(compactIds([1, 2, 10, 11]), "1,2,10,11");
  assert.equal(compactIds([]), "");
  assert.equal(compactIds([8, 8, 9, 10, 11]), "8-11");
});

test("the question bank reads back as 125 questions across 12 domains", () => {
  const bank = readScience125();
  assert.ok(bank);
  assert.equal(bank.total, 125);
  assert.equal(bank.domains.length, 12);
  assert.equal(bank.domains.reduce((sum, item) => sum + item.count, 0), 125);
  assert.equal(findQuestion(1)?.domain, "Mathematical Sciences");
  assert.equal(findQuestion(126), null);
  // 题面文本带题号与领域，问题本身逐字保留。
  const text = science125Text(findQuestion(1)!);
  assert.match(text, /第 1 题，Mathematical Sciences/);
  assert.ok(text.includes(findQuestion(1)!.question));
});

test("an unreadable question bank is null rather than an exception", (t) => {
  const dir = workspace(t);
  assert.equal(readScience125(join(dir, "absent.json")), null);
  assert.equal(findQuestion(1, join(dir, "absent.json")), null);
  const broken = join(dir, "broken.json");
  writeFileSync(broken, "{ not json");
  assert.equal(readScience125(broken), null);
});

test("a question that already has a completed run is never paid for twice", async (t) => {
  const store = new SqliteStore(":memory:");
  const settled = store.createRun("旧的一次交付", { science125Id: 7 });
  store.finishRun(settled, "completed");

  const asked: number[] = [];
  const { report } = batch(t, [7, 8], (job) => {
    asked.push(job.questionId);
    return passes(job);
  }, { store });
  const { outcomes } = await report;

  assert.deepEqual(asked, [8], "已交付的题不该再发起执行");
  assert.deepEqual(classes(outcomes), ["skipped/-", "passed/-"]);
  assert.match(outcomes[0]!.detail, new RegExp(settled));
});

test("a rejected review is owed, not skipped", async (t) => {
  const store = new SqliteStore(":memory:");
  const rejected = store.createRun("上次被拒", { science125Id: 7 });
  store.finishRun(rejected, "review_rejected", { errorCode: "review_rejected" });

  const { report } = batch(t, [7], passes, { store });
  assert.deepEqual(classes((await report).outcomes), ["passed/-"]);
});

test("every run records its question id and its source identity", async (t) => {
  const { store, report } = batch(t, [3], passes);
  const runId = (await report).outcomes[0]!.runId!;

  assert.equal(store.snapshot(runId)!.science125_id, 3);
  // repoRoot 是个不带 git 的临时目录：采不到出身就写 null，绝不编一个。
  assert.equal(store.sourceIdentity(runId), null);
  assert.match(store.question(runId), /第 3 题/);
});

test("source identity is this repo's commit, and null where git cannot answer", (t) => {
  assert.equal(readSourceIdentity(workspace(t)), null);
  const identity = readSourceIdentity(process.cwd());
  assert.ok(identity, "仓库自身应当能采到出身");
  assert.match(identity.gitCommit, /^[0-9a-f]{40}$/);
  assert.equal(typeof identity.treeDirty, "boolean");
});

test("one question's outage does not stop the batch", async (t) => {
  const { report } = batch(t, [1, 2, 3], (job) => {
    if (job.questionId === 2) throw new Error("provider exploded");
    return passes(job);
  });
  const { outcomes, stopped } = await report;

  assert.equal(stopped, null);
  assert.deepEqual(classes(outcomes), ["passed/-", "error/infra_error", "passed/-"]);
  assert.match(outcomes[1]!.detail, /provider exploded/);
});

test("five failures of the same class stop the batch and write what is owed", async (t) => {
  const { repoRoot, report } = batch(
    t,
    [1, 2, 3, 4, 5, 6, 7],
    () => Promise.resolve({ status: "failed" as const, errorCode: "invalid_output" }),
  );
  const { outcomes, stopped } = await report;

  assert.equal(outcomes.length, 5, "第五次同类失败之后不再花第六次钱");
  assert.ok(stopped);
  assert.equal(stopped.remaining, "6,7");
  assert.deepEqual(stopped.remainingIds, [6, 7]);
  assert.deepEqual(stopped.failedByClass, { invalid_output: 5 });
  assert.match(stopped.stoppedAt, /^\d{4}-\d{2}-\d{2}T/);

  const owed = JSON.parse(readFileSync(remainingPath(repoRoot), "utf8"));
  assert.deepEqual(owed, JSON.parse(JSON.stringify(stopped)));
});

test("a same-class streak is broken by a passing question", async (t) => {
  const { report } = batch(
    t,
    [1, 2, 3, 4, 5, 6, 7, 8],
    ({ questionId }) => Promise.resolve(
      questionId === 3
        ? { status: "completed" as const, errorCode: null }
        : { status: "failed" as const, errorCode: "invalid_output" },
    ),
  );
  const { outcomes, stopped } = await report;

  // 1,2 失败 → 3 通过清零 → 4..8 才凑满五次。
  assert.equal(outcomes.length, 8);
  assert.ok(stopped);
  assert.equal(stopped.remaining, "");
  assert.deepEqual(stopped.failedByClass, { invalid_output: 7 });
});

test("two outages in a row stop the batch immediately", async (t) => {
  const { report } = batch(t, [1, 2, 3, 4, 5], () => {
    throw new Error("ECONNREFUSED");
  });
  const { outcomes, stopped } = await report;

  assert.equal(outcomes.length, 2, "环境故障连续两次就该停");
  assert.ok(stopped);
  assert.match(stopped.reason, /infra_error/);
  assert.equal(stopped.remaining, "3-5");
  assert.deepEqual(stopped.failedByClass, { infra_error: 2 });
});

test("a finished batch owes nothing and clears a stale remaining file", async (t) => {
  const repoRoot = workspace(t);
  mkdirSync(join(repoRoot, "outputs"), { recursive: true });
  writeFileSync(remainingPath(repoRoot), '{"remaining":"1-125"}\n');

  // dry-run 一道题都没跑，无权注销上一批留下的欠账。
  await batch(t, [1], passes, { repoRoot, dryRun: true }).report;
  assert.equal(existsSync(remainingPath(repoRoot)), true);

  const { report } = batch(t, [1], passes, { repoRoot });
  await report;
  assert.equal(existsSync(remainingPath(repoRoot)), false);
});

test("a hung question is cancelled, recorded as infra_timeout, and left with a terminal run", async (t) => {
  let aborted = false;
  const { store, report } = batch(t, [1, 2], ({ signal }) => new Promise(() => {
    // 永不 settle：Python 侧那道「取消也没落地」的病理情况。
    signal.addEventListener("abort", () => { aborted = true; });
  }), { timeoutMs: 30, graceMs: 20 });
  const { outcomes, stopped } = await report;

  assert.equal(aborted, true);
  assert.equal(outcomes.length, 2, "超时属于环境故障，连续两次停批");
  assert.deepEqual(classes(outcomes), ["failed/infra_timeout", "failed/infra_timeout"]);
  assert.match(outcomes[0]!.detail, /已取消/);
  assert.match(outcomes[0]!.detail, /宽限期/);
  assert.ok(stopped);

  const snapshot = store.snapshot(outcomes[0]!.runId!)!;
  assert.equal(snapshot.status, "failed");
  assert.equal(snapshot.error_code, "infra_timeout");
  assert.ok(snapshot.recent_events.some((event: Record<string, any>) =>
    event.kind === "run.failed" && event.payload.failure_code === "infra_timeout"));
});

test("a timed-out question that settled itself keeps its own verdict", async (t) => {
  const store = new SqliteStore(":memory:");
  const { report } = batch(t, [1], ({ runId }) => new Promise(() => {
    // 取消赶上了它自己收尾：那份终态是它的事实，批跑不得改写（merge 不 rewrite）。
    store.finishRun(runId, "completed");
  }), { store, timeoutMs: 30, graceMs: 20 });
  const { outcomes } = await report;

  assert.equal(outcomes[0]!.status, "failed", "批跑仍然认为这题没在期限内交付");
  assert.equal(store.snapshot(outcomes[0]!.runId!)!.status, "completed");
  assert.equal(store.completedRunForQuestion(1), outcomes[0]!.runId);
});

test("an unknown question id is reported, not run", async (t) => {
  const executed: number[] = [];
  const { report } = batch(t, [126], (job) => {
    executed.push(job.questionId);
    return passes(job);
  });
  const { outcomes } = await report;

  assert.deepEqual(executed, []);
  assert.deepEqual(classes(outcomes), ["missing/-"]);
  assert.equal(outcomes[0]!.runId, null);
});

test("--dry-run plans without creating a single run", async (t) => {
  const { report } = batch(t, [1, 2], () => {
    throw new Error("dry-run 不该发起执行");
  }, { dryRun: true });
  const { outcomes } = await report;

  assert.deepEqual(classes(outcomes), ["planned/-", "planned/-"]);
  assert.deepEqual(outcomes.map((item) => item.runId), [null, null]);
  assert.ok(outcomes[0]!.detail.length > 0);
});

test("progress is one line per question plus a tally", async (t) => {
  const lines: string[] = [];
  const { report } = batch(t, [1, 2], passes, { log: (line) => lines.push(line) });
  await report;

  assert.equal(lines.length, 3);
  assert.match(lines[0]!, /^\[batch] 1\/2 q1 \| passed \| \d+\.\ds$/);
  assert.match(lines[2]!, /^\[batch] 合计 2 题：passed 2$/);
});
