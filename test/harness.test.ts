import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { EvidenceLedger, type EvidenceRecord } from "../src/agent/evidence.ts";
import { StageError } from "../src/agent/failures.ts";
import { Harness } from "../src/harness.ts";
import type { StageExecutor } from "../src/roles.ts";
import { SqliteStore } from "../src/store/store.ts";

const citation = {
  source_type: "arxiv" as const,
  title: "Fixture source",
  locator: "arxiv:2301.00001v1",
  url: "https://arxiv.org/abs/2301.00001v1",
};

function fake(options: {
  gapOnce?: boolean;
  rejectReviews?: number;
  invalidPlanOnce?: boolean;
  hidesASearch?: boolean;
  claimsFailedSearch?: boolean;
  inventsReviewEvidence?: boolean;
  repeatsSupplementarySearch?: boolean;
  rewritesHypothesisQuestion?: boolean;
  claimsUnfrozenSearch?: boolean;
  stageFails?: boolean;
  usesProviderSourceAlias?: boolean;
} = {}) {
  let ledger = new EvidenceLedger();
  const calls: Array<{ role: string; input: any; timeoutMs: number }> = [];
  let evidenceReviews = 0;
  let researchCalls = 0;
  let reviews = 0;
  let plans = 0;

  const execute: StageExecutor = async ({ role, input, timeoutMs }) => {
    const payload = JSON.parse(input);
    calls.push({ role, input: payload, timeoutMs });
    const inputs = (payload.input_artifacts ?? []) as Array<{ id: string; type: string; content: any }>;
    const ofType = (type: string) => inputs.filter((item) => item.type === type);

    if (options.stageFails) throw new StageError("deadline_exceeded", `${role} exceeded the deadline`);

    if (role === "researcher") {
      researchCalls += 1;
      // 真实链路上这条记录由 arxiv_search 的执行结果写入
      const searches: EvidenceRecord[] = [ledger.record({
        tool: "arxiv_search",
        sourceType: "arxiv",
        query: options.repeatsSupplementarySearch
          ? (researchCalls === 1 ? "fixture query" : "FIXTURE QUERY")
          : `fixture query ${researchCalls}`,
        status: "succeeded",
        resultSummary: "arXiv returned 1 citable record(s)",
        citations: [citation],
      })];
      if (options.hidesASearch || options.claimsFailedSearch) {
        searches.push(ledger.record({
          tool: "arxiv_search",
          sourceType: "arxiv",
          query: "the search it wants to hide",
          status: "empty",
          resultSummary: "arXiv returned no valid records",
          citations: [],
        }));
      }
      if (options.claimsUnfrozenSearch) {
        searches.push(ledger.record({
          tool: "arxiv_search",
          sourceType: "arxiv",
          query: "second successful search",
          status: "succeeded",
          resultSummary: "arXiv returned 1 citable record(s)",
          citations: [citation],
        }));
      }
      const reported = options.hidesASearch ? searches.slice(0, 1) : searches;
      const inheritedIds = ofType("research")
        .flatMap((item) => item.content.citations.map((c: any) => c.evidence_id));
      return {
        artifact_type: "research",
        question: payload.question,
        summary: "冻结证据支撑一条可审计的论断。",
        claims: [{
          statement: "证据门提升可审计性。",
          evidence_ids: [...new Set([
            options.claimsFailedSearch || options.claimsUnfrozenSearch
              ? searches[1]!.evidenceId : searches[0]!.evidenceId,
            ...inheritedIds,
          ])],
        }],
        queries: reported.map((record) => ({
          evidence_id: record.evidenceId,
          source_type: options.usesProviderSourceAlias ? "crossref" : "arxiv",
          query: "模型转述的查询词，代码会整条覆写",
          status: "succeeded",
          result_summary: "模型转述的摘要",
        })),
        citations: [{
          evidence_id: searches[0]!.evidenceId,
          source_type: options.usesProviderSourceAlias ? "crossref" : "arxiv",
          title: "模型转述的标题",
          locator: citation.locator,
          url: "https://evil.example.com/other",
        }],
        limitations: ["fixture"],
      };
    }

    if (role === "hypothesis-generation") {
      const research = ofType("research");
      return {
        artifact_type: "hypothesis",
        question: options.rewritesHypothesisQuestion ? "另一个问题" : payload.question,
        hypothesis: "证据门降低无来源引用。",
        rationale: "冻结证据可审计。",
        falsifiable_predictions: ["无来源引用率低于基线。"],
        boundaries: ["仅限引用可靠性。"],
        research_artifact_ids: research.map((item) => item.id),
        evidence_ids: research.flatMap((item) => item.content.citations.map((c: any) => c.evidence_id)),
        validation_conditions: ["使用预注册的配对基准。"],
      };
    }

    if (role === "evidence-review") {
      evidenceReviews += 1;
      const gap = options.gapOnce === true && evidenceReviews === 1;
      const research = ofType("research");
      return {
        artifact_type: "evidence-review",
        hypothesis_artifact_id: ofType("hypothesis").at(-1)!.id,
        research_artifact_ids: research.map((item) => item.id),
        assessments: [{
          claim: "证据门降低无来源引用。",
          verdict: gap ? "uncertain" : "supports",
          rationale: "冻结证据支持开展验证。",
          evidence_ids: options.inventsReviewEvidence
            ? ["ev_never_existed"]
            : research.flatMap((item) => item.content.citations.map((c: any) => c.evidence_id)),
        }],
        gaps: gap ? ["comparison source"] : [],
        supported: !gap,
      };
    }

    if (role === "research-plan") {
      plans += 1;
      if (options.invalidPlanOnce === true && plans === 1) {
        await new Promise((done) => setTimeout(done, 10));
      }
      const frozenId = ofType("research")
        .flatMap((item) => item.content.citations.map((c: any) => c.evidence_id))[0];
      return {
        artifact_type: "research-plan",
        problem_statement: options.invalidPlanOnce === true && plans === 1
          ? "Measure unsupported citations."
          : "测量科研 Agent 的无来源引用率。",
        rationale: "冻结证据使引用可靠性可被检验。",
        technical_details: "先冻结证据，再逐条核验引用。",
        datasets: ["preregistered questions"],
        source: "Frozen Artifacts",
        target: "降低无来源引用率。",
        paper_title: "可审计证据门研究",
        paper_abstract: "开展证据门的配对对照研究。",
        methods: "使用配对盲评方法。",
        experiments: {
          baselines: [
            { name: "无证据门基线", evidence_id: frozenId },
            { name: "仅提示词约束基线", evidence_id: frozenId },
          ],
          metrics: [
            { name: "无来源引用率", evidence_id: frozenId },
            { name: "任务完成率", evidence_id: frozenId },
          ],
          design: "固定问题与模型后做配对盲测。",
        },
        results: {
          status: "pending_verification",
          expected_outcomes: [{ metric: "无来源引用率", statement: "证据门组的无来源引用率更低。" }],
        },
        references: [citation.url],
        input_artifact_ids: payload.input_artifacts.map((item: any) => item.id),
        verification_evidence_ids: [frozenId],
      };
    }

    reviews += 1;
    const rejected = reviews <= (options.rejectReviews ?? 0);
    return {
      artifact_type: "review",
      research_plan_artifact_id: ofType("research-plan").at(-1)!.id,
      evidence_review_artifact_id: ofType("evidence-review").at(-1)!.id,
      scores: { scientific_value: 4, technical_depth: 4, application_potential: 4 },
      weaknesses: rejected ? ["需要澄清对照。"] : [],
      feedback: rejected ? ["修订计划。"] : [],
      suggested_successor_roles: rejected ? ["research-plan"] : [],
      accepted: !rejected,
    };
  };

  // fake 必须往 Harness 那本台账里记，否则 runTask 看到的检索记录是空的
  const useLedger = (next: EvidenceLedger) => { ledger = next; };
  return { execute, calls, useLedger };
}

