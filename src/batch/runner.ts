/** 批跑：`pnpm batch --ids 1-125`。
 *
 * 交付要求是「整套 Science-125 且可断点续跑」。那是围着既有组合根转的一个循环，
 * 不是第二条流水线：每道题都走同一个 Harness，批跑产出的 Run 与单跑逐字段同构。
 *
 * 让一次跑几个小时的无人值守批次能活下来的，是四条性质：
 * 续跑（已经交付过的题不会再花第二次钱）、隔离（一道题的故障记下来，批次继续）、
 * 串行（百炼有速率限制，题一道一道跑，顺序固定）、限时（挂住的题被取消，而不是拖住整夜）。
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { parseArgs } from "node:util";

import { INFRASTRUCTURE_FAILURE_CODES, StageError, type FailureCode } from "../agent/failures.ts";
import { CampaignMemory } from "../campaign/campaign.ts";
import { createQwenExecutor } from "../executor.ts";
import { Harness } from "../harness.ts";
import { findQuestion, science125Text, type Science125Question } from "../domain/science125.ts";
import type { StageExecutor } from "../roles.ts";
import type { MemoryArm, SourceIdentity } from "../store/contracts.ts";
import { SqliteStore } from "../store/store.ts";

/** 40 分钟还没终态的流水线是挂了，不是慢。
 *
 * 与 Python `services/launch.RUN_TIMEOUT_SECONDS` 同一个数：一道题挂住的判据
 * 不因为谁发起的而变。批跑等的是自己进程里的 Promise，只能取消，不能 kill。
 */
export const RUN_TIMEOUT_MS = 40 * 60 * 1000;

/** 取消之后还愿意等多久。
 *
 * 吞掉取消的执行流会把批次挂死得和它本来要治的挂死一样彻底，所以这段等待也有上界。
 * 宽限期过了就不再等它，由批跑给那个 Run 补终态。
 */
export const CANCEL_GRACE_MS = 30_000;

/** 批跑成立的前提是题与题互相独立；连续同类失败恰好证伪了这个前提。 */
export const SAME_CLASS_STOP = 5;

/** 连续两次环境故障就是凭据、网络或额度问题，剩下的 123 题会一模一样地失败。 */
export const OUTAGE_STOP = 2;

/** 这两类由批跑判定，但它们是 `FailureCode` 的成员，不是批跑私有的字符串。
 *
 * 判定者与分类法本就该分开：只有旁观者能说出「这道题挂死了」，可这句话落进库里之后，
 * 与 Harness 自己判定的那几类同属一套 7 类分类法，评估与报告按同一张表读。
 */
const INFRA_ERROR: FailureCode = "infra_error";
const INFRA_TIMEOUT: FailureCode = "infra_timeout";

/** 让批次退出码保持 0 的状态；其余都是欠着的题。 */
const CLEAN: ReadonlySet<string> = new Set(["passed", "skipped", "planned"]);

export type QuestionStatus = "passed" | "failed" | "skipped" | "error" | "missing" | "planned";

export type QuestionOutcome = {
  questionId: number;
  status: QuestionStatus;
  seconds: number;
  detail: string;
  /** 熔断按它归类；没有更细的类别时退回 status。 */
  classification: string | null;
  runId: string | null;
};

export type RunOutcomeFacts = {
  status: "completed" | "review_rejected" | "failed";
  errorCode: string | null;
};

/** 跑完一道题。真实实现是 Harness，测试注入假的 —— 批跑本身零网络零 LLM。
 *
 * `signal` 在超时时 abort。Harness 目前不接受外部 signal（那是 `src/harness.ts`，
 * 另一路在改），所以默认实现把它挡在**阶段边界**上：当前阶段跑完之后不再进下一个。
 * 批跑不依赖取消一定落地 —— 宽限期过了照样落终态。
 */
export type RunQuestion = (job: {
  runId: string;
  questionId: number;
  question: Science125Question;
  signal: AbortSignal;
}) => Promise<RunOutcomeFacts>;

export type BatchStop = {
  stoppedAt: string;
  reason: string;
  completed: number;
  total: number;
  /** 可直接粘回 `--ids` 的紧凑写法。 */
  remaining: string;
  remainingIds: number[];
  failedByClass: Record<string, number>;
};

export type BatchReport = {
  outcomes: QuestionOutcome[];
  stopped: BatchStop | null;
};

export type BatchOptions = {
  store: SqliteStore;
  runQuestion: RunQuestion;
  repoRoot?: string;
  /** 题库路径；默认 `data/science125.json`。 */
  dataPath?: string;
  dryRun?: boolean;
  timeoutMs?: number;
  graceMs?: number;
  /** 这一批属于消融实验的哪一臂。批跑之外的 run 不属于任何一臂，见 store 的 memory_arm。 */
  memoryArm?: MemoryArm;
  log?: (line: string) => void;
};

