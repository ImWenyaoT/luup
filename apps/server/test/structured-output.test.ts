import assert from "node:assert/strict";
import { test, vi } from "vitest";

import { RunContext, Usage, type Model, type ModelResponse } from "@openai/agents";

import { researchProposalSchema, roleSchema } from "../src/agent/contracts.ts";
import { EvidenceLedger } from "../src/agent/evidence.ts";
import * as crossref from "../src/agent/crossref.ts";
import { classifyFailure } from "../src/agent/failures.ts";
import { createRoles } from "../src/agent/roles/index.ts";
import {
  createStructuredOutput,
  reportStructuredOutput,
  STRUCTURED_OUTPUT_TOOL,
} from "../src/agent/roles/structured-output.ts";
import { createQwenExecutor, isContextOverflow, maxTurnsFor } from "../src/executor.ts";
import { runTask, type StageExecutor } from "../src/roles.ts";
import type { TaskContext } from "../src/agent/contracts.ts";

const artifact = {
  artifact_type: "research",
  question: "问题",
  research_framing: {
    research_object: "科研 Agent 的证据归因机制",
    scope: "固定模型和问题集下的引用可靠性",
    variables: [
      { name: "证据门条件", role: "independent", operationalization: "是否启用冻结 evidence_id 校验" },
      { name: "无来源引用率", role: "dependent", operationalization: "未绑定冻结证据的引用数除以引用总数" },
    ],
    known: ["冻结证据 ID 可以被确定性验收。"],
    controversies: ["提示词约束是否足以替代代码持有的证据归因仍有争议。"],
    unknowns: ["证据门对跨问题任务完成率的影响未知。"],
    knowledge_gap: "缺少在相同问题和模型条件下对证据归因机制的配对比较。",
    constraints: ["不能把候选假设写成已证实结论。"],
  },
  summary: "冻结证据支撑一条可审计的论断。",
  claims: [{ statement: "证据门提升可审计性。", evidence_ids: ["ev_01_arxiv"] }],
  queries: [
    {
      evidence_id: "ev_01_arxiv",
      source_type: "arxiv",
      query: "evidence gate",
      status: "succeeded",
      result_summary: "arXiv returned 1 citable record(s)",
    },
  ],
  citations: [
    {
      evidence_id: "ev_01_arxiv",
      source_type: "arxiv",
      title: "Fixture source",
      locator: "arxiv:2301.00001v1",
      url: "https://arxiv.org/abs/2301.00001v1",
    },
  ],
  limitations: ["fixture"],
};

test.each([1, 8])("researcher reserves synthesis after six searches (provider batch size %s)", async (batchSize) => {
  const search = vi.spyOn(crossref, "searchCrossref").mockImplementation(async (query) => ({
    query,
    status: "empty",
    resultSummary: "No matching records",
    records: [],
    execution: {},
  }));
  const ledger = new EvidenceLedger();
  ledger.beginScope("bounded-search");
  const roles = createRoles(ledger);
  const agent = roles.agents.researcher;
  let turn = 0;
  const model: Model = {
    async getResponse(request): Promise<ModelResponse> {
      turn += 1;
      const searching = request.modelSettings.toolChoice !== "structured_output";
      return {
        usage: new Usage(),
        output: Array.from({ length: searching ? batchSize : 1 }, (_, index) => ({
          type: "function_call" as const,
          id: `call_${turn}_${index}`,
          callId: `call_${turn}_${index}`,
          name: searching ? "crossref_search" : "structured_output",
          arguments: JSON.stringify(searching ? { query: `query ${turn}/${index}` } : artifact),
          status: "completed" as const,
        })),
      };
    },
    getStreamedResponse() {
      throw new Error("No streaming in this test");
    },
  };
  try {
    const result = await createQwenExecutor(undefined, { getModel: () => model })({
      runId: "bounded-search",
      role: "researcher",
      agent,
      input: "{}",
      timeoutMs: 5_000,
    });
    assert.equal(result, "structured output recorded");
    assert.equal(search.mock.calls.length, 6, "failed/empty searches also spend the shared source budget");
    assert.equal(ledger.scopedRecords().length, 6);
    assert.deepEqual(roles.captures.researcher.captured()?.value, artifact);
    roles.captures.researcher.beginRound();
    assert.equal(agent.modelSettings.toolChoice, "structured_output");
    const retained = (await agent.getAllTools(new RunContext())).find((tool) => tool.name === "crossref_search");
    assert.equal(retained?.type, "function");
    if (retained?.type !== "function") throw new Error("missing retained search tool");
    assert.match(
      String(await retained.invoke(new RunContext(), JSON.stringify({ query: "late query" }))),
      /budget exhausted/,
    );
    assert.equal(search.mock.calls.length, 6);
    assert.ok(turn <= 7, "synthesis must happen before the 12-turn ceiling");
  } finally {
    search.mockRestore();
  }
});

