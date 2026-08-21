import assert from "node:assert/strict";
import { test } from "bun:test";

import { RunContext } from "@openai/agents";

import { researchProposalSchema, roleSchema } from "../src/agent/contracts.ts";
import { EvidenceLedger } from "../src/agent/evidence.ts";
import { classifyFailure } from "../src/agent/failures.ts";
import { createRoles } from "../src/agent/roles/index.ts";
import { createStructuredOutput, STRUCTURED_OUTPUT_TOOL } from "../src/agent/roles/structured-output.ts";
import { isContextOverflow, maxTurnsFor } from "../src/executor.ts";
import { runTask, type StageExecutor } from "../src/roles.ts";
import type { TaskContext } from "../src/store/contracts.ts";

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
  // 参数写错时这一轮不能收束，否则模型没有机会改
  assert.deepEqual(capture.toolUseBehavior(), { isFinalOutput: false, isInterrupted: undefined });

  const accepted = await call(capture, artifact);
  assert.deepEqual(accepted, { recorded: true });
  assert.equal((capture.captured()!.value as { summary: string }).summary, artifact.summary);
  // 捕获成功才收束本轮 —— 这是 dsh concludeTurn() 的等价物
  assert.equal(capture.toolUseBehavior().isFinalOutput, true);
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

test("a research planner must submit through its structured output tool", async () => {
  const context: TaskContext = {
    runId: "run",
    taskId: "plan-attempt",
    role: "research-plan",
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
});

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
    if (agent.tools.length === 0) {
      // 无工具角色产物即最终输出，正常路径一个 turn 就结束：6 已是宽松余量，
      // 抬高它救不回任何一次失败，只会在模型空转时多烧几轮 token 才撞同一堵墙。
      assert.equal(maxTurnsFor(role), 6, `${role} 无工具，不该分到检索余量`);
    } else if (role === "researcher") {
      assert.equal(maxTurnsFor(role), 12);
    } else {
      assert.ok(role === "reviewer" || role === "research-plan");
      // Reviewer 做受限检索；ResearchPlan 用合成工具上报。两者 6 turns 都有修正余量。
      assert.equal(maxTurnsFor(role), 6);
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