function harness(options: Parameters<typeof fake>[0] = {}) {
  const store = new SqliteStore(":memory:");
  const f = fake(options);
  // 每个 Attempt 一本新台账，且检索发生时就落库 —— 和默认实现同形
  const runner = new Harness(store, f.execute, {
    createLedger: (scope) => {
      const ledger = new EvidenceLedger({
        namespace: `${scope.attemptId}_`,
        onRecord: (record) => store.recordEvidence(scope.runId, scope.attemptId, record),
      });
      f.useLedger(ledger);
      return ledger;
    },
  });
  return { store, calls: f.calls, harness: runner };
}

test("marks a run interrupted when its database is reopened", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "luup-store-"));
  const database = join(directory, "runs.db");
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  let store = new SqliteStore(database);
  const runId = store.createRun("q");
  store.startAttempt(runId, "researcher");
  store.close();

  store = new SqliteStore(database);
  const snapshot = store.snapshot(runId)!;
  assert.equal(snapshot.status, "failed");
  assert.equal(snapshot.error_code, "interrupted");
  assert.equal(snapshot.attempts[0]!.status, "failed");
  assert.equal(snapshot.attempts[0]!.failure_code, "interrupted");
  assert.equal(snapshot.recent_events.at(-1)!.kind, "run.failed");
  store.close();
});

