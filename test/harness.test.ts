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
import { runTask, type StageExecutor } from "../src/roles.ts";
import { SqliteStore } from "../src/store/store.ts";
import { createReferenceVerifier, type ArxivLookup } from "../src/verify/verifier.ts";

/** Science-125 的题面：英文原题包在中文出处里（`science125Text`）。
 *  这里写的是 store 归一化之后的形态 —— `normalizeQuestion` 会把换行压成空格。 */
const FROZEN_QUESTION = "来源：《Science》125 前沿科学问题（Science-125 题库）第 1 题，"
  + "Mathematical Sciences。 问题：What makes prime numbers so special?";

/** live 取证到的漂移形态：**截断**而不是翻译 —— 中文出处整段丢掉，只填回英文原题。 */
const DRIFTED_QUESTION = "What makes prime numbers so special?";

/** `researchProposalSchema.queries` 的条数上限 —— 模型一次最多能写这么多条转录。
 *  产物里的 `queries` 由台账填充，不受它约束。 */
const MODEL_WRITABLE_QUERY_CAP = 12;

/** 台账里不存在的 evidence_id：模型虚报一次检索时写的就是这种东西。 */
const INVENTED_EVIDENCE_ID = "ev_never_happened_arxiv";

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
  rewritesResearchQuestion?: boolean;
  rewritesHypothesisQuestion?: boolean;
  claimsUnfrozenSearch?: boolean;
  searchCount?: number;
  inventsAQuery?: boolean;
  inventsACitation?: boolean;
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
      // 一个 Attempt 可以检索很多次：v2 实测最多 20 次。SDK 的 maxTurns 不是上界——
      // 百炼会在同一 turn 并发调工具，`parallelToolCalls: false` 并不总被遵守。
      for (let extra = 1; extra < (options.searchCount ?? 1); extra += 1) {
        searches.push(ledger.record({
          tool: "arxiv_search",
          sourceType: "arxiv",
          query: `flood query ${extra}`,
          status: "succeeded",
          resultSummary: "arXiv returned 1 citable record(s)",
          citations: sources,
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
      const reported = (options.hidesASearch ? searches.slice(0, 1) : searches)
        .slice(0, MODEL_WRITABLE_QUERY_CAP);
      const inheritedIds = ofType("research")
        .flatMap((item) => item.content.citations.map((c: any) => c.evidence_id));
      // 替身也走 structured_output 上报 —— 与真模型同一条通路，同一份参数 schema。
      return await reportStructuredOutput(agent, {
        artifact_type: "research",
        question: options.rewritesResearchQuestion ? DRIFTED_QUESTION : payload.question,
        summary: "冻结证据支撑一条可审计的论断。",
        claims: [{
          statement: "证据门提升可审计性。",
          evidence_ids: [...new Set([
            options.claimsFailedSearch || options.claimsUnfrozenSearch
              ? searches[1]!.evidenceId : searches[0]!.evidenceId,
            ...inheritedIds,
          ])],
        }],
        queries: [
          ...reported.map((record) => ({
            evidence_id: record.evidenceId,
            source_type: options.usesProviderSourceAlias ? "crossref" : "arxiv",
            query: "模型转述的查询词，代码会整条覆写",
            status: "succeeded",
            result_summary: "模型转述的摘要",
          })),
          // 虚报：模型写了一条台账里根本没有的检索。
          ...(options.inventsAQuery === true
            ? [{
              evidence_id: INVENTED_EVIDENCE_ID,
              source_type: "arxiv",
              query: "从未发生过的检索",
              status: "succeeded",
              result_summary: "凭空捏造的摘要",
            }]
            : []),
        ],
        // 第一条故意让模型转述并改写 URL，其余照抄 —— 代码覆写与否要在同一份产物里看得见。
        citations: [
          ...sources.map((source, index) => ({
            evidence_id: searches[0]!.evidenceId,
            source_type: options.usesProviderSourceAlias ? "crossref" : "arxiv",
            title: index === 0 ? "模型转述的标题" : source.title,
            locator: source.locator,
            url: index === 0 ? "https://evil.example.com/other" : source.url,
          })),
          // citations 是模型的**选择**行为，不是转录：挂在虚构检索上的引用照旧判死。
          ...(options.inventsACitation === true
            ? [{
              evidence_id: INVENTED_EVIDENCE_ID,
              source_type: "arxiv",
              title: "凭空捏造的来源",
              locator: "arxiv:9999.99999v1",
              url: null,
            }]
            : []),
        ],
        limitations: ["fixture"],
      });
    }

    if (role === "hypothesis-generation") {
      const research = ofType("research");
      return {
        artifact_type: "hypothesis",
        question: options.rewritesHypothesisQuestion ? DRIFTED_QUESTION : payload.question,
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

/** 这个 run 里全部 queries 漂移记录，按事件顺序。 */
function queryDrift(snapshot: any): any[] {
  return snapshot.recent_events.filter((event: any) =>
    event.kind === "artifact.field_overwritten" && event.payload.field === "queries");
}

test("fills queries from the ledger when the Artifact hides one of its searches", async () => {
  const h = harness({ hidesASearch: true });
  const runId = h.harness.createRun("q");
  await h.harness.execute(runId);

  const snapshot = h.store.snapshot(runId)!;
  // 漏报不再判死：转录不是模型该负责的事，台账才是权威。
  assert.equal(snapshot.status, "completed");
  // 而且不花纠错：藏一次检索连第二次调用都不会触发。
  assert.equal(h.calls.filter((call) => call.role === "researcher").length, 1);

  const research = snapshot.artifacts.find((a: any) => a.type === "research")!.content;
  const recorded = snapshot.tool_evidence.map((row: any) => row.id);
  assert.equal(recorded.length, 2);
  // 被藏起来的那次检索照样进了产物，而且逐条与实录对齐。
  assert.deepEqual(research.queries.map((query: any) => query.evidence_id), recorded);
  assert.deepEqual(research.queries.map((query: any) => query.status), ["succeeded", "empty"]);

  // 覆写救回了这一步，所以它必须留痕：漏一条、虚报零条。
  const drift = queryDrift(snapshot);
  assert.equal(drift.length, 1);
  assert.equal(drift[0]!.payload.artifact_type, "research");
  assert.equal(drift[0]!.payload.missing_count, 1);
  assert.equal(drift[0]!.payload.invented_count, 0);
  assert.equal(drift[0]!.payload.missing, recorded[1]);
  assert.equal(drift[0]!.payload.invented, "");
  h.store.close();
});

test("discards a query the model invented and records it as drift", async () => {
  const h = harness({ inventsAQuery: true });
  const runId = h.harness.createRun("q");
  await h.harness.execute(runId);

  const snapshot = h.store.snapshot(runId)!;
  assert.equal(snapshot.status, "completed");

  const research = snapshot.artifacts.find((a: any) => a.type === "research")!.content;
  const recorded = snapshot.tool_evidence.map((row: any) => row.id);
  // 虚报的那条不对应任何真实检索，进不了证据面。
  assert.deepEqual(research.queries.map((query: any) => query.evidence_id), recorded);
  assert.ok(!JSON.stringify(research).includes(INVENTED_EVIDENCE_ID));

  const drift = queryDrift(snapshot);
  assert.equal(drift.length, 1);
  assert.equal(drift[0]!.payload.missing_count, 0);
  assert.equal(drift[0]!.payload.invented_count, 1);
  assert.equal(drift[0]!.payload.invented, INVENTED_EVIDENCE_ID);
  h.store.close();
});

test("hands downstream roles the queries the ledger actually recorded", async () => {
  const h = harness({ hidesASearch: true });
  const runId = h.harness.createRun("q");
  await h.harness.execute(runId);

  const snapshot = h.store.snapshot(runId)!;
  const recorded = snapshot.tool_evidence.map((row: any) => ({
    evidence_id: row.id,
    query: row.query,
    status: row.status,
  }));
  // 冻结 Artifact 会原样传给后面每个角色；模型转述的查询词一个字都不该传下去。
  let seen = 0;
  for (const call of h.calls.filter((item) => item.role !== "researcher")) {
    for (const input of call.input.input_artifacts as any[]) {
      if (input.type !== "research") continue;
      seen += 1;
      assert.deepEqual(
        input.content.queries.map((query: any) => ({
          evidence_id: query.evidence_id, query: query.query, status: query.status,
        })),
        recorded,
      );
    }
  }
  assert.ok(seen > 0, "下游必须真的收到过 Research Artifact");
  h.store.close();
});

test("freezes every search of an attempt that out-searched the model-writable cap", async () => {
  // 13 = 模型可写上限 + 1，也就是旧 canonical schema 头一个会抛的条数，边界钉在这里。
  // v2 实测这不是边角情形：一个 Attempt 最多跑了 20 次检索，21 题里 5 个超过 12 次。
  // 产物的 queries 由代码填满，条数上限只能把「查得多」判死，不能挡住任何滥用。
  const h = harness({ searchCount: MODEL_WRITABLE_QUERY_CAP + 1 });
  const runId = h.harness.createRun("q");
  await h.harness.execute(runId);

  const snapshot = h.store.snapshot(runId)!;
  assert.equal(snapshot.status, "completed");
  const research = snapshot.artifacts.find((a: any) => a.type === "research")!.content;
  assert.equal(research.queries.length, MODEL_WRITABLE_QUERY_CAP + 1);
  assert.deepEqual(
    research.queries.map((query: any) => query.evidence_id),
    snapshot.tool_evidence.map((row: any) => row.id),
  );
  // 模型只写得下 12 条，第 13 条是漏报 —— 记成一条漂移，不是一次死亡。
  const drift = queryDrift(snapshot);
  assert.equal(drift.length, 1);
  assert.equal(drift[0]!.payload.missing_count, 1);
  assert.equal(drift[0]!.payload.invented_count, 0);
  h.store.close();
});

test("still refuses a citation hung on a search that never ran", async () => {
  // citations 是模型的**选择**行为，不是转录：这道成员性校验一字未动。
  const h = harness({ inventsACitation: true });
  const runId = h.harness.createRun("q");
  await h.harness.execute(runId);

  const snapshot = h.store.snapshot(runId)!;
  assert.equal(snapshot.status, "failed");
  assert.equal(snapshot.error_code, "invalid_output");
  assert.deepEqual(snapshot.artifacts, []);
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

/** 这个 run 里全部漂移记录，按事件顺序。 */
function driftEvents(snapshot: any): any[] {
  return snapshot.recent_events.filter((event: any) => event.kind === "artifact.field_overwritten");
}

test("restores the frozen question a Hypothesis rewrote, and records the drift", async () => {
  const h = harness({ rewritesHypothesisQuestion: true });
  const runId = h.harness.createRun(FROZEN_QUESTION);
  await h.harness.execute(runId);

  const snapshot = h.store.snapshot(runId)!;
  // 改写不再打死 Attempt：question 是回显字段，代码写定就是了。
  assert.equal(snapshot.status, "completed");
  const hypothesis = snapshot.artifacts.find((a: any) => a.type === "hypothesis")!.content;
  assert.equal(hypothesis.question, FROZEN_QUESTION);

  // 覆写救回了这一步，所以它必须留痕 —— 漂移是证据不是秘密。
  const drift = driftEvents(snapshot);
  assert.equal(drift.length, 1);
  assert.equal(drift[0]!.payload.artifact_type, "hypothesis");
  assert.equal(drift[0]!.payload.field, "question");
  assert.equal(drift[0]!.payload.before, DRIFTED_QUESTION);
  assert.equal(drift[0]!.payload.after, FROZEN_QUESTION);
  // 事件顺序要说得通：先记覆写，再发布那份被覆写过的产物。
  const published = snapshot.recent_events
    .filter((e: any) => e.kind === "artifact.published")
    .find((e: any) => e.payload.artifact_type === "hypothesis")!;
  assert.ok(drift[0]!.version < published.version);
  h.store.close();
});

test("restores the frozen question a Research Artifact rewrote", async () => {
  const h = harness({ rewritesResearchQuestion: true });
  const runId = h.harness.createRun(FROZEN_QUESTION);
  await h.harness.execute(runId);

  const snapshot = h.store.snapshot(runId)!;
  assert.equal(snapshot.status, "completed");
  const research = snapshot.artifacts.find((a: any) => a.type === "research")!.content;
  assert.equal(research.question, FROZEN_QUESTION);
  const drift = driftEvents(snapshot);
  assert.equal(drift.length, 1);
  assert.equal(drift[0]!.payload.artifact_type, "research");
  assert.equal(drift[0]!.payload.before, DRIFTED_QUESTION);

  // 下游拿到的是冻结值：Research 的 question 会随冻结输入原样传给后面每个角色，
  // 改写不覆写就等于让一份被截断的题面替代原题在流水线里往下走。
  for (const call of h.calls.filter((item) => item.role !== "researcher")) {
    for (const input of call.input.input_artifacts as any[]) {
      if (input.type === "research") assert.equal(input.content.question, FROZEN_QUESTION);
    }
  }
  h.store.close();
});

test("writes no drift record when the model copies the frozen question verbatim", async () => {
  const h = harness();
  const runId = h.harness.createRun(FROZEN_QUESTION);
  await h.harness.execute(runId);

  const snapshot = h.store.snapshot(runId)!;
  assert.equal(snapshot.status, "completed");
  // 覆写没发生就不该有记录 —— 每个 run 都挂一条会让这条事件什么也不说明。
  // queries 同理：模型转录得与台账逐条一致时，一条漂移事件都不该落。
  assert.deepEqual(driftEvents(snapshot), []);
  h.store.close();
});

test("records the drift of the accepted round only", async () => {
  // 首轮改写了 question，又引了一条不存在的证据：漂移记下了，可这份产物从未发布。
  // 纠错轮仍然改写 question —— 落库的事实只有一条，不是两条。
  let call = 0;
  const research = {
    id: "art_research",
    type: "research",
    content: { citations: [{ evidence_id: "ev_1", url: null }] },
  };
  const execute: StageExecutor = () => {
    call += 1;
    return Promise.resolve({
      artifact_type: "hypothesis",
      question: DRIFTED_QUESTION,
      hypothesis: "证据门降低无来源引用。",
      rationale: "冻结证据可审计。",
      falsifiable_predictions: ["无来源引用率低于基线。"],
      boundaries: ["仅限引用可靠性。"],
      research_artifact_ids: ["art_research"],
      evidence_ids: call === 1 ? ["ev_never_existed"] : ["ev_1"],
      validation_conditions: ["使用预注册的配对基准。"],
    });
  };

  const result = await runTask({
    runId: "run",
    taskId: "attempt",
    role: "hypothesis-generation",
    goal: "基于全部冻结 Research Artifact 生成可证伪假设",
    question: FROZEN_QUESTION,
    inputArtifactIds: ["art_research"],
    inputArtifacts: [research],
  }, { execute });

  assert.equal(result.corrections, 1);
  assert.equal((result.artifact as { question: string }).question, FROZEN_QUESTION);
  assert.deepEqual(result.drift.map((item) => item.field), ["question"]);
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
  const h = harness({ claimsFailedSearch: true });
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
  // 纠错轮是独立的第二次调用，看不到首轮 tool conversation，必须显式交还已冻结检索。
  const correction = h.calls.filter((call) => call.role === "researcher")[1]!.input;
  assert.equal(correction.frozen_searches.length, 2);
  assert.equal(correction.frozen_searches[1].status, "empty");
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