const RANGE = /^(\d+)-(\d+)$/;
const SINGLE = /^\d+$/;

/** `61`、`3,54,61`、`1-125`，或任意混写；结果去重升序。
 *
 * 非法输入在这里就抛：花钱之前拒绝，比跑到第 60 题才发现题号写错便宜得多。
 */
export function parseIds(spec: string): number[] {
  const ids = new Set<number>();
  for (const piece of spec.split(",").map((chunk) => chunk.trim())) {
    if (!piece) continue;
    const span = RANGE.exec(piece);
    if (span) {
      const low = Number(span[1]);
      const high = Number(span[2]);
      if (low > high) throw new Error(`题号区间 ${JSON.stringify(piece)} 的起点大于终点。`);
      for (let id = low; id <= high; id += 1) ids.add(id);
    } else if (SINGLE.test(piece)) {
      ids.add(Number(piece));
    } else {
      throw new Error(`无法解析的题号片段 ${JSON.stringify(piece)}；只接受 \`61\`、\`3,54,61\` 或 \`1-125\`。`);
    }
  }
  if (ids.size === 0) throw new Error("--ids 没有给出任何题号。");
  return [...ids].sort((left, right) => left - right);
}

/** 题号列表压回 `--ids` 写法：连续 3 个以上写成区间，其余逐个列出。
 *
 * 停批时打印的续跑命令要能直接粘贴 —— 118 个逗号分隔的数字没人粘得对。
 */
export function compactIds(ids: readonly number[]): string {
  const ordered = [...new Set(ids)].sort((left, right) => left - right);
  const parts: string[] = [];
  for (let start = 0; start < ordered.length;) {
    let end = start;
    while (end + 1 < ordered.length && ordered[end + 1] === ordered[end]! + 1) end += 1;
    if (end - start + 1 >= 3) parts.push(`${ordered[start]}-${ordered[end]}`);
    else for (let index = start; index <= end; index += 1) parts.push(String(ordered[index]));
    start = end + 1;
  }
  return parts.join(",");
}

/** 哪个 build 产出了这些 Run。取不到就是 null —— 采集失败绝不能让一道题跑不起来。
 *
 * `--untracked-files=no`：批跑自己会往 `outputs/` 写文件，把未跟踪文件算进去
 * 会让每个 Run 都是脏的，这个标志也就什么都不说明了。
 */
export function readSourceIdentity(repoRoot: string): SourceIdentity | null {
  try {
    const commit = git(repoRoot, ["rev-parse", "HEAD"]);
    const dirty = git(repoRoot, ["status", "--porcelain", "--untracked-files=no"]);
    if (commit === null || dirty === null) return null;
    return { gitCommit: commit.trim(), treeDirty: dirty.trim().length > 0 };
  } catch {
    return null;
  }
}

function git(cwd: string, args: string[]): string | null {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 10_000 });
  if (result.error || result.status !== 0 || typeof result.stdout !== "string") return null;
  return result.stdout;
}

export async function runBatch(questionIds: readonly number[], options: BatchOptions): Promise<BatchReport> {
  const log = options.log ?? ((line: string) => process.stdout.write(`${line}\n`));
  const repoRoot = resolve(options.repoRoot ?? process.cwd());
  const outcomes: QuestionOutcome[] = [];
  let cause = "";
  let streak = 0;
  let stopped: BatchStop | null = null;

  for (const [index, questionId] of questionIds.entries()) {
    const outcome = await runOne(questionId, { ...options, repoRoot });
    outcomes.push(outcome);
    log(
      `[batch] ${index + 1}/${questionIds.length} q${outcome.questionId} | ${outcome.status} | `
      + `${outcome.seconds.toFixed(1)}s${outcome.detail ? ` | ${outcome.detail}` : ""}`,
    );
    if (outcome.status === "passed") {
      cause = "";
      streak = 0;
    }
    if (CLEAN.has(outcome.status)) continue;

    const current = outcome.classification ?? outcome.status;
    streak = current === cause ? streak + 1 : 1;
    cause = current;
    const outage = INFRASTRUCTURE_FAILURE_CODES.has(current as FailureCode);
    if (streak < (outage ? OUTAGE_STOP : SAME_CLASS_STOP)) continue;

    const remainingIds = questionIds.slice(index + 1);
    stopped = {
      stoppedAt: new Date().toISOString(),
      reason: `连续 ${streak} 次 ${current}`,
      completed: index + 1,
      total: questionIds.length,
      remaining: compactIds(remainingIds),
      remainingIds: [...remainingIds],
      failedByClass: tallyFailures(outcomes),
    };
    log(
      `[batch] 熔断停批：${stopped.reason}。已完成 ${stopped.completed}/${stopped.total}，`
      + `剩余 --ids ${stopped.remaining || "（无）"}`,
    );
    break;
  }

  // 欠账写成文件，续跑的人不必从几小时的日志里翻那一行。
  const ledgerPath = remainingPath(repoRoot);
  if (stopped) {
    mkdirSync(dirname(ledgerPath), { recursive: true });
    writeFileSync(ledgerPath, `${JSON.stringify(stopped, null, 2)}\n`, "utf8");
    log(`[batch] 剩余题号已写入 ${ledgerPath}`);
  } else if (!options.dryRun) {
    // 跑完没停批就什么都不欠；留着上一批的欠账文件只会把人骗回去重跑。
    // dry-run 一道题都没跑，它无权注销上一批留下的欠账。
    rmSync(ledgerPath, { force: true });
  }
  log(`[batch] 合计 ${outcomes.length} 题：${tally(outcomes)}`);
  return { outcomes, stopped };
}