/** 直接调工具，绕过模型 —— 被测的是上报通道本身。
 *  成功返回 `{recorded:true}`，失败返回 SDK 回灌给模型的那段错误文本。 */
function call(capture: ReturnType<typeof createStructuredOutput>, args: unknown): Promise<unknown> {
  return Promise.resolve(capture.tool.invoke(new RunContext(), JSON.stringify(args)));
}

test("bad arguments come back as a tool error and the same turn can still fix them", async () => {
  const capture = createStructuredOutput(researchProposalSchema);
  capture.beginRound();

  const rejected = String(await call(capture, { ...artifact, limitations: [] }));
  // zod 的逐条 issue 原样回灌：模型看得见是哪个字段、错在哪，才谈得上「同一个 turn 内改」
  assert.match(rejected, /limitations/);
  assert.match(rejected, /too_small|Too small/);
  assert.equal(capture.captured(), undefined);
  assert.doesNotThrow(() => capture.assertOpen());
  // 参数写错时这一轮不能收束，否则模型没有机会改
  assert.deepEqual(capture.toolUseBehavior(), { isFinalOutput: false, isInterrupted: undefined });

  const accepted = await call(capture, artifact);
  assert.deepEqual(accepted, { recorded: true });
  assert.equal((capture.captured()!.value as { summary: string }).summary, artifact.summary);
  // 捕获成功才收束本轮 —— 这是 dsh concludeTurn() 的等价物
  assert.equal(capture.toolUseBehavior().isFinalOutput, true);
  assert.throws(() => capture.assertOpen(), /no further searches/);
});

test("Research Artifact 必须明确研究对象、范围、变量与知识缺口", () => {
  const parsed = researchProposalSchema.safeParse({
    ...artifact,
    research_framing: {
      research_object: "科研 Agent 的证据归因机制",
      scope: "固定模型和问题集下的引用可靠性",
      variables: [
        { name: "证据门条件", role: "independent", operationalization: "是否启用冻结 evidence_id 校验" },
        { name: "无来源引用率", role: "dependent", operationalization: "未绑定冻结证据的引用数除以引用总数" },
      ],
      known: ["冻结证据 ID 可以被确定性验收。"],
      controversies: ["提示词约束是否足以替代代码持有的证据归因仍有争议。"],
      unknowns: ["证据门对跨问题任务完成率的影响未知。"],
      knowledge_gap: "缺少在相同问题和模型条件下对证据归因机制的配对比较。",
      constraints: ["不能把候选假设写成已证实结论。"],
    },
  });

  assert.equal(parsed.success, true);
  if (parsed.success) assert.equal(parsed.data.research_framing.variables.length, 2);
});

