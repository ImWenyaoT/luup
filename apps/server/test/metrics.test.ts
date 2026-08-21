import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { onTestFinished, test } from "bun:test";

type TestContext = { onTestFinished: typeof onTestFinished };

import type { DomainArtifact } from "../src/agent/contracts.ts";
import { FAILURE_CODES } from "../src/agent/failures.ts";
import { BatchManifest } from "../src/batch/manifest.ts";
import {
  ablationEffective,
  evaluate,
  evaluateDatabase,
  INFRASTRUCTURE_CLASSES,
  loadRunFacts,
  memoryArmComparison,
  passSquared,
  proportion,
  QUALITY_CLASSES,
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
    const finalArtifact = store.publishArtifact(
      runId,
      researcher,
      { artifact_type: "research-plan" } as unknown as DomainArtifact,
      [],
      seed.corrections ?? 0,
    );
    if (seed.reviewed) {
      const reviewer = store.startAttempt(runId, "reviewer");
      store.publishArtifact(runId, reviewer, { artifact_type: "review" } as unknown as DomainArtifact, [], 0);
    }
    store.finishRun(runId, seed.status, {
      finalArtifactId: seed.status === "completed" ? finalArtifact.id : undefined,
      errorCode: seed.errorCode ?? undefined,
    });
  }
  store.close();
  return path;
}

const facts = (overrides: Partial<RunFacts> = {}): RunFacts => ({
  runId: "r",
  questionId: 1,
  status: "completed",
  errorCode: null,
  memoryArm: null,
  cohort: "unknown",
  deliverable: true,
  attempts: 1,
  correctedAttempts: 0,
  corrections: 0,
  unknownCorrectionAttempts: 0,
  reviewed: false,
  rejected: false,
  arxivCalls: 0,
  distinctQueries: 0,
  injected: 0,
  ...overrides,
});

test("a proportion with an empty denominator is null, never zero", () => {
  assert.deepEqual(proportion(0, 0), { rate: null, se: null });
  assert.deepEqual(proportion(0, 4), { rate: 0, se: 0 });
  const half = proportion(2, 4);
  assert.equal(half.rate, 0.5);
  assert.equal(half.se, Math.sqrt(0.25 / 4));
});

test("delivery is reported over both denominators, infrastructure excluded from quality", () => {
  const t = { onTestFinished };
  const report = evaluateDatabase(
    fixture(t, [
      { questionId: 1, status: "completed" },
      { questionId: 2, status: "failed", errorCode: "invalid_output" },
      { questionId: 3, status: "failed", errorCode: "infra_timeout" },
      { questionId: 4, status: "failed", errorCode: "infra_error" },
    ]),
  );

  const { delivery } = report.statistics;
  assert.equal(delivery.runs, 4);
  assert.equal(delivery.rate, 0.25);
  // arXiv 不可达不是科研质量的证据：质量分母里只剩 2 题。
  assert.equal(delivery.excludingInfrastructure.runs, 2);
  assert.equal(delivery.excludingInfrastructure.rate, 0.5);
  assert.deepEqual(report.statistics.failureClasses.infrastructure.byClass, { infra_error: 1, infra_timeout: 1 });
  assert.deepEqual(report.statistics.failureClasses.quality.byClass, { invalid_output: 1 });
});

test("metrics can be scoped to one manifest and exposes excluded database runs", () => {
  const dir = mkdtempSync(join(tmpdir(), "luup-metrics-manifest-"));
  const path = join(dir, "runs.db");
  const store = new SqliteStore(path);
  const includedRun = store.createRun("题 1", { science125Id: 1 });
  store.finishRun(includedRun, "failed", { errorCode: "invalid_output" });
  const excludedRun = store.createRun("题 2", { science125Id: 2 });
  store.finishRun(excludedRun, "failed", { errorCode: "invalid_output" });
  const manifest = BatchManifest.create(store, [1]);
  manifest.record({ questionId: 1, status: "failure", runId: includedRun });
  store.close();
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));

  const report = evaluateDatabase(path, manifest.id);
  assert.equal(report.runs, 1);
  assert.equal(report.manifest_scope?.manifest_id, manifest.id);
  assert.equal(report.manifest_scope?.excluded_db_run_count, 1);
  assert.deepEqual(report.manifest_scope?.excluded_db_run_ids, [excludedRun]);
});