export function remainingPath(repoRoot: string): string {
  return resolve(repoRoot, "outputs/batch-remaining.json");
}

async function runOne(
  questionId: number,
  options: BatchOptions & { repoRoot: string },
): Promise<QuestionOutcome> {
  const { store } = options;
  const settled = store.completedRunForQuestion(questionId);
  if (settled !== null) {
    return outcome(questionId, "skipped", 0, `已有 completed 的 run ${settled}`, null, settled);
  }
  const question = findQuestion(questionId, options.dataPath);
  if (question === null) {
    return outcome(questionId, "missing", 0, "题号不在 science125.json 内");
  }
  if (options.dryRun) {
    return outcome(questionId, "planned", 0, question.question.slice(0, 60));
  }

  const started = performance.now();
  const elapsed = () => (performance.now() - started) / 1000;
  let runId: string;
  try {
    runId = store.createRun(science125Text(question), {
      science125Id: questionId,
      // 每道题现场采一次：跑了几小时的批次中途换了 commit，也要各记各的。
      sourceIdentity: readSourceIdentity(options.repoRoot),
      memoryArm: options.memoryArm ?? null,
    });
  } catch (error) {
    // 建不出 Run 是本机的问题（库锁着、磁盘满），不是这道题的问题。
    return outcome(questionId, "error", elapsed(), describe(error), INFRA_ERROR);
  }

  const controller = new AbortController();
  // 同步抛出的执行器（构造凭据失败之类）必须也变成 rejection：直接调用的话，
  // 它会绕过下面整套超时与隔离，把一道题的故障升级成整批中断。
  const attempt = track((async () =>
    options.runQuestion({ runId, questionId, question, signal: controller.signal }))());
  const timeoutMs = options.timeoutMs ?? RUN_TIMEOUT_MS;
  if (!(await settleWithin(attempt.done, timeoutMs))) {
    controller.abort();
    // 取消本身也可能不落地，所以这段等待同样有上界；等不到就自己给 Run 补终态。
    const unwound = await settleWithin(attempt.done, options.graceMs ?? CANCEL_GRACE_MS);
    const detail = `单题超过 ${(timeoutMs / 1000).toFixed(0)}s 未终态，已取消`
      + (unwound ? "" : `；取消未在宽限期内完成，该题可能仍在写这个 run`);
    // merge 不 rewrite：这道题自己赶在取消之后收了尾的话，那份终态是它的事实。
    store.settleAbandonedRun(runId, INFRA_TIMEOUT);
    return outcome(questionId, "failed", elapsed(), detail, INFRA_TIMEOUT, runId);
  }

  const result = attempt.peek()!;
  if (result.state === "rejected") {
    // 一道题的故障不该让另外 124 题陪葬。
    store.settleAbandonedRun(runId, INFRA_ERROR, "BatchError");
    return outcome(questionId, "error", elapsed(), describe(result.reason), INFRA_ERROR, runId);
  }
  if (result.value.status === "completed") {
    return outcome(questionId, "passed", elapsed(), "", null, runId);
  }
  return outcome(
    questionId,
    "failed",
    elapsed(),
    `run ${result.value.status}`,
    result.value.errorCode ?? result.value.status,
    runId,
  );
}

function outcome(
  questionId: number,
  status: QuestionStatus,
  seconds: number,
  detail: string,
  classification: string | null = null,
  runId: string | null = null,
): QuestionOutcome {
  return { questionId, status, seconds, detail, classification, runId };
}

