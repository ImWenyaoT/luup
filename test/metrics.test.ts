import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test, type TestContext } from "vitest";

import type { DomainArtifact } from "../src/agent/contracts.ts";
import {
  ablationEffective,
  evaluate,
  evaluateDatabase,
  loadRunFacts,
  memoryArmComparison,
  passSquared,
  proportion,
  renderMarkdown,
  type RunFacts,
} from "../src/eval/metrics.ts";
import type { MemoryArm, SourceIdentity } from "../src/store/contracts.ts";
import { SqliteStore } from "../src/store/store.ts";

type Seed = {
  questionId?: number | null;
  status: "completed" | "review_rejected" | "failed";
  errorCode?: string | null;
  memoryArm?: MemoryArm | null;
  sourceIdentity?: SourceIdentity | null;
  /** 走到过 Reviewer 并且它交出了 Artifact。 */
  reviewed?: boolean;
  corrections?: number;
  /** arXiv 检索的 query 序列；重复的词就是重复检索。 */
  queries?: string[];
  /** 开局注入的战役记录条数；undefined 表示这个 run 根本没有这条事件（老库）。 */
  injected?: number;
};

/** 造一个真库：走 SqliteStore 自己的写入路径，不手搓 SQL —— 评估读的必须是生产形状。 */
function fixture(t: TestContext, seeds: Seed[]): string {
  const dir = mkdtempSync(join(tmpdir(), "luup-metrics-"));
  t.onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "runs.db");
  const store = new SqliteStore(path);

  for (const [index, seed] of seeds.entries()) {
    const runId = store.createRun(`问题 ${index}`, {
      science125Id: seed.questionId ?? null,
      memoryArm: seed.memoryArm ?? null,
      sourceIdentity: seed.sourceIdentity ?? null,
    });
    if (seed.injected !== undefined) {
      store.emit(runId, "campaign.prior_attempts", {
        question_id: seed.questionId ?? null,
        count: seed.injected,
      });
    }
    const researcher = store.startAttempt(runId, "researcher");
    for (const [position, query] of (seed.queries ?? []).entries()) {
      store.recordEvidence(runId, researcher, {
        evidenceId: `${runId}_${position}`,
        tool: "arxiv_search",
        sourceType: "arxiv",
        query,
        status: "succeeded",
        resultSummary: "1 hit",
        citations: [],
      });
    }
    store.publishArtifact(
      runId, researcher,
      { artifact_type: "research" } as unknown as DomainArtifact, [], seed.corrections ?? 0,
    );
    if (seed.reviewed) {
      const reviewer = store.startAttempt(runId, "reviewer");
      store.publishArtifact(
        runId, reviewer, { artifact_type: "review" } as unknown as DomainArtifact, [], 0,
      );
    }
    store.finishRun(runId, seed.status, { errorCode: seed.errorCode ?? undefined });
  }
  store.close();
  return path;
}

const facts = (overrides: Partial<RunFacts> = {}): RunFacts => ({
  runId: "r", questionId: 1, status: "completed", errorCode: null, memoryArm: null,
  cohort: "unknown", deliverable: true, attempts: 1, correctedAttempts: 0, corrections: 0,
  reviewed: false, rejected: false, arxivCalls: 0, distinctQueries: 0, injected: 0,
  ...overrides,
});

test("a proportion with an empty denominator is null, never zero", () => {
  assert.deepEqual(proportion(0, 0), { rate: null, se: null });
  assert.deepEqual(proportion(0, 4), { rate: 0, se: 0 });
  const half = proportion(2, 4);
  assert.equal(half.rate, 0.5);
  assert.equal(half.se, Math.sqrt(0.25 / 4));
});

test("delivery is reported over both denominators, infrastructure excluded from quality", (t) => {
  const report = evaluateDatabase(fixture(t, [
    { questionId: 1, status: "completed" },
    { questionId: 2, status: "failed", errorCode: "invalid_output" },
    { questionId: 3, status: "failed", errorCode: "infra_timeout" },
    { questionId: 4, status: "failed", errorCode: "infra_error" },
  ]));

  const { delivery } = report.statistics;
  assert.equal(delivery.runs, 4);
  assert.equal(delivery.rate, 0.25);
  // arXiv 不可达不是科研质量的证据：质量分母里只剩 2 题。
  assert.equal(delivery.excludingInfrastructure.runs, 2);
  assert.equal(delivery.excludingInfrastructure.rate, 0.5);
  assert.deepEqual(report.statistics.failureClasses.infrastructure.byClass,
    { infra_error: 1, infra_timeout: 1 });
  assert.deepEqual(report.statistics.failureClasses.quality.byClass, { invalid_output: 1 });
});