test("metrics rejects an unknown manifest or a manifest without a valid run", () => {
  const t = { onTestFinished };
  const path = fixture(t, [{ questionId: 1, status: "completed" }]);
  assert.throws(() => evaluateDatabase(path, "does-not-exist"), /manifest.*not found/i);

  const store = new SqliteStore(path);
  const manifest = BatchManifest.create(store, [1]);
  manifest.record({ questionId: 1, status: "success" });
  store.close();
  assert.throws(() => evaluateDatabase(path, manifest.id), /no valid run/i);
});

test("the two reading buckets partition the nine failure codes, with none left over", () => {
  // 读数侧刻意不 import 生产代码（改 agent 不该改历史读数），代价是两份清单可能分叉。
  // 这条断言就是那份代价的对账：新加一个码而不裁决它的桶，这里必红。
  const codes = new Set<string>(FAILURE_CODES);
  assert.equal(codes.size, 9, "失败码是 9 个；改了数目就要重走桶归属裁决");
  const bucketed = [...INFRASTRUCTURE_CLASSES, ...QUALITY_CLASSES];
  assert.equal(new Set(bucketed).size, bucketed.length, "同一个码不能同时进两个桶");
  assert.deepEqual([...bucketed].sort(), [...codes].sort(), "每个码恰好落进一个桶");
  // review_rejected 是终态不是码，因此它**不该**出现在任何一个桶里。
  assert.equal(codes.has("review_rejected"), false);
  assert.equal(bucketed.includes("review_rejected"), false);
});

test("every failure code lands in exactly one bucket, by who can fix it", () => {
  const t = { onTestFinished };
  const report = evaluateDatabase(
    fixture(t, [
      // 环境类五个码：环境/供应商/凭据/超时，换个模型重跑也修不掉。
      { questionId: 1, status: "failed", errorCode: "infra_error" },
      { questionId: 2, status: "failed", errorCode: "infra_timeout" },
      { questionId: 3, status: "failed", errorCode: "missing_credential" },
      { questionId: 4, status: "failed", errorCode: "provider_error" },
      { questionId: 5, status: "failed", errorCode: "deadline_exceeded" },
      // 质量类四个码：责任在 harness 或模型自己，必须留在质量分母里。
      { questionId: 6, status: "failed", errorCode: "invalid_output" },
      { questionId: 7, status: "failed", errorCode: "verifier_refs" },
      { questionId: 8, status: "failed", errorCode: "context_overflow" },
      { questionId: 9, status: "failed", errorCode: "runtime_error" },
      { questionId: 10, status: "completed" },
    ]),
  );

  const { delivery, failureClasses } = report.statistics;
  assert.equal(failureClasses.failed, 9);
  assert.deepEqual(failureClasses.infrastructure.byClass, {
    deadline_exceeded: 1,
    infra_error: 1,
    infra_timeout: 1,
    missing_credential: 1,
    provider_error: 1,
  });
  assert.deepEqual(failureClasses.quality.byClass, {
    context_overflow: 1,
    invalid_output: 1,
    runtime_error: 1,
    verifier_refs: 1,
  });
  assert.equal(failureClasses.reviewRejected, 0);
  assert.deepEqual(failureClasses.unclassified, { count: 0, byClass: {} });
  // 五个环境类的 run 整个离开质量分母：10 - 5 = 5，其中 1 个交付。
  assert.equal(delivery.runs, 10);
  assert.equal(delivery.excludingInfrastructure.runs, 5);
  assert.equal(delivery.excludingInfrastructure.rate, 0.2);
});

test("review_rejected is counted apart from the failure codes and stays in both denominators", () => {
  const t = { onTestFinished };
  const report = evaluateDatabase(
    fixture(t, [
      { questionId: 1, status: "completed" },
      { questionId: 2, status: "review_rejected", errorCode: "review_rejected", reviewed: true },
      { questionId: 3, status: "failed", errorCode: "infra_error" },
    ]),
  );

  const { delivery, failureClasses } = report.statistics;
  assert.equal(failureClasses.reviewRejected, 1);
  // 它不是 failure code：既不进 quality 的码分布，也不进 infrastructure。
  assert.deepEqual(failureClasses.quality, { count: 0, byClass: {} });
  assert.deepEqual(failureClasses.unclassified, { count: 0, byClass: {} });
  assert.deepEqual(failureClasses.infrastructure.byClass, { infra_error: 1 });
  // 质量判定的未交付：两个分母都算它一个未交付，只有环境类被剔除。
  assert.equal(delivery.rate, 1 / 3);
  assert.equal(delivery.excludingInfrastructure.runs, 2);
  assert.equal(delivery.excludingInfrastructure.rate, 0.5);
});

