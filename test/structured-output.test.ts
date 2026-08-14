import assert from "node:assert/strict";
import test from "node:test";

import { RunContext } from "@openai/agents";

import { researchProposalSchema } from "../src/agent/contracts.ts";
import { EvidenceLedger } from "../src/agent/evidence.ts";
import { classifyFailure } from "../src/agent/failures.ts";
import { createStructuredOutput, STRUCTURED_OUTPUT_TOOL } from "../src/agent/roles/structured-output.ts";
import { isContextOverflow } from "../src/executor.ts";
import { runTask, type StageExecutor } from "../src/roles.ts";
import type { TaskContext } from "../src/store/contracts.ts";

const artifact = {
  artifact_type: "research",
  question: "问题",
  summary: "冻结证据支撑一条可审计的论断。",
  claims: [{ statement: "证据门提升可审计性。", evidence_ids: ["ev_01_arxiv"] }],
  queries: [{
    evidence_id: "ev_01_arxiv",
    source_type: "arxiv",
    query: "evidence gate",
    status: "succeeded",
    result_summary: "arXiv returned 1 citable record(s)",
  }],
  citations: [{
    evidence_id: "ev_01_arxiv",
    source_type: "arxiv",
    title: "Fixture source",
    locator: "arxiv:2301.00001v1",
    url: "https://arxiv.org/abs/2301.00001v1",
  }],
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

  const failure = await runTask(context, { execute, ledger: new EvidenceLedger() })
    .then(() => null, (error: unknown) => error);

  assert.equal(calls, 1, "不做隐式重跑：这一类不再花一次调用去说同一句话");
  assert.equal(classifyFailure(failure).code, "invalid_output");
  assert.match((failure as Error).message, new RegExp(STRUCTURED_OUTPUT_TOOL));
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