test("a dirty tree is its own cohort and a missing identity is unknown", (t) => {
  const clean = { gitCommit: "a".repeat(40), treeDirty: false };
  const report = evaluateDatabase(fixture(t, [
    { questionId: 1, status: "completed", sourceIdentity: clean },
    { questionId: 2, status: "failed", errorCode: "invalid_output", sourceIdentity: clean },
    { questionId: 3, status: "completed", sourceIdentity: { ...clean, treeDirty: true } },
    { questionId: 4, status: "completed" },
  ]));

  const groups = report.statistics.sourceIdentity;
  assert.deepEqual(Object.keys(groups).sort(), ["a".repeat(40), `${"a".repeat(40)}+dirty`, "unknown"]);
  assert.equal(groups["a".repeat(40)]!.rate, 0.5);
  assert.equal(groups[`${"a".repeat(40)}+dirty`]!.rate, 1);
  assert.equal(groups.unknown!.runs, 1);
});

test("Pass^2 pairs time-adjacent runs of the same question and nothing else", () => {
  const run = (questionId: number | null, deliverable: boolean, runId: string) =>
    facts({ runId, questionId, deliverable, status: deliverable ? "completed" : "failed" });

  // q1：过、过、挂 ⇒ 两对，一对双过。q2 只有一条 run，不成对。自由输入没有题号，不参与。
  const measured = passSquared([
    run(1, true, "a"), run(1, true, "b"), run(1, false, "c"),
    run(2, true, "d"), run(null, true, "e"),
  ]);
  assert.deepEqual({ pairs: measured.pairs, both: measured.both, rate: measured.rate },
    { pairs: 2, both: 1, rate: 0.5 });
  assert.deepEqual(passSquared([run(1, true, "a")]), { pairs: 0, both: 0, rate: null, se: null });
});

test("corrections and reviewer rejections are counted over the right denominators", (t) => {
  const report = evaluateDatabase(fixture(t, [
    { questionId: 1, status: "completed", reviewed: true, corrections: 1 },
    { questionId: 2, status: "review_rejected", errorCode: "review_rejected", reviewed: true },
    // 挂在 researcher 上的 run 没给 Reviewer 表态的机会，不进否决率的分母。
    { questionId: 3, status: "failed", errorCode: "provider_error" },
  ]));

  const { corrections, review } = report.statistics;
  assert.equal(corrections.attempts, 5, "2 个 run 各有 researcher+reviewer，1 个只有 researcher");
  assert.equal(corrections.correctedAttempts, 1);
  assert.equal(corrections.rate, 0.2);
  assert.deepEqual({ reviewed: review.reviewed, rejected: review.rejected, rate: review.rate },
    { reviewed: 2, rejected: 1, rate: 0.5 });
});

test("search health counts arXiv calls and how many of them were the same query again", (t) => {
  const report = evaluateDatabase(fixture(t, [
    { questionId: 1, status: "completed", queries: ["dark  matter", "DARK MATTER", "神经网络"] },
    { questionId: 2, status: "completed" },
  ]));

  const { searchHealth } = report.statistics;
  assert.equal(searchHealth.runsWithSearches, 1);
  assert.equal(searchHealth.arxivCalls, 3);
  // 折叠空白、转小写之后，前两次是同一句话。
  assert.equal(searchHealth.distinctQueries, 2);
  assert.equal(searchHealth.repeatedRate, 1 / 3);
});

test("memory injection is counted per arm and a missing event is unknown, not zero", (t) => {
  const report = evaluateDatabase(fixture(t, [
    { questionId: 1, status: "completed", memoryArm: "on", injected: 3 },
    { questionId: 2, status: "completed", memoryArm: "off", injected: 0 },
    { questionId: 3, status: "completed", memoryArm: null, injected: 1 },
    { questionId: 4, status: "completed", memoryArm: "on" },
  ]));

  const { memoryInjection } = report.statistics;
  assert.equal(memoryInjection.runsWithInjectionEvent, 3);
  assert.equal(memoryInjection.runsWithoutInjectionEvent, 1);
  assert.equal(memoryInjection.entries, 4);
  assert.deepEqual(memoryInjection.byArm, { on: 3, off: 0, unlabelled: 1 });
  assert.deepEqual(memoryInjection.ablationIneffectiveRuns, []);
});