test("refuses a second writer without interrupting the active run", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "luup-lock-"));
  const database = join(directory, "runs.db");
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  const store = new SqliteStore(database);
  const runId = store.createRun("q");
  assert.throws(() => new SqliteStore(database), /locked/);
  assert.equal(store.snapshot(runId)!.status, "running");
  store.close();
});

test("opens an empty SQLite writer-lock database", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "luup-stale-lock-"));
  const database = join(directory, "runs.db");
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(`${database}.writer-lock.db`, "");

  const store = new SqliteStore(database);
  assert.ok(store.createRun("q"));
  store.close();
});

test("drives a run to completed through the store task graph", async () => {
  const h = harness();
  const runId = h.harness.createRun("设计一个可证伪的实验");
  await h.harness.execute(runId);

  const snapshot = h.store.snapshot(runId)!;
  assert.equal(snapshot.status, "completed");
  assert.deepEqual(snapshot.artifacts.map((a: any) => a.type),
    ["research", "hypothesis", "evidence-review", "research-plan", "review"]);
  assert.deepEqual(h.calls.map((c) => c.role),
    ["researcher", "hypothesis-generation", "evidence-review", "research-plan", "reviewer"]);
  assert.equal(snapshot.attempts.every((a: any) => a.status === "completed"), true);
  h.store.close();
});

test("overwrites model-authored search metadata with what actually happened", async () => {
  // live 百炼会把 Crossref 的领域类别 `web` 写成工具名 `crossref`；解析层接受这个薄别名，
  // 最终值仍由检索台账决定，不能让模型改写。
  const h = harness({ usesProviderSourceAlias: true });
  const runId = h.harness.createRun("q");
  await h.harness.execute(runId);

  const research = h.store.snapshot(runId)!.artifacts.find((a: any) => a.type === "research")!.content;
  assert.equal(research.queries[0].query, "fixture query 1");
  assert.equal(research.queries[0].result_summary, "arXiv returned 1 citable record(s)");
  // citation 的 title/url 也是代码拥有的，模型的转述与改写都不留
  assert.equal(research.citations[0].title, citation.title);
  assert.equal(research.citations[0].url, citation.url);
  h.store.close();
});

test("fails the attempt when the Artifact hides one of its searches", async () => {
  const h = harness({ hidesASearch: true });
  const runId = h.harness.createRun("q");
  await h.harness.execute(runId);

  const snapshot = h.store.snapshot(runId)!;
  assert.equal(snapshot.status, "failed");
  assert.equal(snapshot.error_code, "invalid_output");
  assert.deepEqual(snapshot.artifacts, []);
  assert.equal(snapshot.attempts.at(-1)!.status, "failed");
  const correction = h.calls.filter((call) => call.role === "researcher")[1]!.input;
  assert.equal(correction.frozen_searches.length, 2);
  assert.equal(correction.frozen_searches[1].status, "empty");
  h.store.close();
});

