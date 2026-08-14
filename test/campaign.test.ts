import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import {
  CampaignMemory,
  ENTRY_PREFIX,
  formatLogEntry,
  formatQuestionEntry,
  referenceLabel,
  type CampaignFacts,
} from "../src/campaign/campaign.ts";
import { StageError } from "../src/agent/failures.ts";
import { Harness } from "../src/harness.ts";
import type { StageExecutor } from "../src/roles.ts";
import { SqliteStore } from "../src/store/store.ts";

const NOW = new Date("2026-08-14T09:15:30.500Z");

function memoryDir(t: TestContext, seedExisting = ""): string {
  const dir = mkdtempSync(join(tmpdir(), "luup-memory-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
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
  // 被拒的计划不是交付。它的标题与引用仍要记下来，下一次才知道这条路走过。
  assert.match(
    formatQuestionEntry(facts({ status: "review_rejected", failureCode: "review_rejected" }), NOW),
    /FAILED \| run run7a \| 论文标题｜引用 2301\.00001v1.*｜cls=review_rejected/,
  );
});

test("the run log entry is repo-relative and dated, never an absolute path", () => {
  assert.equal(
    formatLogEntry(facts(), "outputs/runs.db#run7a", NOW),
    "\n## [2026-08-14] run | q7 | SUCCESS\n"
    + "- outputs/runs.db#run7a｜论文标题｜引用 2301.00001v1, https://doi.org/10.1000/xyz\n",
  );
  // 自由输入没有题号，仍进总日志，标 q-。
  assert.match(formatLogEntry(facts({ questionId: null }), "x#y", NOW), /run \| q- \| SUCCESS/);
});

test("references shrink to arXiv ids and anything else stays verbatim", () => {
  assert.equal(referenceLabel("https://arxiv.org/abs/2301.00001v1"), "2301.00001v1");
  assert.equal(referenceLabel("arxiv:hep-th/9901001"), "hep-th/9901001");
  assert.equal(referenceLabel("https://doi.org/10.1000/xyz"), "https://doi.org/10.1000/xyz");
});

test("recording a run appends to both the log and the question page", (t) => {
  const dir = memoryDir(t);
  const memory = open(t, dir);

  memory.recordRun(facts(), NOW);
  memory.recordRun(facts({ runId: "run7b", status: "failed", failureCode: "infra_error", title: null }), NOW);

  const page = readFileSync(join(dir, "questions", "q7.md"), "utf8");
  assert.match(page, /^# q7\n/, "新题页要有种子抬头");
  assert.match(page, /append-only/);
  assert.equal(page.split("\n").filter((line) => line.startsWith(ENTRY_PREFIX)).length, 2);
  assert.equal(readFileSync(join(dir, "log.md"), "utf8").split("## [").length - 1, 2);
});

test("existing campaign history is appended to, never rewritten", (t) => {
  const history = "# q7\n\n- [2026-08-13T00:00:00Z] FAILED | run older | 旧结论\n";
  const dir = memoryDir(t, history);

  open(t, dir).recordRun(facts(), NOW);

  const page = readFileSync(join(dir, "questions", "q7.md"), "utf8");
  assert.ok(page.startsWith(history), "历史行必须逐字保留");
  assert.match(page, /run run7a/);
});

test("a run without a question id writes the log but no question page", (t) => {
  const dir = memoryDir(t);
  open(t, dir).recordRun(facts({ questionId: null }), NOW);

  assert.match(readFileSync(join(dir, "log.md"), "utf8"), /q- \| SUCCESS/);
  assert.throws(() => readFileSync(join(dir, "questions", "q7.md"), "utf8"));
});

test("prior attempts are the last three deterministic lines of the question page", (t) => {
  const dir = memoryDir(t, [
    "# q7",
    "",
    "散文行，不是记录，读取端不能把它当条目",
    "- [2026-08-01T00:00:00Z] FAILED | run a | 一",
    "- [2026-08-02T00:00:00Z] FAILED | run b | 二",
    "- [2026-08-03T00:00:00Z] SUCCESS | run c | 三",
    "- [2026-08-04T00:00:00Z] FAILED | run d | 四",
    "",
  ].join("\n"));
  const memory = open(t, dir);

  const prior = memory.readPriorAttempts(7);
  assert.equal(prior.length, 3);
  assert.match(prior[0]!, /run b/);
  assert.match(prior[2]!, /run d/);
  assert.equal(memory.readPriorAttempts(7, 1).length, 1);
  // 没跑过的题、没有题号的 run：空数组，不是异常。
  assert.deepEqual(memory.readPriorAttempts(99), []);
  assert.deepEqual(memory.readPriorAttempts(null), []);
});

test("deleting the memory directory disables the channel instead of breaking the run", (t) => {
  const dir = memoryDir(t);
  const memory = open(t, dir);
  rmSync(dir, { recursive: true, force: true });

  assert.deepEqual(memory.readPriorAttempts(7), []);
  memory.recordRun(facts(), NOW);
  assert.throws(() => readFileSync(join(dir, "log.md"), "utf8"), "目录没了就一个字都不写");
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

test("the researcher input carries prior attempts after the stable prefix", async (t) => {
  const dir = memoryDir(t, "# q7\n\n- [2026-08-01T00:00:00Z] FAILED | run a | 走死过的路\n");
  const store = new SqliteStore(":memory:");
  t.after(() => store.close());
  const { execute, inputs } = capturing();

  const runId = store.createRun("问题", { science125Id: 7 });
  await new Harness(store, execute, { memory: open(t, dir) }).execute(runId);

  assert.deepEqual(inputs[0]!.prior_attempts, ["- [2026-08-01T00:00:00Z] FAILED | run a | 走死过的路"]);
  // 前缀稳定：记忆接在 input_artifacts 之后、纠错材料之前。
  assert.deepEqual(Object.keys(inputs[0]!), ["question", "goal", "input_artifacts", "prior_attempts"]);
});

test("the ablation arm injects nothing and the fact is on the record", async (t) => {
  const dir = memoryDir(t, "# q7\n\n- [2026-08-01T00:00:00Z] FAILED | run a | 走死过的路\n");
  const store = new SqliteStore(":memory:");
  t.after(() => store.close());
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

test("a run records what it injected even when it fails", async (t) => {
  const dir = memoryDir(t, "# q7\n\n- [2026-08-01T00:00:00Z] FAILED | run a | 一\n- [2026-08-02T00:00:00Z] FAILED | run b | 二\n");
  const store = new SqliteStore(":memory:");
  t.after(() => store.close());

  const runId = store.createRun("问题", { science125Id: 7, memoryArm: "on" });
  await new Harness(store, capturing().execute, { memory: open(t, dir) }).execute(runId);

  const injected = store.eventsAfter(runId, 0).find((event) => event.kind === "campaign.prior_attempts");
  assert.deepEqual(injected?.payload, { question_id: 7, count: 2 });
  // 失败的 run 同样进战役史：下一次要知道这条路已经试过。
  const page = readFileSync(join(dir, "questions", "q7.md"), "utf8");
  assert.match(page, /FAILED \| run \w+ \| 未产出 research-plan｜cls=provider_error/);
});