test("an off-arm run that was injected anything fails the ablation gate", (t) => {
  const path = fixture(t, [
    { questionId: 1, status: "completed", memoryArm: "off", injected: 2 },
    { questionId: 1, status: "completed", memoryArm: "on", injected: 2 },
  ]);
  const report = evaluate(loadRunFacts(path), path);

  assert.equal(report.statistics.memoryInjection.ablationIneffectiveRuns.length, 1);
  const paired = report.pairedComparison.memoryArms!;
  // 泄漏的 off run 不是对照，剔出配对而不是让它进 2×2 表。
  assert.deepEqual(paired.questions, []);
  assert.equal(paired.excludedRuns.length, 1);
  assert.match(paired.excludedRuns[0]!.reason, /消融失效/);

  assert.equal(ablationEffective(facts({ memoryArm: "off", injected: 0 })), true);
  assert.equal(ablationEffective(facts({ memoryArm: "off", injected: null })), true, "缺事件不算泄漏");
  assert.equal(ablationEffective(facts({ memoryArm: "on", injected: 5 })), true);
});

test("McNemar counts the discordant pairs and reports the regression rate", () => {
  const pair = (questionId: number, offPass: boolean, onPass: boolean): RunFacts[] => [
    facts({ runId: `${questionId}off`, questionId, memoryArm: "off", deliverable: offPass, injected: 0 }),
    facts({ runId: `${questionId}on`, questionId, memoryArm: "on", deliverable: onPass, injected: 2 }),
  ];
  const result = memoryArmComparison([
    ...pair(1, false, true), // b
    ...pair(2, false, true), // b
    ...pair(3, true, false), // c
    ...pair(4, true, true), // concordant pass
    ...pair(5, false, false), // concordant fail
    facts({ runId: "lonely", questionId: 6, memoryArm: "on", injected: 1 }), // 只跑了一臂
  ])!;

  assert.equal(result.questions.length, 5, "只跑了一臂的题不进表");
  assert.deepEqual([result.b, result.c, result.discordant], [2, 1, 3]);
  assert.deepEqual([result.concordantPass, result.concordantFail], [1, 1]);
  // c/(concordantPass+c)：off 已经能过的两题里，开记忆后挂掉一题。
  assert.equal(result.regressionRate, 0.5);
  // 3 个不一致对、2:1 ⇒ 精确二项双侧 p = 2*(C(3,0)+C(3,1))*0.5^3 = 1。
  assert.equal(result.p, 1);
  assert.equal(result.significant, false);
});

test("a baseline that never delivered leaves the regression rate undefined", () => {
  const result = memoryArmComparison([
    facts({ runId: "off", questionId: 1, memoryArm: "off", deliverable: false, injected: 0 }),
    facts({ runId: "on", questionId: 1, memoryArm: "on", deliverable: false, injected: 1 }),
  ])!;

  assert.deepEqual([result.b, result.c, result.concordantPass], [0, 0, 0]);
  assert.equal(result.regressionRate, null, "分母为 0 报 null 而不是 0");
  assert.equal(result.p, 1, "一个不一致对都没有，双侧 p 是 1");
});

test("a database with no paired arms reports no comparison instead of an empty table", (t) => {
  const report = evaluateDatabase(fixture(t, [{ questionId: 1, status: "completed", memoryArm: "on" }]));
  assert.equal(report.pairedComparison.memoryArms, null);
});

test("an empty database yields null rates rather than a division by zero", (t) => {
  const report = evaluateDatabase(fixture(t, []));

  assert.equal(report.runs, 0);
  assert.equal(report.statistics.delivery.rate, null);
  assert.equal(report.statistics.passSquared.rate, null);
  assert.equal(report.statistics.corrections.rate, null);
  assert.equal(report.statistics.review.rate, null);
  assert.equal(report.statistics.searchHealth.repeatedRate, null);
  assert.equal(report.statistics.memoryInjection.entriesPerRun, null);
  assert.match(renderMarkdown(report), /没有可配对/);
});

test("a database written before the memory column existed still reads back", (t) => {
  const path = fixture(t, [{ questionId: 1, status: "completed" }]);
  // 只读打开的库补不了列。把列去掉，模拟 Wave 1 建的库。
  const db = new DatabaseSync(path);
  db.exec("ALTER TABLE runs DROP COLUMN memory_arm");
  db.close();

  const [only] = loadRunFacts(path);
  assert.equal(only!.memoryArm, null);
  assert.equal(only!.deliverable, true);
});

test("the markdown report states both denominators and the ablation verdict", (t) => {
  const report = evaluateDatabase(fixture(t, [
    { questionId: 1, status: "completed", memoryArm: "on", injected: 1, reviewed: true },
    { questionId: 1, status: "failed", errorCode: "infra_error", memoryArm: "off", injected: 0 },
  ]));
  const markdown = renderMarkdown(report);

  assert.match(markdown, /剔除 infra 类/);
  assert.match(markdown, /消融成立/);
  assert.match(markdown, /p 值与 significant 字段不得引用/);
  assert.match(markdown, /机会样本/);
});
