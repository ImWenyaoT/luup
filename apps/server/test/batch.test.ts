import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onTestFinished, test } from "bun:test";
import type { DomainArtifact } from "../src/agent/contracts.ts";

type TestContext = { onTestFinished: typeof onTestFinished };

import {
  compactIds,
  createCampaignMemory,
  MAX_CONCURRENCY,
  parseConcurrency,
  parseIds,
  validateBatchBunRuntime,
  remainingPath,
  runBatch,
  main,
  type BatchOptions,
  type BatchReport,
  type QuestionOutcome,
  type RunQuestion,
} from "../src/batch/runner.ts";
import { readSourceIdentity } from "../src/batch/admission.ts";
import { findQuestion, readScience125, science125Integrity, science125Text } from "../src/domain/science125.ts";
import { clearModelOverride, modelConfigStatus } from "../src/seams/model.ts";
import { SqliteStore } from "../src/store/store.ts";
function workspace(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), "luup-batch-"));
  t.onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
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
  t.onTestFinished(() => store.close());
  return {
    store,
    repoRoot,
    report: runBatch(ids, {
      timeoutMs: 200,
      graceMs: 50,
      log: () => {},
      ...overrides,
      store,
      runQuestion: durableRunQuestion(store, runQuestion),
      repoRoot,
    }),
  };
}

const passes: RunQuestion = () => Promise.resolve({ status: "completed" as const, errorCode: null });

function completeStoredRun(store: SqliteStore, runId: string): string {
  const attemptId = store.startAttempt(runId, "research-plan");
  const final = store.publishArtifact(
    runId,
    attemptId,
    { artifact_type: "research-plan" } as unknown as DomainArtifact,
    [],
    0,
  );
  store.finishRun(runId, "completed", { finalArtifactId: final.id });
  return final.id;
}

/** The production RunQuestion contract settles its Run; test executors do the same here. */
function durableRunQuestion(store: SqliteStore, runQuestion: RunQuestion): RunQuestion {
  return async (job) => {
    const result = await runQuestion(job);
    if (store.batchRunFacts(job.runId)?.status !== "running") return result;
    if (result.status === "completed") {
      completeStoredRun(store, job.runId);
    } else if (result.status === "review_rejected") {
      store.finishRun(job.runId, "review_rejected", { errorCode: result.errorCode ?? "review_rejected" });
    } else {
      store.finishRun(job.runId, "failed", { errorCode: result.errorCode ?? "batch_error" });
    }
    return result;
  };
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/** 等一个可观测的条件成立。并发用例靠它对齐时序，不靠猜多少个微任务够用。 */
async function until(ready: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!ready()) {
    if (Date.now() > deadline) throw new Error("等待的条件在期限内没有成立");
    await sleep(1);
  }
}

const classes = (outcomes: QuestionOutcome[]) => outcomes.map((item) => `${item.status}/${item.classification ?? "-"}`);

function gitCommand(repoRoot: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd: repoRoot, encoding: "utf8" });
  assert.equal(result.status, 0, result.error?.message ?? result.stderr);
  return result.stdout.trim();
}

function createCleanGitWorkspace(t: TestContext): { repoRoot: string; trackedPath: string; commit: string } {
  const repoRoot = workspace(t);
  const trackedPath = join(repoRoot, "tracked.txt");
  writeFileSync(trackedPath, "initial\n");
  gitCommand(repoRoot, ["init", "-q"]);
  gitCommand(repoRoot, ["config", "user.email", "luup-tests@example.com"]);
  gitCommand(repoRoot, ["config", "user.name", "Luup Tests"]);
  gitCommand(repoRoot, ["add", "tracked.txt"]);
  gitCommand(repoRoot, ["commit", "-qm", "initial"]);
  return { repoRoot, trackedPath, commit: gitCommand(repoRoot, ["rev-parse", "HEAD"]) };
}

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
  assert.equal(
    bank.domains.reduce((sum, item) => sum + item.count, 0),
    125,
  );
  assert.equal(findQuestion(1)?.domain, "Mathematical Sciences");
  assert.equal(findQuestion(126), null);
  // 题面文本带题号与领域，问题本身逐字保留。
  const text = science125Text(findQuestion(1)!);
  assert.match(text, /第 1 题，Mathematical Sciences/);
  assert.ok(text.includes(findQuestion(1)!.question));
});