test("a second report after capture is refused instead of overwriting", async () => {
  const capture = createStructuredOutput(researchProposalSchema);
  capture.beginRound();
  await call(capture, artifact);

  const refused = String(await call(capture, { ...artifact, summary: "第二份产物" }));
  assert.match(refused, /already recorded/);
  // 拒绝只是拒绝：既不改写已提交的值，也不把 Attempt 打死
  assert.equal((capture.captured()!.value as { summary: string }).summary, artifact.summary);

  // 纠错轮要另开一次上报窗口，否则第二次上报会被同一条守卫拒掉
  capture.beginRound();
  assert.equal(capture.captured(), undefined);
  await call(capture, { ...artifact, summary: "纠错后的产物" });
  assert.equal((capture.captured()!.value as { summary: string }).summary, "纠错后的产物");
});

test("finishing without calling the tool is a contract violation, not a correction", async () => {
  const context: TaskContext = {
    runId: "run",
    taskId: "attempt",
    role: "researcher",
    goal: "检索并冻结证据",
    question: "问题",
    inputArtifactIds: [],
    inputArtifacts: [],
  };
  let calls = 0;
  // 模型自称完成：交回一段纯文本，一次工具都没调
  const execute: StageExecutor = () => {
    calls += 1;
    return Promise.resolve("我已经完成了研究，结论见上文。");
  };

  const failure = await runTask(context, { execute, ledger: new EvidenceLedger() }).then(
    () => null,
    (error: unknown) => error,
  );

  assert.equal(calls, 1, "不做隐式重跑：这一类不再花一次调用去说同一句话");
  assert.equal(classifyFailure(failure).code, "invalid_output");
  assert.match((failure as Error).message, new RegExp(STRUCTURED_OUTPUT_TOOL));
});

test.each(["research-plan", "hypothesis-generation", "evidence-review"] as const)(
  "%s must submit through its structured output tool",
  async (role) => {
    const context: TaskContext = {
      runId: "run",
      taskId: "plan-attempt",
      role,
      goal: "形成研究计划",
      question: "问题",
      inputArtifactIds: [],
      inputArtifacts: [],
    };
    let calls = 0;
    const failure = await runTask(context, {
      execute: () => {
        calls += 1;
        return Promise.resolve("研究计划已经完成。");
      },
    }).then(
      () => null,
      (error: unknown) => error,
    );

    assert.equal(calls, 1);
    assert.equal(classifyFailure(failure).code, "invalid_output");
    assert.match((failure as Error).message, new RegExp(STRUCTURED_OUTPUT_TOOL));
  },
);

test("a primitive executor failure is normalized without hiding the original failure", async () => {
  const context: TaskContext = {
    runId: "run",
    taskId: "attempt",
    role: "reviewer",
    goal: "review",
    question: "问题",
    inputArtifactIds: [],
    inputArtifacts: [],
  };

  const failure = await runTask(context, {
    execute: () => Promise.reject("provider disconnected"),
  }).then(
    () => null,
    (error: unknown) => error,
  );

  assert.ok(failure instanceof Error);
  assert.equal(failure.message, "provider disconnected");
  assert.equal((failure as { corrections?: number }).corrections, 0);
});

/** Phase A 只读诊断（n=46）里 researcher 撞死的那条序列：两次 arxiv、三次 crossref、
 *  上报一次被 zod 驳回、改对再报一次。关掉并发工具调用之后，每一步各占一个 turn ——
 *  7 > 6，于是 18 个 failed 里有 15 个是同一句 `reached the Agent turn limit`。 */
const RESEARCHER_TURNS_THAT_USED_TO_DIE = 2 + 3 + 1 + 1;

