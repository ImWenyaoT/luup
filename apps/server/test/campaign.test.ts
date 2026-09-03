import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onTestFinished, test } from "vitest";

type TestContext = { onTestFinished: typeof onTestFinished };

import {
  CampaignMemory,
  ENTRY_PREFIX,
  formatLogEntry,
  formatQuestionEntry,
  referenceLabel,
  type CampaignFacts,
} from "../src/campaign/campaign.ts";
import { StageError } from "../src/agent/failures.ts";
import { createDeterministicRuntime, createDeterministicVerifier } from "../src/executor-deterministic.ts";
import { Harness } from "../src/harness.ts";
import type { StageExecutor } from "../src/roles.ts";
import { SqliteStore } from "../src/store/store.ts";

const NOW = new Date("2026-08-14T09:15:30.500Z");

function memoryDir(t: TestContext, seedExisting = ""): string {
  const dir = mkdtempSync(join(tmpdir(), "luup-memory-"));
  t.onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  if (seedExisting) {
    mkdirSync(join(dir, "questions"), { recursive: true });
    writeFileSync(join(dir, "questions", "q7.md"), seedExisting, "utf8");
  }
  return dir;
}

const facts = (overrides: Partial<CampaignFacts> = {}): CampaignFacts => ({
  runId: "run7a",
  questionId: 7,
  status: "completed",
  failureCode: null,
  title: "论文标题",
  references: ["https://arxiv.org/abs/2301.00001v1", "https://doi.org/10.1000/xyz"],
  ...overrides,
});

const open = (t: TestContext, dir: string) =>
  new CampaignMemory({ memoryDir: dir, locate: (runId) => `outputs/runs.db#${runId}` });

test("a campaign line carries verdict, title, references and failure class", () => {
  assert.equal(
    formatQuestionEntry(facts(), NOW),
    `${ENTRY_PREFIX}2026-08-14T09:15:30Z] SUCCESS | run run7a | 论文标题｜引用 2301.00001v1, https://doi.org/10.1000/xyz\n`,
  );
  assert.equal(
    formatQuestionEntry(facts({ status: "failed", failureCode: "verifier_refs", title: null, references: [] }), NOW),
    `${ENTRY_PREFIX}2026-08-14T09:15:30Z] FAILED | run run7a | 未产出 research-plan｜cls=verifier_refs\n`,
  );
  // 被拒的计划不是交付。格式串仍可生成 FAILED；写入路径不再把它追加到题页。
  assert.match(
    formatQuestionEntry(facts({ status: "review_rejected", failureCode: "review_rejected" }), NOW),
    /FAILED \| run run7a \| 论文标题｜引用 2301\.00001v1.*｜cls=review_rejected/,
  );
});

test("the run log entry is repo-relative and dated, never an absolute path", () => {
  assert.equal(
    formatLogEntry(facts(), "outputs/runs.db#run7a", NOW),
    "\n## [2026-08-14] run | q7 | SUCCESS\n" +
      "- outputs/runs.db#run7a｜论文标题｜引用 2301.00001v1, https://doi.org/10.1000/xyz\n",
  );
  // 自由输入没有题号，仍进总日志，标 q-。
  assert.match(formatLogEntry(facts({ questionId: null }), "x#y", NOW), /run \| q- \| SUCCESS/);
});

test("references shrink to arXiv ids and anything else stays verbatim", () => {
  assert.equal(referenceLabel("https://arxiv.org/abs/2301.00001v1"), "2301.00001v1");
  assert.equal(referenceLabel("arxiv:hep-th/9901001"), "hep-th/9901001");
  assert.equal(referenceLabel("https://doi.org/10.1000/xyz"), "https://doi.org/10.1000/xyz");
});

