import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import { ArxivLookupError } from "../src/agent/arxiv.ts";
import { EvidenceLedger, type EvidenceCitation, type EvidenceRecord } from "../src/agent/evidence.ts";
import { StageError } from "../src/agent/failures.ts";
import { reportStructuredOutput } from "../src/agent/roles/structured-output.ts";
import { Harness } from "../src/harness.ts";
import type { StageExecutor } from "../src/roles.ts";
import { SqliteStore } from "../src/store/store.ts";
import { createReferenceVerifier, type ArxivLookup } from "../src/verify/verifier.ts";

const citation = {
  source_type: "arxiv" as const,
  title: "Fixture source",
  locator: "arxiv:2301.00001v1",
  url: "https://arxiv.org/abs/2301.00001v1",
  authors: ["Ada Lovelace", "Grace Hopper"],
  year: 2023,
};

/** 五条来源，因为终局引用验收要求 references ≥5（B3）。 */
const sources: EvidenceCitation[] = [
  citation,
  ...[2, 3, 4, 5].map((n) => ({
    source_type: "arxiv" as const,
    title: `Fixture source ${n}`,
    locator: `arxiv:2301.0000${n}v1`,
    url: `https://arxiv.org/abs/2301.0000${n}v1`,
    authors: ["Ada Lovelace"],
    year: 2023,
  })),
];

/** arXiv 反查替身：照抄冻结来源，所以 B2/B4 在零网络下也是真的在比对。 */
const fixtureLookup: ArxivLookup = async (ids) => {
  const wanted = new Set(ids.map((id) => id.replace(/v\d+$/, "")));
  return sources
    .map((source) => ({
      arxivId: source.locator.replace(/^arxiv:/, ""),
      title: source.title,
      authors: source.authors ?? [],
      year: source.year ?? null,
    }))
    .filter((record) => wanted.has(record.arxivId.replace(/v\d+$/, "")));
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
  thinReferences?: boolean;
} = {}) {
  let ledger = new EvidenceLedger();
  const calls: Array<{ role: string; input: any; timeoutMs: number }> = [];
  let evidenceReviews = 0;
  let researchCalls = 0;
  let reviews = 0;
  let plans = 0;

  const execute: StageExecutor = async ({ role, agent, input, timeoutMs }) => {
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
        citations: sources,
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
          citations: sources,
        }));
      }
      const reported = options.hidesASearch ? searches.slice(0, 1) : searches;
      const inheritedIds = ofType("research")
        .flatMap((item) => item.content.citations.map((c: any) => c.evidence_id));
      // 替身也走 structured_output 上报 —— 与真模型同一条通路，同一份参数 schema。
      return await reportStructuredOutput(agent, {
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
        // 第一条故意让模型转述并改写 URL，其余照抄 —— 代码覆写与否要在同一份产物里看得见。
        citations: sources.map((source, index) => ({
          evidence_id: searches[0]!.evidenceId,
          source_type: options.usesProviderSourceAlias ? "crossref" : "arxiv",
          title: index === 0 ? "模型转述的标题" : source.title,
          locator: source.locator,
          url: index === 0 ? "https://evil.example.com/other" : source.url,
        })),
        limitations: ["fixture"],
      });
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
        references: options.thinReferences === true
          ? [citation.url]
          : [...new Set(ofType("research")
            .flatMap((item) => item.content.citations.map((c: any) => c.url as string)))],
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

function harness(options: Parameters<typeof fake>[0] & { lookupFails?: boolean } = {}) {
  const store = new SqliteStore(":memory:");
  const f = fake(options);
  // 每个 Attempt 一本新台账，且检索发生时就落库 —— 和默认实现同形
  const runner = new Harness(store, f.execute, {
    // 生产同一个验收器，只把 arXiv 反查换成替身：零网络零 LLM，判定逻辑仍是真的。
    verifyReferences: createReferenceVerifier({
      lookup: options.lookupFails === true
        ? async () => { throw new ArxivLookupError("arXiv lookup returned HTTP 503"); }
        : fixtureLookup,
    }),
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
  t.onTestFinished(() => rmSync(directory, { recursive: true, force: true }));

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
  t.onTestFinished(() => rmSync(directory, { recursive: true, force: true }));

  const store = new SqliteStore(database);
  const runId = store.createRun("q");
  assert.throws(() => new SqliteStore(database), /locked/);
  assert.equal(store.snapshot(runId)!.status, "running");
  store.close();
});

test("opens an empty SQLite writer-lock database", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "luup-stale-lock-"));
  const database = join(directory, "runs.db");
  t.onTestFinished(() => rmSync(directory, { recursive: true, force: true }));
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
  assert.equal(recorded[0]!.payload.result_count, sources.length);
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