test("the turn budget keeps researcher headroom while reviewer has a restricted retrieval surface", () => {
  const { agents } = createRoles(new EvidenceLedger());

  for (const role of roleSchema.options) {
    const agent = agents[role];
    assert.ok(agent.tools.some((tool) => tool.name === STRUCTURED_OUTPUT_TOOL));
    assert.equal(maxTurnsFor(role), role === "researcher" ? 12 : 6);
    if (role !== "researcher" && role !== "reviewer") {
      assert.deepEqual(
        agent.tools.map((tool) => tool.name),
        [STRUCTURED_OUTPUT_TOOL],
      );
    }
  }

  // 预算的意义在这一条：检索 5 + 上报 1 之后，每一步都还能错一次。
  assert.ok(
    maxTurnsFor("researcher") > RESEARCHER_TURNS_THAT_USED_TO_DIE,
    "researcher 的预算必须容得下「查满 + 上报 + 修正」，否则改了等于没改",
  );
});

test("context overflow is recognised across provider wordings", () => {
  for (const detail of [
    "This model's maximum context length is 131072 tokens, however you requested 140000 tokens",
    "context_length_exceeded: please reduce the length of the messages",
    "Range of input length should be [1, 129024] — the request is too long for this model",
    "prompt is too large for the model's context window",
    "input exceeds the model context length",
  ]) {
    assert.equal(isContextOverflow(detail), true, detail);
  }
  // 不能宽泛到吞掉别的失败：这两条都不是上下文超长
  assert.equal(isContextOverflow("Connection error: fetch failed"), false);
  assert.equal(isContextOverflow("tool argument string too long"), false);
});

test.each(["researcher", "reviewer"] as const)(
  "%s refuses sibling searches after capture even when the provider ignores parallelToolCalls",
  async (role) => {
    const ledger = new EvidenceLedger();
    ledger.beginScope("capture-boundary");
    const roles = createRoles(ledger);
    const agent = roles.agents[role];
    const report =
      role === "researcher"
        ? artifact
        : {
            artifact_type: "review",
            research_plan_artifact_id: "plan",
            evidence_review_artifact_id: "evidence-review",
            independent_evidence_ids: ["frozen-search"],
            scores: { scientific_value: 3, technical_depth: 3, application_potential: 3 },
            weaknesses: [],
            feedback: [],
            suggested_successor_roles: [],
            accepted: true,
          };
    let requests = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () => {
      requests += 1;
      return Promise.reject(new Error("No network is permitted in this test"));
    };
    const model: Model = {
      getResponse(): Promise<ModelResponse> {
        return Promise.resolve({
          usage: new Usage(),
          output: [
            {
              type: "function_call",
              id: "report",
              callId: "report",
              name: "structured_output",
              arguments: JSON.stringify(report),
              status: "completed",
            },
            {
              type: "function_call",
              id: "late-search",
              callId: "late-search",
              name: "crossref_search",
              arguments: JSON.stringify({ query: "late query" }),
              status: "completed",
            },
          ],
        });
      },
      getStreamedResponse() {
        throw new Error("No streaming in this test");
      },
    };
    try {
      assert.equal(agent.modelSettings.parallelToolCalls, false);
      const result = await createQwenExecutor(undefined, { getModel: () => model })({
        runId: "capture-boundary",
        role,
        agent,
        input: "{}",
        timeoutMs: 5_000,
      });
      assert.equal(result, "structured output recorded");
      assert.equal(requests, 0);
      assert.equal(ledger.scopedRecords().length, 0);
      const capture = roles.captures[role];
      assert.deepEqual(capture.captured()!.value, report);
    } finally {
      globalThis.fetch = originalFetch;
    }
  },
);