test("an unreadable question bank is null rather than an exception", () => {
  const t = { onTestFinished };
  const dir = workspace(t);
  assert.equal(readScience125(join(dir, "absent.json")), null);
  assert.equal(findQuestion(1, join(dir, "absent.json")), null);
  const broken = join(dir, "broken.json");
  writeFileSync(broken, "{ not json");
  assert.equal(readScience125(broken), null);
});

test("the formal bank integrity gate rejects malformed and duplicate rows", () => {
  const t = { onTestFinished };
  const dir = workspace(t);
  const path = join(dir, "corrupt-science125.json");
  const questions = Array.from({ length: 125 }, (_, index) => ({
    id: index === 124 ? 1 : index + 1,
    domain: "test",
    question: index === 20 ? "" : `q${index + 1}`,
  }));
  writeFileSync(path, JSON.stringify({ questions }));

  const integrity = science125Integrity(path);
  assert.equal(integrity.ok, false);
  assert.equal(integrity.rawCount, 125);
  assert.equal(integrity.validCount, 124);
  assert.deepEqual(integrity.duplicateIds, [1]);
  assert.deepEqual(integrity.missingIds, [21, 125]);
});

test("runBatch rejects duplicate ids before creating a manifest or spending", async () => {
  const store = new SqliteStore(":memory:");
  let calls = 0;
  await assert.rejects(
    runBatch([1, 1], {
      store,
      runQuestion: async () => {
        calls += 1;
        return { status: "completed", errorCode: null };
      },
      log: () => {},
    }),
    /题号重复.*重复付费/,
  );
  assert.equal(calls, 0);
  store.close();
});

test("a question that already has a completed run is never paid for twice", async () => {
  const t = { onTestFinished };
  const store = new SqliteStore(":memory:");
  const settled = store.createRun("旧的一次交付", { science125Id: 7 });
  completeStoredRun(store, settled);

  const asked: number[] = [];
  const { report } = batch(
    t,
    [7, 8],
    (job) => {
      asked.push(job.questionId);
      return passes(job);
    },
    { store },
  );
  const { outcomes } = await report;

  assert.deepEqual(asked, [8], "已交付的题不该再发起执行");
  assert.deepEqual(classes(outcomes), ["skipped/-", "passed/-"]);
  assert.match(outcomes[0]!.detail, new RegExp(settled));
});

test("a completed skip is scoped to the memory arm in both directions", async () => {
  for (const [firstArm, secondArm] of [
    ["on", "off"],
    ["off", "on"],
  ] as const) {
    const t = { onTestFinished };
    const store = new SqliteStore(":memory:");
    const asked: string[] = [];
    const first = await batch(
      t,
      [1],
      () => {
        asked.push(firstArm);
        return Promise.resolve({ status: "completed" as const, errorCode: null });
      },
      { store, memoryArm: firstArm },
    ).report;
    const firstRunId = first.outcomes[0]!.runId!;

    assert.equal(store.completedRunForQuestionInArm(1, firstArm), firstRunId);
    assert.equal(store.completedRunForQuestionInArm(1, secondArm), null);

    const second = await batch(
      t,
      [1],
      () => {
        asked.push(secondArm);
        return Promise.resolve({ status: "completed" as const, errorCode: null });
      },
      { store, memoryArm: secondArm },
    ).report;
    const secondRunId = second.outcomes[0]!.runId!;

    assert.deepEqual(asked, [firstArm, secondArm]);
    assert.notEqual(firstRunId, secondRunId);
    assert.equal(store.snapshot(firstRunId)!.memory_arm, firstArm);
    assert.equal(store.snapshot(secondRunId)!.memory_arm, secondArm);
  }
});