function describe(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

type Settled<T> = { state: "fulfilled"; value: T } | { state: "rejected"; reason: unknown };

/** 把一个 Promise 变成可以「问一句现在settled了没」的东西。
 *
 * 拒绝在这里就被接住：批跑随后可能不再等它，没人接的 rejection 会掀掉整个进程。
 */
function track<T>(promise: Promise<T>): { done: Promise<void>; peek: () => Settled<T> | null } {
  let outcome: Settled<T> | null = null;
  const done = promise.then(
    (value) => { outcome = { state: "fulfilled", value }; },
    (reason) => { outcome = { state: "rejected", reason }; },
  );
  return { done, peek: () => outcome };
}

/** `done` 在 `ms` 内 settle 了没。计时器一定会被清掉，不会把进程多吊住 40 分钟。 */
async function settleWithin(done: Promise<void>, ms: number): Promise<boolean> {
  const timer = new AbortController();
  const timeout = delay(ms, "timeout" as const, { signal: timer.signal }).catch(() => "aborted" as const);
  try {
    return (await Promise.race([done.then(() => "settled" as const), timeout])) === "settled";
  } finally {
    timer.abort();
  }
}

/** 按 (status, classification) 出直方图：跑完 125 题，是它说出该修什么。 */
function tally(outcomes: readonly QuestionOutcome[]): string {
  const counts = new Map<string, number>();
  for (const item of outcomes) {
    const key = item.classification === null ? item.status : `${item.status}/${item.classification}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].sort(([left], [right]) => left.localeCompare(right))
    .map(([name, count]) => `${name} ${count}`).join("，");
}

function tallyFailures(outcomes: readonly QuestionOutcome[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of outcomes) {
    if (CLEAN.has(item.status)) continue;
    const key = item.classification ?? item.status;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

/** 批跑用的战役记忆通道。`--no-memory` 传 null，注入与写回一起关掉。
 *
 * 定位符是仓库相对的：战役记忆比写它的 checkout 活得久，worktree、clone 与审阅者机器上
 * 都要指向同一个逻辑位置。db 在仓根之外时退回它的文件名 —— 记不准也好过记一个假的绝对路径。
 */
export function createCampaignMemory(repoRoot: string, dbPath: string): CampaignMemory {
  const relativeDb = relative(repoRoot, resolve(dbPath));
  const locator = relativeDb && !relativeDb.startsWith("..") ? relativeDb : basename(dbPath);
  return new CampaignMemory({
    memoryDir: resolve(repoRoot, "memory"),
    locate: (runId) => `${locator}#${runId}`,
  });
}

/** 真实执行器：每道题一个 Harness，绑在这道题自己的取消信号上。 */
export function createHarnessRunner(store: SqliteStore, memory: CampaignMemory | null = null): RunQuestion {
  // 用量由 harness 每个 Attempt 落一条 `sdk.usage`，这里不再挂第二个写库回调。
  const execute = createQwenExecutor();
  return ({ runId, signal }) => {
    const guarded: StageExecutor = (request) => {
      // 批跑取消之后不再进下一个阶段。当前阶段自己的超时由 executor 管。
      if (signal.aborted) {
        return Promise.reject(new StageError("deadline_exceeded", `batch cancelled before ${request.role}`));
      }
      return execute(request);
    };
    return new Harness(store, guarded, { memory }).execute(runId);
  };
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        ids: { type: "string" },
        "dry-run": { type: "boolean", default: false },
        // 消融臂：关掉跨 run 记忆的注入与写回。被消融的是数据通道本身，不是一个返回
        // 空结果的工具 —— TS 栈没有 memory_search，模型的记忆面只有注入这一条。
        "no-memory": { type: "boolean", default: false },
        "repo-root": { type: "string" },
        db: { type: "string" },
      },
      strict: true,
    });
  } catch (error) {
    process.stdout.write(`[batch] ${describe(error)}\n`);
    return 2;
  }
  if (!parsed.values.ids) {
    process.stdout.write("[batch] 缺少 --ids，例如 `--ids 1-125`。\n");
    return 2;
  }
  let questionIds: number[];
  try {
    questionIds = parseIds(parsed.values.ids);
  } catch (error) {
    process.stdout.write(`[batch] ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }

  const dryRun = parsed.values["dry-run"] === true;
  const noMemory = parsed.values["no-memory"] === true;
  const dbPath = parsed.values.db || process.env.LUUP_DATABASE || "outputs/runtime/typescript-runs.db";
  const repoRoot = resolve(parsed.values["repo-root"] ?? process.cwd());
  const store = new SqliteStore(dbPath);
  try {
    const report = await runBatch(questionIds, {
      store,
      // dry-run 一次运行都不发起，所以也不构造需要 QWEN_API_KEY 的执行器。
      runQuestion: dryRun
        ? () => Promise.reject(new Error("dry-run 不执行"))
        : createHarnessRunner(store, noMemory ? null : createCampaignMemory(repoRoot, dbPath)),
      repoRoot,
      dryRun,
      memoryArm: noMemory ? "off" : "on",
    });
    return report.outcomes.every((item) => CLEAN.has(item.status)) ? 0 : 1;
  } finally {
    store.close();
  }
}

if (import.meta.filename === process.argv[1]) {
  process.exitCode = await main();
}