test("a code nobody ruled on reads as unclassified instead of borrowing a bucket", () => {
  const t = { onTestFinished };
  const report = evaluateDatabase(
    fixture(t, [
      // Python 期的分类名，或者将来新加的码：没被裁决过就不该自动获得质量类身份。
      { questionId: 1, status: "failed", errorCode: "contract_violation" },
      { questionId: 2, status: "failed", errorCode: null },
    ]),
  );

  const { failureClasses, delivery } = report.statistics;
  assert.deepEqual(failureClasses.unclassified, { count: 2, byClass: { contract_violation: 1 } });
  assert.equal(failureClasses.quality.count, 0);
  // 存疑不给免票：未分类仍留在质量分母里。
  assert.equal(delivery.excludingInfrastructure.runs, 2);
});

test("a dirty tree is its own cohort and a missing identity is unknown", () => {
  const t = { onTestFinished };
  const clean = { gitCommit: "a".repeat(40), treeDirty: false };
  const report = evaluateDatabase(
    fixture(t, [
      { questionId: 1, status: "completed", sourceIdentity: clean },
      { questionId: 2, status: "failed", errorCode: "invalid_output", sourceIdentity: clean },
      { questionId: 3, status: "completed", sourceIdentity: { ...clean, treeDirty: true } },
      { questionId: 4, status: "completed" },
    ]),
  );

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
    run(1, true, "a"),
    run(1, true, "b"),
    run(1, false, "c"),
    run(2, true, "d"),
    run(null, true, "e"),
  ]);
  assert.deepEqual(
    { pairs: measured.pairs, both: measured.both, rate: measured.rate },
    { pairs: 2, both: 1, rate: 0.5 },
  );
  assert.deepEqual(passSquared([run(1, true, "a")]), { pairs: 0, both: 0, rate: null, se: null });
});

test("corrections and reviewer rejections are counted over the right denominators", () => {
  const t = { onTestFinished };
  const report = evaluateDatabase(
    fixture(t, [
      { questionId: 1, status: "completed", reviewed: true, corrections: 1 },
      { questionId: 2, status: "review_rejected", errorCode: "review_rejected", reviewed: true },
      // 挂在 researcher 上的 run 没给 Reviewer 表态的机会，不进否决率的分母。
      { questionId: 3, status: "failed", errorCode: "provider_error" },
    ]),
  );

  const { corrections, review } = report.statistics;
  assert.equal(corrections.attempts, 5, "2 个 run 各有 researcher+reviewer，1 个只有 researcher");
  assert.equal(corrections.correctedAttempts, 1);
  assert.equal(corrections.rate, 0.2);
  assert.deepEqual(
    { reviewed: review.reviewed, rejected: review.rejected, rate: review.rate },
    { reviewed: 2, rejected: 1, rate: 0.5 },
  );
});

test("malformed correction facts remain unknown instead of being counted as zero", () => {
  const t = { onTestFinished };
  const path = fixture(t, [{ questionId: 1, status: "completed", corrections: 1 }]);
  const db = new Database(path);
  db.exec("UPDATE attempts SET corrections = 'not-a-number'");
  db.close();

  const report = evaluateDatabase(path);
  assert.equal(report.statistics.corrections.unknownAttempts, 1);
  assert.equal(report.statistics.corrections.corrections, null);
  assert.equal(report.statistics.corrections.rate, null);
});

test("a legacy database without the corrections column reports unknown instead of failing or using zero", () => {
  const t = { onTestFinished };
  const path = fixture(t, [{ questionId: 1, status: "completed" }]);
  const db = new Database(path);
  db.exec("ALTER TABLE attempts DROP COLUMN corrections");
  db.close();

  const report = evaluateDatabase(path);
  assert.equal(report.statistics.corrections.unknownAttempts, 1);
  assert.equal(report.statistics.corrections.corrections, null);
});