test("a rejected review is owed, not skipped", async () => {
  const t = { onTestFinished };
  const store = new SqliteStore(":memory:");
  const rejected = store.createRun("上次被拒", { science125Id: 7 });
  store.finishRun(rejected, "review_rejected", { errorCode: "review_rejected" });

  const { report } = batch(t, [7], passes, { store });
  assert.deepEqual(classes((await report).outcomes), ["passed/-"]);
});

test("every run records its question id and its source identity", async () => {
  const t = { onTestFinished };
  const { store, report } = batch(t, [3], passes);
  const runId = (await report).outcomes[0]!.runId!;

  assert.equal(store.snapshot(runId)!.science125_id, 3);
  // repoRoot 是个不带 git 的临时目录：采不到出身就写 null，绝不编一个。
  assert.equal(store.snapshot(runId)!.source_identity_json, null);
  assert.match(store.question(runId), /第 3 题/);
});

test("a batch stamps its ablation arm and nothing else does", async () => {
  const t = { onTestFinished };
  const store = new SqliteStore(":memory:");
  const single = store.createRun("HTTP 单跑", { science125Id: 9 });

  const { report } = batch(t, [3], passes, { store, memoryArm: "off" });
  const runId = (await report).outcomes[0]!.runId!;

  assert.equal(store.snapshot(runId)!.memory_arm, "off");
  // 单跑（HTTP / canary）不属于任何一臂：标成 on 会往配对里掺没有对照的样本。
  assert.equal(store.snapshot(single)!.memory_arm, null);
});