test("failed searches cannot support Research claims", async () => {
  const h = harness({ claimsFailedSearch: true });
  const runId = h.harness.createRun("q");
  await h.harness.execute(runId);

  const snapshot = h.store.snapshot(runId)!;
  assert.equal(snapshot.status, "failed");
  assert.equal(snapshot.error_code, "invalid_output");
  h.store.close();
});

test("claims can only use evidence frozen in the Research citations", async () => {
  const h = harness({ claimsUnfrozenSearch: true });
  const runId = h.harness.createRun("q");
  await h.harness.execute(runId);

  const snapshot = h.store.snapshot(runId)!;
  assert.equal(snapshot.status, "failed");
  assert.equal(snapshot.error_code, "invalid_output");
  h.store.close();
});

test("Evidence Review can only cite frozen Research evidence", async () => {
  const h = harness({ inventsReviewEvidence: true });
  const runId = h.harness.createRun("q");
  await h.harness.execute(runId);

  const snapshot = h.store.snapshot(runId)!;
  assert.equal(snapshot.status, "failed");
  assert.equal(snapshot.attempts.at(-1)!.role, "evidence-review");
  h.store.close();
});

test("Hypothesis cannot rewrite the frozen Run question", async () => {
  const h = harness({ rewritesHypothesisQuestion: true });
  const runId = h.harness.createRun("q");
  await h.harness.execute(runId);

  const snapshot = h.store.snapshot(runId)!;
  assert.equal(snapshot.status, "failed");
  assert.equal(snapshot.attempts.at(-1)!.role, "hypothesis-generation");
  h.store.close();
});

test("runs exactly one supplementary research round", async () => {
  const h = harness({ gapOnce: true });
  const runId = h.harness.createRun("q");
  await h.harness.execute(runId);

  assert.equal(h.store.snapshot(runId)!.status, "completed");
  assert.deepEqual(h.calls.map((c) => c.role), [
    "researcher", "hypothesis-generation", "evidence-review",
    "researcher", "hypothesis-generation", "evidence-review",
    "research-plan", "reviewer",
  ]);
  const secondHypothesis = h.calls.filter((call) => call.role === "hypothesis-generation")[1]!;
  const secondReview = h.calls.filter((call) => call.role === "evidence-review")[1]!;
  assert.equal(secondHypothesis.input.input_artifacts.filter((item: any) => item.type === "research").length, 2);
  assert.equal(secondReview.input.input_artifacts.filter((item: any) => item.type === "research").length, 2);
  h.store.close();
});

test("rejects a supplementary round that repeats every inherited search", async () => {
  const h = harness({ gapOnce: true, repeatsSupplementarySearch: true });
  const runId = h.harness.createRun("q");
  await h.harness.execute(runId);

  const snapshot = h.store.snapshot(runId)!;
  assert.equal(snapshot.status, "failed");
  assert.equal(snapshot.error_code, "invalid_output");
  assert.equal(snapshot.attempts.at(-1)!.role, "researcher");
  h.store.close();
});

test("terminates review_rejected after the bounded revision", async () => {
  const h = harness({ rejectReviews: 2 });
  const runId = h.harness.createRun("q");
  await h.harness.execute(runId);

  const snapshot = h.store.snapshot(runId)!;
  // review_rejected 现在是独立终态，不再挤在 failed 里 —— 它是合同内的正常终止
  assert.equal(snapshot.status, "review_rejected");
  assert.equal(snapshot.error_code, "review_rejected");
  assert.equal(snapshot.recent_events.at(-1)!.kind, "run.review_rejected");
  assert.equal(h.calls.filter((c) => c.role === "research-plan").length, 2);
  assert.equal(h.calls.filter((c) => c.role === "reviewer").length, 2);
  h.store.close();
});

test("evidence IDs use the full Attempt ID namespace", async () => {
  const h = harness();
  const runId = h.harness.createRun("q");
  await h.harness.execute(runId);

  const snapshot = h.store.snapshot(runId)!;
  for (const row of snapshot.tool_evidence) {
    assert.ok(row.id.includes(row.attempt_id), `${row.id} does not contain ${row.attempt_id}`);
  }
  h.store.close();
});