test("search health counts arXiv calls and how many of them were the same query again", () => {
  const t = { onTestFinished };
  const report = evaluateDatabase(
    fixture(t, [
      { questionId: 1, status: "completed", queries: ["dark  matter", "DARK MATTER", "神经网络"] },
      { questionId: 2, status: "completed" },
    ]),
  );

  const { searchHealth } = report.statistics;
  assert.equal(searchHealth.runsWithSearches, 1);
  assert.equal(searchHealth.arxivCalls, 3);
  // 折叠空白、转小写之后，前两次是同一句话。
  assert.equal(searchHealth.distinctQueries, 2);
  assert.equal(searchHealth.repeatedRate, 1 / 3);
});

test("memory injection is counted per arm and a missing event is unknown, not zero", () => {
  const t = { onTestFinished };
  const report = evaluateDatabase(
    fixture(t, [
      { questionId: 1, status: "completed", memoryArm: "on", injected: 3 },
      { questionId: 2, status: "completed", memoryArm: "off", injected: 0 },
      { questionId: 3, status: "completed", memoryArm: null, injected: 1 },
      { questionId: 4, status: "completed", memoryArm: "on" },
    ]),
  );

  const { memoryInjection } = report.statistics;
  assert.equal(memoryInjection.runsWithInjectionEvent, 3);
  assert.equal(memoryInjection.runsWithoutInjectionEvent, 1);
  assert.equal(memoryInjection.entries, 4);
  assert.deepEqual(memoryInjection.byArm, { on: 3, off: 0, unlabelled: 1 });
  assert.deepEqual(memoryInjection.ablationIneffectiveRuns, []);
  assert.deepEqual(memoryInjection.ablationUnknownRuns, []);
});

test("an off-arm run that was injected anything fails the ablation gate", () => {
  const t = { onTestFinished };
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
  assert.equal(ablationEffective(facts({ memoryArm: "off", injected: null })), null, "缺事件必须保持未知");
  assert.equal(ablationEffective(facts({ memoryArm: "on", injected: 5 })), true);
});

test("an off-arm run with no valid injection fact is excluded as unknown", () => {
  const result = memoryArmComparison([
    facts({ runId: "off-unknown", questionId: 1, memoryArm: "off", injected: null }),
    facts({ runId: "on-known", questionId: 1, memoryArm: "on", injected: 2 }),
  ])!;

  assert.deepEqual(result.questions, []);
  assert.deepEqual(result.excludedRuns, [
    { questionId: 1, runId: "off-unknown", reason: "消融状态未知：缺少有效注入事件" },
  ]);
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

test("a database with no paired arms reports no comparison instead of an empty table", () => {
  const t = { onTestFinished };
  const report = evaluateDatabase(fixture(t, [{ questionId: 1, status: "completed", memoryArm: "on" }]));
  assert.equal(report.pairedComparison.memoryArms, null);
});

test("an empty database yields null rates rather than a division by zero", () => {
  const t = { onTestFinished };
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

test("a database written before the memory column existed still reads back", () => {
  const t = { onTestFinished };
  const path = fixture(t, [{ questionId: 1, status: "completed" }]);
  // 只读打开的库补不了列。把列去掉，模拟 Wave 1 建的库。
  const db = new Database(path);
  db.exec("ALTER TABLE runs DROP COLUMN memory_arm");
  db.close();

  const [only] = loadRunFacts(path);
  assert.equal(only!.memoryArm, null);
  assert.equal(only!.deliverable, true);
});

test("the markdown report states both denominators and the ablation verdict", () => {
  const t = { onTestFinished };
  const report = evaluateDatabase(
    fixture(t, [
      { questionId: 1, status: "completed", memoryArm: "on", injected: 1, reviewed: true },
      { questionId: 1, status: "failed", errorCode: "infra_error", memoryArm: "off", injected: 0 },
    ]),
  );
  const markdown = renderMarkdown(report);

  assert.match(markdown, /剔除 infra 类/);
  assert.match(markdown, /消融成立/);
  // 报告自带桶归属口径：引用失败分类的人不必回头翻 criteria.md 才知道谁在哪个桶。
  assert.match(markdown, /桶归属按「谁能修」裁决/);
  assert.match(markdown, /review_rejected，不是 failure code/);
  assert.match(markdown, /p 值与 significant 字段不得引用/);
  assert.match(markdown, /机会样本/);
});