test("the campaign locator is repo-relative so it outlives this checkout", () => {
  const t = { onTestFinished };
  const repoRoot = workspace(t);
  const memory = createCampaignMemory(repoRoot, join(repoRoot, "outputs/runtime/runs.db"));
  mkdirSync(join(repoRoot, "memory"), { recursive: true });

  memory.recordRun({
    runId: "abc",
    questionId: 3,
    status: "completed",
    failureCode: null,
    title: "标题",
    references: [],
  });

  const log = readFileSync(join(repoRoot, "memory", "log.md"), "utf8");
  assert.match(log, /- outputs\/runtime\/runs\.db#abc｜标题/);
  assert.equal(log.includes(repoRoot), false, "绝对路径活不过一次 clone");
});

test("source identity is this repo's commit, and null where git cannot answer", () => {
  const t = { onTestFinished };
  assert.equal(readSourceIdentity(workspace(t)), null);
  const identity = readSourceIdentity(process.cwd());
  assert.ok(identity, "仓库自身应当能采到出身");
  assert.match(identity.gitCommit, /^[0-9a-f]{40}$/);
  assert.equal(typeof identity.treeDirty, "boolean");
});

test("source identity ignores tracked memory evidence but catches source edits", () => {
  const t = { onTestFinished };
  const { repoRoot } = createCleanGitWorkspace(t);
  const memoryPath = join(repoRoot, "memory", "questions", "q1.md");
  const sourcePath = join(repoRoot, "apps", "server", "src", "placeholder.ts");
  mkdirSync(join(repoRoot, "memory", "questions"), { recursive: true });
  mkdirSync(join(repoRoot, "apps", "server", "src"), { recursive: true });
  writeFileSync(memoryPath, "initial evidence\n");
  writeFileSync(sourcePath, "export const value = 1;\n");
  gitCommand(repoRoot, ["add", "memory", "apps"]);
  gitCommand(repoRoot, ["commit", "-qm", "add runtime evidence and source"]);
  const commit = gitCommand(repoRoot, ["rev-parse", "HEAD"]);

  writeFileSync(memoryPath, "appended evidence\n");
  assert.deepEqual(readSourceIdentity(repoRoot), { gitCommit: commit, treeDirty: false });

  writeFileSync(sourcePath, "export const value = 2;\n");
  assert.deepEqual(readSourceIdentity(repoRoot), { gitCommit: commit, treeDirty: true });
});

test("one batch freezes source identity before a tracked campaign write", async () => {
  const t = { onTestFinished };
  const { repoRoot, trackedPath, commit } = createCleanGitWorkspace(t);
  const store = new SqliteStore(":memory:");
  const { report } = batch(
    t,
    [1, 2],
    ({ questionId }) => {
      if (questionId === 1) writeFileSync(trackedPath, "changed by the first question\n");
      return Promise.resolve({ status: "completed" as const, errorCode: null });
    },
    { store, repoRoot },
  );

  const outcomes = (await report).outcomes;
  const identities = outcomes.map((item) => store.batchRunFacts(item.runId!)!.sourceIdentity);
  assert.deepEqual(identities, [
    { gitCommit: commit, treeDirty: false },
    { gitCommit: commit, treeDirty: false },
  ]);
  assert.equal(gitCommand(repoRoot, ["status", "--porcelain", "--untracked-files=no"]), "M tracked.txt");
});

test("one question's outage does not stop the batch", async () => {
  const t = { onTestFinished };
  const { report } = batch(t, [1, 2, 3], (job) => {
    if (job.questionId === 2) throw new Error("provider exploded");
    return passes(job);
  });
  const { outcomes, stopped } = await report;

  assert.equal(stopped, null);
  assert.deepEqual(classes(outcomes), ["passed/-", "error/infra_error", "passed/-"]);
  assert.match(outcomes[1]!.detail, /provider exploded/);
});

test("five failures of the same class stop the batch and write what is owed", async () => {
  const t = { onTestFinished };
  const { repoRoot, report } = batch(t, [1, 2, 3, 4, 5, 6, 7], () =>
    Promise.resolve({ status: "failed" as const, errorCode: "invalid_output" }),
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

test("a same-class streak is broken by a passing question", async () => {
  const t = { onTestFinished };
  const { report } = batch(t, [1, 2, 3, 4, 5, 6, 7, 8], ({ questionId }) =>
    Promise.resolve(
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

test("two outages in a row stop the batch immediately", async () => {
  const t = { onTestFinished };
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

test("a finished batch owes nothing and clears a stale remaining file", async () => {
  const t = { onTestFinished };
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

test("a hung question is cancelled, recorded as infra_timeout, and left with a terminal run", async () => {
  const t = { onTestFinished };
  let aborted = false;
  const { store, report } = batch(
    t,
    [1, 2],
    ({ signal }) =>
      new Promise(() => {
        // 永不 settle：Python 侧那道「取消也没落地」的病理情况。
        signal.addEventListener("abort", () => {
          aborted = true;
        });
      }),
    { timeoutMs: 30, graceMs: 20 },
  );
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
  assert.ok(
    snapshot.recent_events.some(
      (event: Record<string, any>) => event.kind === "run.failed" && event.payload.failure_code === "infra_timeout",
    ),
  );
});

test("a late completion cannot overwrite a timeout terminal or emit run.completed", async () => {
  const t = { onTestFinished };
  let releaseLateCompletion!: () => void;
  const { store, report } = batch(
    t,
    [1],
    ({ runId }) =>
      new Promise((resolve) => {
        releaseLateCompletion = () => {
          store.finishRun(runId, "completed");
          resolve({ status: "completed" as const, errorCode: null });
        };
      }),
    { timeoutMs: 20, graceMs: 10 },
  );

  const { outcomes } = await report;
  const runId = outcomes[0]!.runId!;
  assert.equal(outcomes[0]!.classification, "infra_timeout");
  assert.equal(store.snapshot(runId)!.status, "failed");
  assert.equal(store.snapshot(runId)!.error_code, "infra_timeout");

  // 批跑已经落下 infra_timeout 后，执行流才姗姗来迟地尝试完成同一个 Run。
  releaseLateCompletion();
  await Promise.resolve();

  const snapshot = store.snapshot(runId)!;
  assert.equal(snapshot.status, "failed");
  assert.equal(snapshot.error_code, "infra_timeout");
  const terminalEvents = snapshot.recent_events.filter((event: Record<string, any>) =>
    ["run.completed", "run.review_rejected", "run.failed"].includes(event.kind),
  );
  assert.deepEqual(
    terminalEvents.map((event: Record<string, any>) => event.kind),
    ["run.failed"],
  );
});

test("a timed-out question that settled itself keeps its own verdict", async () => {
  const t = { onTestFinished };
  const store = new SqliteStore(":memory:");
  const { report } = batch(
    t,
    [1],
    ({ runId }) =>
      new Promise(() => {
        // 取消赶上了它自己收尾：那份终态是它的事实，批跑不得改写（merge 不 rewrite）。
        completeStoredRun(store, runId);
      }),
    { store, timeoutMs: 30, graceMs: 20 },
  );
  const { outcomes } = await report;

  assert.equal(outcomes[0]!.status, "passed", "durable completed 是唯一可发布的成功事实");
  assert.equal(store.snapshot(outcomes[0]!.runId!)!.status, "completed");
  assert.equal(store.completedRunForQuestion(1), outcomes[0]!.runId);
});

test("any unknown question id rejects the whole batch before creating or running a question", async () => {
  const t = { onTestFinished };
  const store = new SqliteStore(":memory:");
  t.onTestFinished(() => store.close());
  let createRunCalls = 0;
  const createRun = store.createRun.bind(store);
  store.createRun = ((...args: Parameters<SqliteStore["createRun"]>) => {
    createRunCalls += 1;
    return createRun(...args);
  }) as SqliteStore["createRun"];
  const executed: number[] = [];
  const report = runBatch([1, 126, 127], {
    store,
    log: () => {},
    runQuestion: (job) => {
      executed.push(job.questionId);
      return passes(job);
    },
  });

  await assert.rejects(report, /126.*127/);
  assert.equal(createRunCalls, 0);
  assert.deepEqual(executed, []);
});

test("live CLI rejects absent credentials before creating its SQLite database", async () => {
  const t = { onTestFinished };
  const savedKey = process.env.QWEN_API_KEY;
  delete process.env.QWEN_API_KEY;
  clearModelOverride();
  t.onTestFinished(() => {
    if (savedKey === undefined) delete process.env.QWEN_API_KEY;
    else process.env.QWEN_API_KEY = savedKey;
    clearModelOverride();
  });
  assert.equal(modelConfigStatus().credential, "absent");

  const dir = workspace(t);
  const dbPath = join(dir, "runtime", "runs.db");
  let output = "";
  const originalWrite = process.stdout.write.bind(process.stdout) as typeof process.stdout.write;
  process.stdout.write = ((chunk: unknown) => {
    output += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  t.onTestFinished(() => {
    process.stdout.write = originalWrite;
  });

  const code = await main(["--ids", "1", "--db", dbPath], { bunVersion: "1.4.0" });
  assert.equal(code, 2);
  assert.match(output, /缺少.*QWEN_API_KEY/);
  assert.equal(existsSync(dbPath), false);
});

test("dry-run CLI does not require a model credential", async () => {
  const t = { onTestFinished };
  const savedKey = process.env.QWEN_API_KEY;
  delete process.env.QWEN_API_KEY;
  clearModelOverride();
  t.onTestFinished(() => {
    if (savedKey === undefined) delete process.env.QWEN_API_KEY;
    else process.env.QWEN_API_KEY = savedKey;
    clearModelOverride();
  });

  const dir = workspace(t);
  const code = await main(["--ids", "1", "--dry-run", "--db", join(dir, "runtime", "runs.db")]);
  assert.equal(code, 0);
});

test("formal Science-125 CLI requires an explicit confirmation before opening SQLite", async () => {
  const t = { onTestFinished };
  const dir = workspace(t);
  const dbPath = join(dir, "runtime", "runs.db");
  let output = "";
  const originalWrite = process.stdout.write.bind(process.stdout) as typeof process.stdout.write;
  process.stdout.write = ((chunk: unknown) => {
    output += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  t.onTestFinished(() => {
    process.stdout.write = originalWrite;
  });

  const code = await main(["--ids", "1-125", "--db", dbPath], { bunVersion: "1.4.0" });

  assert.equal(code, 2);
  assert.match(output, /--confirm-science125/);
  assert.equal(existsSync(dbPath), false);
});

test("paid formal phases require an exact release commit before credentials or SQLite", async () => {
  const t = { onTestFinished };
  const dir = workspace(t);
  const dbPath = join(dir, "runtime", "release.db");
  let output = "";
  const originalWrite = process.stdout.write.bind(process.stdout) as typeof process.stdout.write;
  process.stdout.write = ((chunk: unknown) => {
    output += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  t.onTestFinished(() => {
    process.stdout.write = originalWrite;
  });

  const code = await main(["--manifest-id", "formal-resume", "--confirm-science125", "--db", dbPath], {
    bunVersion: "1.4.0",
  });
  assert.equal(code, 2);
  assert.match(output, /--release-commit/);
  assert.doesNotMatch(output, /QWEN_API_KEY/);
  assert.equal(existsSync(dbPath), false);
});

test("memory-off is fail-closed before SQLite for confirmation, ids, and source identity", async () => {
  const t = { onTestFinished };
  const dir = workspace(t);
  const dbPath = join(dir, "runtime", "runs.db");
  let output = "";
  const originalWrite = process.stdout.write.bind(process.stdout) as typeof process.stdout.write;
  process.stdout.write = ((chunk: unknown) => {
    output += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  t.onTestFinished(() => {
    process.stdout.write = originalWrite;
  });
  const missingConfirmationDb = join(dir, "runtime", "missing-confirmation.db");
  const missingConfirmationCode = await main(["--ids", "1", "--no-memory", "--db", missingConfirmationDb], {
    bunVersion: "1.4.0",
  });
  assert.equal(missingConfirmationCode, 2);
  assert.match(output, /--confirm-memory-ablation/);
  assert.equal(existsSync(missingConfirmationDb), false);

  const code = await main(["--ids", "1", "--no-memory", "--confirm-memory-ablation", "--db", dbPath], {
    bunVersion: "1.4.0",
  });
  assert.equal(code, 2);
  assert.match(output, /精确匹配.*30 题/);
  assert.equal(existsSync(dbPath), false);
});

test("formal live batch requires the pinned Bun runtime, while dry-run is portable", () => {
  assert.equal(validateBatchBunRuntime({ bunVersion: "1.4.0", dryRun: false }), null);
  assert.match(validateBatchBunRuntime({ bunVersion: "1.3.9", dryRun: false }) ?? "", /1\.3\.9/);
  assert.match(validateBatchBunRuntime({ bunVersion: "1.3.9", dryRun: false }) ?? "", /Bun 1\.4\.0/);
  assert.equal(validateBatchBunRuntime({ bunVersion: "1.3.9", dryRun: true }), null);
});

test("live batch rejects an unsupported Bun runtime before opening SQLite", async () => {
  const t = { onTestFinished };
  const dir = workspace(t);
  const dbPath = join(dir, "runtime", "runs.db");
  let output = "";
  const originalWrite = process.stdout.write.bind(process.stdout) as typeof process.stdout.write;
  process.stdout.write = ((chunk: unknown) => {
    output += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  t.onTestFinished(() => {
    process.stdout.write = originalWrite;
  });

  const code = await main(["--ids", "1", "--db", dbPath], { bunVersion: "1.3.9" });
  assert.equal(code, 2);
  assert.match(output, /1\.3\.9/);
  assert.match(output, /Bun 1\.4\.0/);
  assert.equal(existsSync(dbPath), false);
});

test("--dry-run plans without creating a single run", async () => {
  const t = { onTestFinished };
  const { report } = batch(
    t,
    [1, 2],
    () => {
      throw new Error("dry-run 不该发起执行");
    },
    { dryRun: true },
  );
  const { outcomes } = await report;

  assert.deepEqual(classes(outcomes), ["planned/-", "planned/-"]);
  assert.deepEqual(
    outcomes.map((item) => item.runId),
    [null, null],
  );
  assert.ok(outcomes[0]!.detail.length > 0);
});

test("--dry-run with ids leaves no persistent manifest behind", async () => {
  const t = { onTestFinished };
  const dir = workspace(t);
  const path = join(dir, "runtime", "runs.db");

  assert.equal(await main(["--ids", "1", "--dry-run", "--db", path], { bunVersion: "1.4.0" }), 0);
  assert.equal(existsSync(path), false);
});

test("a live batch logs its durable manifest id", async () => {
  const lines: string[] = [];
  const h = batch({ onTestFinished }, [1], passes, { log: (line) => lines.push(line) });
  const report = await h.report;
  assert.ok(lines.includes(`[batch] manifestId ${report.manifestId}`));
});

test("progress is one line per question, tagged with its pool slot, plus a tally", async () => {
  const t = { onTestFinished };
  const lines: string[] = [];
  const { report } = batch(t, [1, 2], passes, { log: (line) => lines.push(line) });
  await report;

  assert.equal(lines.length, 4);
  assert.match(lines[0]!, /^\[batch] manifestId [a-f0-9]+$/);
  // 槽位标识 `s1`：并发跑时没有它，交错的进度行分不清哪几行属于同一条流水。
  assert.match(lines[1]!, /^\[batch] 1\/2 s1 q1 \| passed \| \d+\.\ds$/);
  assert.match(lines[3]!, /^\[batch] 合计 2 题：passed 2$/);
});

test("--concurrency is bounded before any money is spent", () => {
  assert.equal(parseConcurrency(undefined), 3);
  assert.equal(parseConcurrency("1"), 1);
  assert.equal(parseConcurrency(String(MAX_CONCURRENCY)), MAX_CONCURRENCY);
  for (const spec of ["0", "-1", String(MAX_CONCURRENCY + 1), "2.5", "abc", ""]) {
    assert.throws(() => parseConcurrency(spec), /--concurrency/, `expected ${JSON.stringify(spec)} to be rejected`);
  }
});

test("the pool never runs more questions than its bound, and settles them as they finish", async () => {
  const t = { onTestFinished };
  let live = 0;
  let peak = 0;
  let completedFast = 0;
  let releaseInitial!: () => void;
  const initialPoolIsFull = new Promise<void>((resolve) => {
    releaseInitial = resolve;
  });
  let releaseFirst!: () => void;
  const firstMayFinish = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const { report } = batch(
    t,
    [1, 2, 3, 4, 5, 6],
    async ({ questionId }) => {
      live += 1;
      peak = Math.max(peak, live);
      if (live === 3) releaseInitial();
      await initialPoolIsFull;
      // 第一题等其余五题全部完成后才放行：验证完成顺序不能依赖机器负载和毫秒级定时器。
      if (questionId === 1) await firstMayFinish;
      else {
        completedFast += 1;
        if (completedFast === 5) releaseFirst();
      }
      live -= 1;
      return { status: "completed" as const, errorCode: null };
    },
    { concurrency: 3, timeoutMs: 10_000 },
  );
  const { outcomes } = await report;

  assert.equal(peak, 3, "池子该是满的，也不该超");
  assert.equal(outcomes.length, 6);
  // 完成即结算：慢的第 1 题最后落，后面五题不必等它。
  assert.equal(outcomes.at(-1)!.questionId, 1);
  assert.deepEqual(
    [...outcomes].map((item) => item.questionId).sort((a, b) => a - b),
    [1, 2, 3, 4, 5, 6],
  );
});

test("--concurrency 1 is exactly the serial batch", async () => {
  const t = { onTestFinished };
  let live = 0;
  let peak = 0;
  const { report } = batch(
    t,
    [1, 2, 3],
    async ({ questionId }) => {
      live += 1;
      peak = Math.max(peak, live);
      await sleep(questionId === 1 ? 30 : 1);
      live -= 1;
      return { status: "completed" as const, errorCode: null };
    },
    { concurrency: 1, timeoutMs: 10_000 },
  );
  const { outcomes } = await report;

  assert.equal(peak, 1, "并发 1 就是一次一题");
  // 慢的第 1 题仍然第一个结算：串行下结算顺序等于派发顺序。
  assert.deepEqual(
    outcomes.map((item) => item.questionId),
    [1, 2, 3],
  );
});

test("a tripped breaker stops dispatching but lets the in-flight questions finish", async () => {
  const t = { onTestFinished };
  const started: number[] = [];
  const cancelled: number[] = [];
  const settled: string[] = [];
  const gates = new Map<number, () => void>();
  const open = (questionId: number) => new Promise<void>((resolve) => gates.set(questionId, resolve));

  const { repoRoot, report } = batch(
    t,
    [1, 2, 3, 4, 5],
    async ({ questionId, signal }) => {
      started.push(questionId);
      signal.addEventListener("abort", () => cancelled.push(questionId));
      await open(questionId);
      if (questionId === 3) return { status: "completed" as const, errorCode: null };
      throw new Error("ECONNREFUSED");
    },
    {
      concurrency: 2,
      timeoutMs: 10_000,
      graceMs: 10_000,
      log: (line) => {
        if (/^\[batch] \d+\/5 /.test(line)) settled.push(line);
      },
    },
  );

  // 1、2 一起在飞。1 先落 → 补进 3；2 再落 → 结算序上连续两次 infra_error，熔断。
  await until(() => started.length === 2);
  gates.get(1)!();
  await until(() => started.length === 3);
  gates.get(2)!();
  await until(() => settled.length === 2);
  gates.get(3)!();
  const { outcomes, stopped } = await report;

  assert.deepEqual(started, [1, 2, 3], "熔断之后不该再派发第 4 题");
  assert.deepEqual(cancelled, [], "在飞的题不被取消——它们的钱已经花了");
  assert.deepEqual(
    outcomes.map((item) => `q${item.questionId}/${item.status}`),
    ["q1/error", "q2/error", "q3/passed"],
    "熔断之后才落地的那道题照样进 outcomes",
  );
  assert.ok(stopped);
  assert.match(stopped.reason, /连续 2 次 infra_error/);
  // 欠账只算从未派发过的题；已经跑完的第 3 题不在里面。
  assert.equal(stopped.remaining, "4,5");
  assert.equal(stopped.completed, 3, "排空之后才定稿，在飞的那题也算已完成");
  assert.deepEqual(stopped.failedByClass, { infra_error: 2 });
  assert.deepEqual(JSON.parse(readFileSync(remainingPath(repoRoot), "utf8")), JSON.parse(JSON.stringify(stopped)));
});

test("the breaker counts a same-class streak in settlement order, not dispatch order", async () => {
  const t = { onTestFinished };
  const settled: string[] = [];
  const gates = new Map<number, () => void>();
  const open = (questionId: number) => new Promise<void>((resolve) => gates.set(questionId, resolve));
  const failing = new Set([2, 3]);

  const { report } = batch(
    t,
    [1, 2, 3, 4, 5],
    async ({ questionId }) => {
      await open(questionId);
      return failing.has(questionId)
        ? { status: "failed" as const, errorCode: "infra_error" }
        : { status: "completed" as const, errorCode: null };
    },
    {
      concurrency: 3,
      timeoutMs: 10_000,
      graceMs: 10_000,
      log: (line) => {
        if (/^\[batch] \d+\/5 /.test(line)) settled.push(line);
      },
    },
  );

  // 派发序是 1,2,3；结算序是 2,3 —— 中间没有 passed 打断，连击成立，而第 1 题此刻还在飞。
  await until(() => gates.size === 3);
  gates.get(2)!();
  await until(() => settled.length === 1 && gates.has(4));
  gates.get(3)!();
  await until(() => settled.length === 2);
  gates.get(1)!();
  gates.get(4)!();
  const { outcomes, stopped } = await report;

  assert.ok(stopped, "结算序上连续两次 infra_error，尽管派发序里第 1 题排在它们前面");
  assert.match(stopped.reason, /连续 2 次 infra_error/);
  assert.deepEqual(
    outcomes.slice(0, 2).map((item) => item.questionId),
    [2, 3],
  );
  assert.deepEqual(
    outcomes.map((item) => item.questionId).sort((left, right) => left - right),
    [1, 2, 3, 4],
    "熔断时在飞的 1 与 4 都排空了，只有从未派发的 5 欠着",
  );
  assert.equal(stopped.remaining, "5");
});