test("keeps a structural correction inside one business Attempt", async () => {
  const h = harness({ invalidPlanOnce: true });
  const runId = h.harness.createRun("q");
  await h.harness.execute(runId);

  const snapshot = h.store.snapshot(runId)!;
  assert.equal(snapshot.status, "completed");
  // 模型被调了两次，但只留下一个 Attempt，纠错次数记在它自己身上
  assert.equal(h.calls.filter((c) => c.role === "research-plan").length, 2);
  const planAttempts = snapshot.attempts.filter((a: any) => a.role === "research-plan");
  assert.equal(planAttempts.length, 1);
  assert.equal(planAttempts[0]!.corrections, 1);
  const planCalls = h.calls.filter((call) => call.role === "research-plan");
  assert.ok(planCalls[1]!.timeoutMs < planCalls[0]!.timeoutMs);
  // 纠错在事件流里也留痕
  const corrections = snapshot.recent_events.filter((e: any) => e.kind === "sdk.structured_correction");
  assert.equal(corrections.length, 1);
  h.store.close();
});

test("records an execution-layer failure without spending the correction", async () => {
  const h = harness({ stageFails: true });
  const runId = h.harness.createRun("q");
  await h.harness.execute(runId);

  const snapshot = h.store.snapshot(runId)!;
  assert.equal(snapshot.status, "failed");
  assert.equal(snapshot.error_code, "deadline_exceeded");
  // 超时换个提示词重发也不会消失，所以只调用一次
  assert.equal(h.calls.length, 1);
  h.store.close();
});

test("persists every search into tool_evidence as it happens", async () => {
  const h = harness();
  const runId = h.harness.createRun("q");
  await h.harness.execute(runId);

  const store = h.store;
  const snapshot = store.snapshot(runId)!;
  assert.equal(snapshot.status, "completed");
  assert.equal(snapshot.tool_evidence.length, 1);
  const evidence = snapshot.tool_evidence[0]!;
  assert.equal(evidence.tool_name, "arxiv_search");
  assert.equal(evidence.status, "succeeded");
  assert.equal(evidence.output.citations[0].locator, citation.locator);
  // 事件流里也留痕，且 result_count 是代码数出来的
  const recorded = snapshot.recent_events.filter((e: any) => e.kind === "tool.evidence_recorded");
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0]!.payload.result_count, 1);
  store.close();
});

test("keeps the searches of a failed attempt", async () => {
  const h = harness({ hidesASearch: true });
  const runId = h.harness.createRun("q");
  await h.harness.execute(runId);

  const store = h.store;
  const snapshot = store.snapshot(runId)!;
  assert.equal(snapshot.status, "failed");
  assert.deepEqual(snapshot.artifacts, []);
  // Attempt 失败了，但它查过的检索都还在 —— 那正是排查为什么失败的材料。
  // 4 条而不是 2 条：首轮 2 次，纠错轮又是一次全新调用、又查了 2 次，两轮都该留痕。
  assert.equal(snapshot.tool_evidence.length, 4);
  assert.deepEqual(snapshot.tool_evidence.map((e: any) => e.status),
    ["succeeded", "empty", "succeeded", "empty"]);
  store.close();
});

test("drops evidence that arrives after its Attempt has failed", () => {
  const store = new SqliteStore(":memory:");
  const runId = store.createRun("q");
  const attemptId = store.startAttempt(runId, "researcher");
  store.failAttempt(runId, attemptId, { code: "deadline_exceeded", reason: "late" }, "StageError", 0);
  const before = store.snapshot(runId)!.recent_events.length;

  store.recordEvidence(runId, attemptId, {
    evidenceId: "ev_late",
    tool: "arxiv_search",
    sourceType: "arxiv",
    query: "late query",
    status: "succeeded",
    resultSummary: "late result",
    citations: [citation],
  });

  const snapshot = store.snapshot(runId)!;
  assert.deepEqual(snapshot.tool_evidence, []);
  assert.equal(snapshot.recent_events.length, before);
  store.close();
});