test("reopening reviewer capture does not replenish its two-search Attempt budget", async () => {
  const ledger = new EvidenceLedger();
  ledger.beginScope("reviewer-budget");
  const { agents, captures } = createRoles(ledger);
  const searches = agents.reviewer.tools.filter((item) => item.name.endsWith("_search"));
  let requests = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    requests += 1;
    return Promise.reject(new Error("No network is permitted in this test"));
  };
  try {
    for (const search of searches) {
      assert.equal(search.type, "function");
      if (search.type !== "function") throw new Error("Expected a function tool");
      await search.invoke(new RunContext(), JSON.stringify({ query: "counterevidence" }));
    }
    assert.equal(requests, 2);
    captures.reviewer.beginRound();
    const search = searches[0]!;
    if (search.type !== "function") throw new Error("Expected a function tool");
    const rejected = await search.invoke(new RunContext(), JSON.stringify({ query: "extra query" }));
    assert.match(String(rejected), /search budget exhausted/);
    assert.equal(requests, 2);
    assert.equal(ledger.scopedRecords().length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test.each([true, false])(
  "research citation correction reaches the real Runner for all invalid ids (repair %s)",
  async (repair) => {
    const search = vi.spyOn(crossref, "searchCrossref").mockImplementation(async (query) => ({
      query,
      status: "succeeded",
      resultSummary: "two frozen records",
      execution: {},
      records: [1, 2].map((n) => ({
        doi: `10.1234/source${n}`,
        title: `Frozen source ${n}`,
        url: `https://doi.org/10.1234/source${n}`,
        authors: ["Ada Lovelace"],
        published: "2024-1-1",
        container: "Journal of Fixtures",
      })),
    }));
    const ledger = new EvidenceLedger({ namespace: "citation_correction_" });
    let modelCalls = 0;
    let stageCalls = 0;
    let correction: any;
    const model: Model = {
      async getResponse(request): Promise<ModelResponse> {
        modelCalls += 1;
        if (modelCalls === 3) {
          const modelText =
            typeof request.input === "string"
              ? request.input
              : request.input
                  .flatMap((item) =>
                    item.type === "message" && item.role === "user"
                      ? typeof item.content === "string"
                        ? [item.content]
                        : item.content.flatMap((part) => (part.type === "input_text" ? [part.text] : []))
                      : [],
                  )
                  .join("\n");
          correction = JSON.parse(modelText);
          assert.equal(correction.citation_errors.length, 2, "the SDK must deliver the feedback to the model request");
        }
        const searching = modelCalls === 1;
        const record = ledger.scopedRecords()[0];
        const value = searching
          ? { query: "evidence attribution" }
          : {
              ...artifact,
              citations: record!.citations.map((item, index) => ({
                ...item,
                evidence_id:
                  modelCalls === 3 && repair
                    ? correction.citation_errors[index].matching_evidence_ids[0]
                    : `ev_wrong_${index}_web`,
              })),
              claims: [
                {
                  statement: "冻结资料提供待检验假设的依据。",
                  evidence_ids:
                    modelCalls === 3 && repair
                      ? correction.claim_errors.map((item: any) => item.matching_evidence_ids[0])
                      : ["doi:10.1234/source1", "doi:10.1234/source2"],
                },
              ],
            };
        return {
          usage: new Usage(),
          output: [
            {
              type: "function_call",
              id: `call_${modelCalls}`,
              callId: `call_${modelCalls}`,
              name: searching ? "crossref_search" : STRUCTURED_OUTPUT_TOOL,
              arguments: JSON.stringify(value),
              status: "completed",
            },
          ],
        };
      },
      getStreamedResponse() {
        throw new Error("No streaming in this test");
      },
    };
    const execute = createQwenExecutor(undefined, { getModel: () => model });
    try {
      const task = runTask(
        {
          runId: "citation-correction",
          taskId: "citation-correction",
          role: "researcher",
          goal: "查证后上报",
          question: "问题",
          inputArtifactIds: [],
          inputArtifacts: [],
        },
        {
          ledger,
          execute: async (request) => {
            stageCalls += 1;
            if (stageCalls === 2) {
              correction = JSON.parse(request.input);
              assert.deepEqual(
                correction.citation_errors,
                [0, 1].map((index) => ({
                  citation_index: index,
                  reported_evidence_id: `ev_wrong_${index}_web`,
                  locator: `doi:10.1234/source${index + 1}`,
                  reason: "unknown_search",
                  matching_evidence_ids: [ledger.scopedRecords()[0]!.evidenceId],
                })),
                "one correction must expose every citation error, not just the first",
              );
              assert.equal(correction.rejected_candidate.citations.length, 2);
              assert.equal(correction.frozen_searches.length, 1);
              assert.deepEqual(
                correction.claim_errors,
                [0, 1].map((index) => ({
                  claim_index: 0,
                  evidence_index: index,
                  reported_evidence_id: `doi:10.1234/source${index + 1}`,
                  matching_evidence_ids: [ledger.scopedRecords()[0]!.evidenceId],
                })),
                "claim and citation mistakes must be returned together within the one correction",
              );
            }
            return execute(request);
          },
        },
      );
      if (repair) {
        const result = await task;
        assert.equal(result.corrections, 1);
        assert.equal(result.artifact.artifact_type, "research");
        assert.ok(!JSON.stringify(result.artifact).includes("ev_wrong_"));
      } else {
        await assert.rejects(task, (error: unknown) => classifyFailure(error).code === "invalid_output");
      }
      assert.equal(stageCalls, 2, "there is no third correction or bypass of the citation gate");
      assert.equal(modelCalls, 3);
      assert.equal(search.mock.calls.length, 1, "correction reuses the frozen search");
    } finally {
      search.mockRestore();
    }
  },
);

test.each(["missing", "ambiguous", "wrong-search", "previous-attempt"] as const)(
  "citation feedback preserves rejection for %s provenance",
  async (mode) => {
    const ledger = new EvidenceLedger();
    const prior = ledger.record({
      tool: "arxiv_search",
      sourceType: "arxiv",
      query: "previous attempt only",
      status: "succeeded",
      resultSummary: "old source",
      citations: [{ ...artifact.citations[0]!, source_type: "arxiv" }],
    });
    let calls = 0;
    const task = runTask(
      {
        runId: "provenance",
        taskId: "provenance",
        role: "researcher",
        goal: "检查引用",
        question: "问题",
        inputArtifactIds: [],
        inputArtifacts: [],
      },
      {
        ledger,
        execute: async ({ agent, input }) => {
          calls += 1;
          if (calls === 1) {
            ledger.record({
              tool: "arxiv_search",
              sourceType: "arxiv",
              query: "source",
              status: "succeeded",
              resultSummary: "one source",
              citations: [
                {
                  ...artifact.citations[0]!,
                  source_type: "arxiv",
                  locator: mode === "previous-attempt" ? "arxiv:2301.00002v1" : artifact.citations[0]!.locator,
                },
              ],
            });
            if (mode === "ambiguous")
              ledger.record({
                tool: "arxiv_search",
                sourceType: "arxiv",
                query: "same source again",
                status: "succeeded",
                resultSummary: "same source",
                citations: [{ ...artifact.citations[0]!, source_type: "arxiv" }],
              });
          } else {
            const feedback = JSON.parse(input).citation_errors[0];
            assert.deepEqual(
              feedback.matching_evidence_ids,
              mode === "ambiguous" ? ledger.scopedRecords().map((r) => r.evidenceId) : [],
            );
            assert.equal(feedback.reason, mode === "wrong-search" ? "locator_not_returned" : "unknown_search");
          }
          return reportStructuredOutput(agent, {
            ...artifact,
            citations: [
              {
                ...artifact.citations[0],
                evidence_id:
                  mode === "previous-attempt"
                    ? prior.evidenceId
                    : mode === "wrong-search"
                      ? ledger.scopedRecords()[0]!.evidenceId
                      : "ev_unregistered_arxiv",
                locator:
                  mode === "ambiguous" || mode === "previous-attempt"
                    ? artifact.citations[0]!.locator
                    : "arxiv:9999.99999v1",
              },
            ],
          });
        },
      },
    );
    await assert.rejects(task, (error: unknown) => classifyFailure(error).code === "invalid_output");
    assert.equal(calls, 2, "hints cannot publish an invalid artifact or add another correction");
  },
);