test("completed appends SUCCESS to the question page; failures only hit the audit log", () => {
  const t = { onTestFinished };
  const dir = memoryDir(t);
  const memory = open(t, dir);

  memory.recordRun(facts(), NOW);
  memory.recordRun(facts({ runId: "run7b", status: "failed", failureCode: "infra_error", title: null }), NOW);
  memory.recordRun(facts({ runId: "run7c", status: "review_rejected", failureCode: "review_rejected" }), NOW);

  const page = readFileSync(join(dir, "questions", "q7.md"), "utf8");
  assert.match(page, /^# q7\n/, "新题页要有种子抬头");
  assert.match(page, /append-only/);
  const pageLines = page.split("\n").filter((line) => line.startsWith(ENTRY_PREFIX));
  assert.equal(pageLines.length, 1, "失败 / review_rejected 不得进注入题页");
  assert.match(pageLines[0]!, /SUCCESS \| run run7a/);
  assert.doesNotMatch(page, /FAILED/);

  const log = readFileSync(join(dir, "log.md"), "utf8");
  assert.equal(log.split("## [").length - 1, 3, "审计日志仍记全量终态");
  assert.match(log, /q7 \| FAILED/);
  assert.match(log, /q7 \| SUCCESS/);
});

test("existing campaign history is appended to, never rewritten", () => {
  const t = { onTestFinished };
  const history = "# q7\n\n- [2026-08-13T00:00:00Z] FAILED | run older | 旧结论\n";
  const dir = memoryDir(t, history);

  open(t, dir).recordRun(facts(), NOW);

  const page = readFileSync(join(dir, "questions", "q7.md"), "utf8");
  assert.ok(page.startsWith(history), "历史行必须逐字保留");
  assert.match(page, /run run7a/);
});

test("a run without a question id writes the log but no question page", () => {
  const t = { onTestFinished };
  const dir = memoryDir(t);
  open(t, dir).recordRun(facts({ questionId: null }), NOW);

  assert.match(readFileSync(join(dir, "log.md"), "utf8"), /q- \| SUCCESS/);
  assert.throws(() => readFileSync(join(dir, "questions", "q7.md"), "utf8"));
});

test("prior attempts return only SUCCESS lines, ignoring legacy FAILED on disk", () => {
  const t = { onTestFinished };
  const dir = memoryDir(
    t,
    [
      "# q7",
      "",
      "散文行，不是记录，读取端不能把它当条目",
      "- [2026-08-01T00:00:00Z] FAILED | run a | 一",
      "- [2026-08-02T00:00:00Z] SUCCESS | run b | 二",
      "- [2026-08-03T00:00:00Z] FAILED | run c | 三",
      "- [2026-08-04T00:00:00Z] SUCCESS | run d | 四",
      "- [2026-08-05T00:00:00Z] SUCCESS | run e | 五",
      "- [2026-08-06T00:00:00Z] FAILED | run f | 六",
      "- [2026-08-07T00:00:00Z] SUCCESS | run g | 七",
      "",
    ].join("\n"),
  );
  const memory = open(t, dir);

  const prior = memory.readPriorAttempts(7);
  assert.equal(prior.status, "available");
  assert.equal(prior.entries.length, 3, "上限仍是末 3 条 SUCCESS");
  assert.match(prior.entries[0]!, /run d/);
  assert.match(prior.entries[1]!, /run e/);
  assert.match(prior.entries[2]!, /run g/);
  assert.ok(prior.entries.every((line) => line.includes("] SUCCESS |")));
  assert.ok(prior.entries.every((line) => !line.includes("FAILED")));

  // 题页上只有 FAILED 遗留行：注入面为空，不改写磁盘。
  const failedOnlyDir = memoryDir(t, "# q7\n\n- [2026-08-01T00:00:00Z] FAILED | run x | 旧失败\n");
  assert.deepEqual(open(t, failedOnlyDir).readPriorAttempts(7), {
    status: "empty",
    entries: [],
    reason: null,
  });
  assert.match(readFileSync(join(failedOnlyDir, "questions", "q7.md"), "utf8"), /FAILED \| run x/);

  // 没跑过的题、没有题号的 run：空数组，不是异常。
  assert.deepEqual(memory.readPriorAttempts(99), { status: "empty", entries: [], reason: null });
  assert.deepEqual(memory.readPriorAttempts(null), { status: "not_applicable", entries: [], reason: null });
});

test("deleting the memory directory disables the channel instead of breaking the run", () => {
  const t = { onTestFinished };
  const dir = memoryDir(t);
  const memory = open(t, dir);
  rmSync(dir, { recursive: true, force: true });

  assert.deepEqual(memory.readPriorAttempts(7), { status: "disabled", entries: [], reason: null });
  assert.deepEqual(memory.recordRun(facts(), NOW), { status: "disabled", reason: null });
  assert.throws(() => readFileSync(join(dir, "log.md"), "utf8"), "目录没了就一个字都不写");
});

test("a campaign read failure is reported and never overwrites unreadable history", () => {
  const t = { onTestFinished };
  const dir = memoryDir(t);
  mkdirSync(join(dir, "log.md"));
  mkdirSync(join(dir, "questions"), { recursive: true });
  mkdirSync(join(dir, "questions", "q7.md"));
  const errors: unknown[] = [];
  const memory = new CampaignMemory({
    memoryDir: dir,
    locate: (runId) => `outputs/runs.db#${runId}`,
    reportError: (error) => errors.push(error),
  });

  assert.deepEqual(memory.readPriorAttempts(7), { status: "unavailable", entries: [], reason: "Error:EISDIR" });
  assert.deepEqual(memory.recordRun(facts(), NOW), {
    status: "unavailable",
    reason: "Error:EISDIR,Error:EISDIR",
  });

  assert.equal(errors.length, 3);
  assert.equal(statSync(join(dir, "log.md")).isDirectory(), true);
  assert.equal(statSync(join(dir, "questions", "q7.md")).isDirectory(), true);
});

test("campaign I/O degradation is explicit and never rewrites a successful run terminal", async () => {
  const t = { onTestFinished };
  const dir = memoryDir(t);
  mkdirSync(join(dir, "log.md"));
  mkdirSync(join(dir, "questions"), { recursive: true });
  const store = new SqliteStore(":memory:");
  t.onTestFinished(() => store.close());
  const runtime = createDeterministicRuntime(store);
  const runId = store.createRun("问题", { science125Id: 7 });

  const outcome = await new Harness(store, runtime.execute, {
    createLedger: runtime.createLedger,
    verifyReferences: createDeterministicVerifier(),
    memory: open(t, dir),
  }).execute(runId);

  assert.equal(outcome.status, "completed");
  assert.equal(store.snapshot(runId)!.status, "completed");
  const events = store.eventsAfter(runId, 0);
  assert.deepEqual(
    events.filter((event) => event.kind === "campaign.memory_degraded").map((event) => event.payload),
    [{ phase: "write", status: "unavailable", reason: "Error:EISDIR" }],
  );
  assert.deepEqual(events.find((event) => event.kind === "campaign.prior_attempts")?.payload, {
    question_id: 7,
    count: 0,
  });
});

// --- Harness 接线 -------------------------------------------------------

/** 一个立刻在 researcher 阶段失败的执行器；只用来观察注入与记账，不跑完流水线。 */
function capturing(): { execute: StageExecutor; inputs: Array<Record<string, unknown>> } {
  const inputs: Array<Record<string, unknown>> = [];
  return {
    inputs,
    execute: ({ input }) => {
      inputs.push(JSON.parse(input));
      return Promise.reject(new StageError("provider_error", "够了"));
    },
  };
}

test("the researcher input carries prior attempts after the stable prefix", async () => {
  const t = { onTestFinished };
  const dir = memoryDir(t, "# q7\n\n- [2026-08-01T00:00:00Z] SUCCESS | run a | 已交付线索\n");
  const store = new SqliteStore(":memory:");
  t.onTestFinished(() => store.close());
  const { execute, inputs } = capturing();

  const runId = store.createRun("问题", { science125Id: 7 });
  await new Harness(store, execute, { memory: open(t, dir) }).execute(runId);

  assert.deepEqual(inputs[0]!.prior_attempts, ["- [2026-08-01T00:00:00Z] SUCCESS | run a | 已交付线索"]);
  // 前缀稳定：记忆接在 input_artifacts 之后、纠错材料之前。
  assert.deepEqual(Object.keys(inputs[0]!), ["question", "goal", "input_artifacts", "prior_attempts"]);
});

test("the ablation arm injects nothing and the fact is on the record", async () => {
  const t = { onTestFinished };
  const dir = memoryDir(t, "# q7\n\n- [2026-08-01T00:00:00Z] FAILED | run a | 走死过的路\n");
  const store = new SqliteStore(":memory:");
  t.onTestFinished(() => store.close());
  const { execute, inputs } = capturing();

  const runId = store.createRun("问题", { science125Id: 7, memoryArm: "off" });
  await new Harness(store, execute, { memory: null }).execute(runId);

  assert.equal("prior_attempts" in inputs[0]!, false, "off 臂的 input 前缀与无记忆时逐字节相同");
  const injected = store.eventsAfter(runId, 0).find((event) => event.kind === "campaign.prior_attempts");
  assert.deepEqual(injected?.payload, { question_id: 7, count: 0 });
  assert.equal(store.snapshot(runId)!.memory_arm, "off");
  // 消融臂一行都不写回。
  assert.throws(() => readFileSync(join(dir, "log.md"), "utf8"));
});

test("a failed run still audits to the log but does not enlarge the inject page", async () => {
  const t = { onTestFinished };
  const seed = "# q7\n\n- [2026-08-01T00:00:00Z] SUCCESS | run a | 一\n- [2026-08-02T00:00:00Z] FAILED | run b | 二\n";
  const dir = memoryDir(t, seed);
  const store = new SqliteStore(":memory:");
  t.onTestFinished(() => store.close());

  const runId = store.createRun("问题", { science125Id: 7, memoryArm: "on" });
  await new Harness(store, capturing().execute, { memory: open(t, dir) }).execute(runId);

  const injected = store.eventsAfter(runId, 0).find((event) => event.kind === "campaign.prior_attempts");
  assert.deepEqual(injected?.payload, { question_id: 7, count: 1 }, "只注入 SUCCESS");
  // 失败进审计日志，不追加 FAILED 到题页。
  assert.match(readFileSync(join(dir, "log.md"), "utf8"), /FAILED/);
  const page = readFileSync(join(dir, "questions", "q7.md"), "utf8");
  assert.equal(page, seed, "题页保持种子内容，无新 FAILED 行");
});