test("records the deterministic reference verdict before completing", async () => {
  const h = harness();
  const runId = h.harness.createRun("q");
  await h.harness.execute(runId);

  const snapshot = h.store.snapshot(runId)!;
  assert.equal(snapshot.status, "completed");
  const verified = snapshot.recent_events.filter((e: any) => e.kind === "verification.references");
  assert.equal(verified.length, 1);
  assert.equal(verified[0]!.payload.ok, true);
  assert.equal(verified[0]!.payload.reference_count, sources.length);
  // 五条引用全部提得出 arXiv id，所以全部走了独立反查，没有只做归属检查的
  assert.equal(verified[0]!.payload.arxiv_checked, sources.length);
  assert.equal(verified[0]!.payload.membership_only, 0);
  assert.equal(verified[0]!.payload.infra_error, false);
  // 验收发生在终态之前：run.completed 是最后一条
  assert.equal(snapshot.recent_events.at(-1)!.kind, "run.completed");
  h.store.close();
});

test("fails an accepted plan whose references are too few to verify", async () => {
  const h = harness({ thinReferences: true });
  const runId = h.harness.createRun("q");
  await h.harness.execute(runId);

  const snapshot = h.store.snapshot(runId)!;
  assert.equal(snapshot.status, "failed");
  assert.equal(snapshot.error_code, "verifier_refs");
  // Run 级的门，不是 Attempt 级的：五个角色都成功了，产物也都还在
  assert.equal(snapshot.attempts.every((a: any) => a.status === "completed"), true);
  assert.equal(snapshot.artifacts.length, 5);
  assert.equal(snapshot.final_artifact_id, null);
  const verdict = snapshot.recent_events.find((e: any) => e.kind === "verification.references")!;
  assert.equal(verdict.payload.ok, false);
  assert.deepEqual(verdict.payload.failed, ["B3.count"]);
  h.store.close();
});

test("treats an arXiv outage as infra_error rather than fabricated citations", async () => {
  const h = harness({ lookupFails: true });
  const runId = h.harness.createRun("q");
  await h.harness.execute(runId);

  const snapshot = h.store.snapshot(runId)!;
  assert.equal(snapshot.status, "failed");
  assert.equal(snapshot.error_code, "infra_error");
  const verdict = snapshot.recent_events.find((e: any) => e.kind === "verification.references")!;
  assert.equal(verdict.payload.infra_error, true);
  assert.equal(verdict.payload.arxiv_checked, 0);
  // 反查不通只记一条「结论未取得」，不给每条引用扣一顶造假的帽子
  assert.deepEqual(verdict.payload.failed, ["B2.resolve"]);
  h.store.close();
});

test("keeps a quality failure ahead of an arXiv outage", async () => {
  const h = harness({ thinReferences: true, lookupFails: true });
  const runId = h.harness.createRun("q");
  await h.harness.execute(runId);

  const snapshot = h.store.snapshot(runId)!;
  // 网络好坏改变不了 B3 的结论，失败码必须记质量失败
  assert.equal(snapshot.error_code, "verifier_refs");
  h.store.close();
});

test("does not verify references when the Reviewer rejects the plan", async () => {
  const h = harness({ rejectReviews: 2 });
  const runId = h.harness.createRun("q");
  await h.harness.execute(runId);

  const snapshot = h.store.snapshot(runId)!;
  assert.equal(snapshot.status, "review_rejected");
  assert.deepEqual(snapshot.recent_events.filter((e: any) => e.kind === "verification.references"), []);
  h.store.close();
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
