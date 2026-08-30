/** 批跑：`pnpm run batch -- --ids 1-125 --concurrency 3`。
 *
 * 交付要求是「整套 Science-125 且可断点续跑」。那是围着既有组合根转的一个循环，
 * 不是第二条流水线：每道题都走同一个 Harness，批跑产出的 Run 与单跑逐字段同构。
 *
 * 让一次跑几个小时的无人值守批次能活下来的，是四条性质：
 * 续跑（已经交付过的题不会再花第二次钱）、隔离（一道题的故障记下来，批次继续）、
 * 有界并发（题按升序派发进一个至多 5 个槽位的池，完成即结算，见 `runBatch`）、
 * 限时（挂住的题被取消，而不是拖住整夜）。
 *
 * 并发取代了原来的第三条「串行」：pilot 实测单题墙钟 145s，几乎全是模型网络往返，
 * 单线程等 I/O 而已。速率限制不再靠串行来守 —— 检索侧有模块级同源发号闸，
 * 模型侧有 executor 的传输层退避（`TRANSIENT_RETRY`），两者都比「一次只跑一题」精确。
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { parseArgs } from "node:util";

import { INFRASTRUCTURE_FAILURE_CODES, StageError, type FailureCode } from "../agent/failures.ts";
import { CampaignMemory } from "../campaign/campaign.ts";
import { admitPaidBatch, readSourceIdentity } from "./admission.ts";
import { BatchManifest, type BatchManifestSnapshot, type BatchTerminalStatus } from "./manifest.ts";
import { createQwenExecutor } from "../executor.ts";
import { Harness } from "../harness.ts";
import { findQuestion, science125Integrity, science125Text, type Science125Question } from "../domain/science125.ts";
import type { StageExecutor } from "../roles.ts";
import { modelConfigStatus } from "../seams/index.ts";
import type { MemoryArm, SourceIdentity } from "../agent/contracts.ts";
import { SqliteStore } from "../store/store.ts";

const MODULE_REPO_ROOT = resolve(import.meta.dirname, "../../../..");

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

/** 同时在飞的题数上限。
 *
 * 5 不是实测出来的最优值，是一条自觉保守的线：并发的收益是隐藏模型往返，代价是
 * 一次熔断会浪费掉更多在飞的题（它们的钱已经花了，见 `runBatch`），而单题 40 分钟的
 * 兜底又让「浪费」的上界随并发线性放大。3 起步、5 封顶，够把 125 题的墙钟压掉大半，
 * 又不至于让一次供应商停机烧掉 5 道题的预算。
 */
export const MAX_CONCURRENCY = 5;

/** CLI 不给 `--concurrency` 时的并发。
 *
 * `runBatch` 自己默认 1（串行）：库函数的默认值应当是那个最不惊讶的语义，
 * 「一次跑几道」是操作决策，属于命令行。
 */
export const DEFAULT_CONCURRENCY = 3;

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

export type BatchRuntimePreflight = {
  nodeVersion: string;
  dryRun: boolean;
};

/** 正式 live batch 的运行时门；dry-run 是规划动作，不受 Node 版本限制。 */
export function validateBatchRuntime({ nodeVersion, dryRun }: BatchRuntimePreflight): string | null {
  if (dryRun) return null;
  const requirement = "Node.js >= 24.20.0";
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(nodeVersion);
  const version = match?.slice(1).map(Number);
  if (version === undefined || version.some((part) => !Number.isSafeInteger(part))) {
    return `正式 live batch 无法识别 Node.js 版本 ${nodeVersion}：版本格式无效；${requirement}。`;
  }
  const parsed = version as [number, number, number];
  const meetsMinimum = (minimum: readonly [number, number, number]): boolean => {
    const firstDifference = parsed.findIndex((part, index) => part !== minimum[index]);
    return firstDifference === -1 || parsed[firstDifference]! > minimum[firstDifference]!;
  };
  if (meetsMinimum([24, 20, 0])) return null;
  return `正式 live batch 不支持 Node.js ${nodeVersion}；${requirement}。请按 packageManager 声明的范围运行。`;
}

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
  manifestId: string;
  manifest: BatchManifestSnapshot;
};

export type BatchOptions = {
  store: SqliteStore;
  runQuestion: RunQuestion;
  /** Reopen an existing durable manifest instead of creating a new batch. */
  manifestId?: string;
  repoRoot?: string;
  dryRun?: boolean;
  /** 同时在飞的题数。默认 1（串行）；超出 [1, MAX_CONCURRENCY] 的值就近夹住。 */
  concurrency?: number;
  timeoutMs?: number;
  graceMs?: number;
  /** 这一批属于消融实验的哪一臂。批跑之外的 run 不属于任何一臂，见 store 的 memory_arm。 */
  memoryArm?: MemoryArm;
  /** A CLI admission may freeze provenance before opening SQLite; library callers may omit it. */
  sourceIdentity?: SourceIdentity | null;
  log?: (line: string) => void;
};

/** Internal run options shared by every question in one batch.
 *
 * `sourceIdentity` is deliberately captured once by `runBatch`, before any
 * question can write campaign memory or other tracked files.  Reading Git per
 * question makes one logical cohort appear to come from different trees.
 */
type BatchQuestionOptions = BatchOptions & {
  repoRoot: string;
  sourceIdentity: SourceIdentity | null;
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

function sameIds(left: readonly number[], right: readonly number[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((id, index) => id === right[index]);
}

/** 批次启动前一次性确认所有题号，避免滚动池已经为前面的题花钱后才发现尾部写错。 */
export function preflightQuestionIds(questionIds: readonly number[]): void {
  const integrity = science125Integrity();
  if (!integrity.ok) {
    throw new Error(
      `Science-125 题库完整性失败：raw=${integrity.rawCount}, valid=${integrity.validCount}, ` +
        `missing=${integrity.missingIds.join(",") || "无"}, duplicate=${integrity.duplicateIds.join(",") || "无"}, ` +
        `unexpected=${integrity.unexpectedIds.join(",") || "无"}`,
    );
  }
  const duplicateIds = questionIds.filter((id, index) => questionIds.indexOf(id) !== index);
  if (duplicateIds.length > 0) {
    throw new Error(`批次题号重复：${[...new Set(duplicateIds)].join(", ")}。重复题会造成重复付费。`);
  }
  const invalid = [...new Set(questionIds.filter((id) => !Number.isSafeInteger(id) || findQuestion(id) === null))];
  if (invalid.length > 0) {
    throw new Error(`批次题号无效：${invalid.join(", ")}。有效题号范围为 1-125。`);
  }
}

/** 并发落进 [1, MAX_CONCURRENCY]。库函数就近夹住而不抛：把一个越界的数字变成中断整批的
 *  异常没有意义。命令行那一侧相反 —— 花钱之前拒绝，见 `parseConcurrency`。 */
function boundConcurrency(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_CONCURRENCY, Math.max(1, Math.trunc(value)));
}

/** `--concurrency` 的取值。非法输入在这里就抛，和 `--ids` 同一条纪律。 */
export function parseConcurrency(spec: string | undefined): number {
  if (spec === undefined) return DEFAULT_CONCURRENCY;
  const value = Number(spec);
  if (!Number.isInteger(value) || value < 1 || value > MAX_CONCURRENCY) {
    throw new Error(`--concurrency 只接受 1 到 ${MAX_CONCURRENCY} 的整数，收到 ${JSON.stringify(spec)}。`);
  }
  return value;
}

/** 跑一批题：题号按升序派发进一个有界池，完成即结算。
 *
 * ## 形状
 *
 * 滚动池，不是分批 —— 一道题结算就立刻补进下一道，池子一直是满的。派发顺序是升序，
 * 结算顺序是完成顺序，两者在并发下必然不同，`outcomes` 记的是**结算顺序**。
 * 没有「按顺序提交」的需求：每道题自己写自己的 Run，题与题之间没有交付顺序。
 *
 * ## 为什么并发是安全的
 *
 * 并发只在**一个 Node 进程、一条 JS 线程**内发生。三处共享状态各自成立：
 *
 * 1. **SQLite**：`store/store.ts` 用 `node:sqlite` 的 `DatabaseSync`，写路径是
 *    `BEGIN IMMEDIATE` → 同步回调 → `COMMIT`，中间没有 `await`。单线程 JS 下没有
 *    第二个执行流能挤进这段，事务因此天然原子；两道题不可能交错在同一次写里。
 * 2. **检索发号闸**：`agent/rate-limit.ts` 的限流器是**模块级**单例（arXiv 3s、
 *    Crossref 1s），用 promise 链串行化。并发的是题，不是请求：五道题同时要查 arXiv，
 *    仍然排在同一条队上 3s 发一次。预注册的检索纪律一字不破。代价要说清 ——
 *    这条闸是并发加速比的地板：全批 arXiv 请求数 × 3s 是任何并发都压不下去的墙钟。
 * 3. **战役记忆**：注入端只读同题页（`questions/q<id>.md`），题与题读的不是同一个文件；
 *    写回端在题终态之后，`campaign.ts` 的 `append` 是「读 → 写临时文件 → rename」
 *    三个同步调用，同样没有 `await`，所以两道题的追加不会互相截断。共享的只有
 *    `log.md`，多道题的行按结算顺序落，各是各的一行。
 *
 * 模型端的速率限制不靠并发上限来守：撞上 429 由 executor 的 `TRANSIENT_RETRY` 退避重试，
 * 抖动因此不会再被记成 `provider_error`（那正是 pilot 结尾触发熔断的东西）。
 *
 * ## 熔断在并发下的语义
 *
 * 同类连击按**结算顺序**计数——那是唯一存在的全序，派发顺序在这里说明不了任何事。
 * 触发之后：停止派发新题，**不取消在飞的题**（它们的 token 已经烧掉了，让它们落终态，
 * 拿到证据比省下尾巴上那点墙钟值钱），等全部结算完再退出。因此欠账 = 从未派发过的题，
 * 而 `completed` 与 `failedByClass` 都在排空之后才定稿。
 */
export async function runBatch(questionIds: readonly number[], options: BatchOptions): Promise<BatchReport> {
  preflightQuestionIds(questionIds);
  const repoRoot = resolve(options.repoRoot ?? process.cwd());
  // Freeze provenance before creating/starting any question.  The batch owns
  // one source cohort even when its memory append changes tracked files.
  const sourceIdentity = Object.hasOwn(options, "sourceIdentity")
    ? (options.sourceIdentity ?? null)
    : readSourceIdentity(repoRoot);
  const manifest = options.manifestId
    ? BatchManifest.open(options.store, options.manifestId)
    : BatchManifest.create(options.store, questionIds);
  const opened = manifest.snapshot();
  if (options.manifestId) {
    if (opened.expectedDuplicateIds.length > 0 || opened.unexpectedIds.length > 0) {
      throw new Error(`batch manifest ${opened.id} has an invalid expected set; refusing to resume`);
    }
    if (
      !sameIds(
        opened.expectedIds,
        [...questionIds].sort((left, right) => left - right),
      )
    ) {
      throw new Error(
        `batch manifest ${opened.id} expects ${compactIds(opened.expectedIds)} but received ${compactIds(questionIds)}`,
      );
    }
  }
  const runnableIds = options.manifestId ? manifest.pendingIds() : [...questionIds];
  const log = options.log ?? ((line: string) => process.stdout.write(`${line}\n`));
  if (!options.dryRun) log(`[batch] manifestId ${manifest.id}`);
  const limit = boundConcurrency(options.concurrency ?? 1);
  const total = runnableIds.length;
  const outcomes: QuestionOutcome[] = [];
  let cause = "";
  let streak = 0;
  let halted: { stoppedAt: string; reason: string } | null = null;
  let dispatched = 0;

  // 槽位号只为进度行服务：并发日志里没有它就分不清哪几行属于同一条流水。
  const idle = Array.from({ length: limit }, (_, index) => index + 1);
  type Landed = { ticket: number; slot: number; outcome: QuestionOutcome };
  const inflight = new Map<number, Promise<Landed>>();
  let ticket = 0;

  const fill = () => {
    while (!halted && inflight.size < limit && dispatched < total) {
      const questionId = runnableIds[dispatched]!;
      dispatched += 1;
      const slot = idle.shift()!;
      const seat = ticket;
      ticket += 1;
      inflight.set(
        seat,
        runOne(questionId, { ...options, repoRoot, sourceIdentity }).then((outcome) => ({
          ticket: seat,
          slot,
          outcome,
        })),
      );
    }
  };

  fill();
  while (inflight.size > 0) {
    const landed = await Promise.race(inflight.values());
    inflight.delete(landed.ticket);
    idle.push(landed.slot);
    const outcome = landed.outcome;
    outcomes.push(outcome);
    const terminalStatus = terminalStatusFor(outcome);
    if (terminalStatus !== null) {
      try {
        manifest.record({ questionId: outcome.questionId, status: terminalStatus, runId: outcome.runId });
      } catch (error) {
        // Keep the question outcome visible even if manifest persistence fails; the final gate will remain incomplete.
        log(`[batch] manifest record failed for q${outcome.questionId}: ${describe(error)}`);
      }
    }
    log(
      `[batch] ${outcomes.length}/${total} s${landed.slot} q${outcome.questionId} | ${outcome.status} | ` +
        `${outcome.seconds.toFixed(1)}s${outcome.detail ? ` | ${outcome.detail}` : ""}`,
    );

    if (!halted) {
      if (outcome.status === "passed") {
        cause = "";
        streak = 0;
      }
      if (!CLEAN.has(outcome.status)) {
        const current = outcome.classification ?? outcome.status;
        streak = current === cause ? streak + 1 : 1;
        cause = current;
        const outage = INFRASTRUCTURE_FAILURE_CODES.has(current as FailureCode);
        if (streak >= (outage ? OUTAGE_STOP : SAME_CLASS_STOP)) {
          halted = { stoppedAt: new Date().toISOString(), reason: `连续 ${streak} 次 ${current}` };
          // 串行时在飞的只有刚结算的这一道，池子已经空了，这行不打——日志与并发前逐字相同。
          if (inflight.size > 0) {
            log(
              `[batch] 熔断触发：${halted.reason}。停止派发新题，等在飞的 ${inflight.size} 题结算完再退出` +
                "（不取消：它们的钱已经花了）",
            );
          }
        }
      }
    }
    fill();
  }

  let stopped: BatchStop | null = null;
  if (halted) {
    const remainingIds = runnableIds.slice(dispatched);
    stopped = {
      ...halted,
      completed: outcomes.length,
      total,
      remaining: compactIds(remainingIds),
      remainingIds: [...remainingIds],
      failedByClass: tallyFailures(outcomes),
    };
    log(
      `[batch] 熔断停批：${stopped.reason}。已完成 ${stopped.completed}/${stopped.total}，` +
        `剩余 --ids ${stopped.remaining || "（无）"}`,
    );
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
  return { outcomes, stopped, manifestId: manifest.id, manifest: manifest.snapshot() };
}

export function remainingPath(repoRoot: string): string {
  return resolve(repoRoot, "outputs/batch-remaining.json");
}

async function runOne(questionId: number, options: BatchQuestionOptions): Promise<QuestionOutcome> {
  const { store } = options;
  const settled = store.completedRunForQuestionInArm(questionId, options.memoryArm ?? null);
  if (settled !== null) {
    return outcome(questionId, "skipped", 0, `已有 completed 的 run ${settled}`, null, settled);
  }
  const question = findQuestion(questionId);
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
      // Every question reuses the batch's frozen provenance.  Do not sample Git
      // after campaign memory has had a chance to touch the working tree.
      sourceIdentity: options.sourceIdentity,
      memoryArm: options.memoryArm ?? null,
    });
  } catch (error) {
    // 建不出 Run 是本机的问题（库锁着、磁盘满），不是这道题的问题。
    return outcome(questionId, "error", elapsed(), describe(error), INFRA_ERROR);
  }

  const controller = new AbortController();
  // 同步抛出的执行器（构造凭据失败之类）必须也变成 rejection：直接调用的话，
  // 它会绕过下面整套超时与隔离，把一道题的故障升级成整批中断。
  const attempt = track(
    (async () => options.runQuestion({ runId, questionId, question, signal: controller.signal }))(),
  );
  const timeoutMs = options.timeoutMs ?? RUN_TIMEOUT_MS;
  if (!(await settleWithin(attempt.done, timeoutMs))) {
    controller.abort();
    // 取消本身也可能不落地，所以这段等待同样有上界；等不到就自己给 Run 补终态。
    const unwound = await settleWithin(attempt.done, options.graceMs ?? CANCEL_GRACE_MS);
    const detail =
      `单题超过 ${(timeoutMs / 1000).toFixed(0)}s 未终态，已取消` +
      (unwound ? "" : `；取消未在宽限期内完成，该题可能仍在写这个 run`);
    // merge 不 rewrite：这道题自己赶在取消之后收了尾的话，那份终态是它的事实。
    const settleError = settleRun(store, runId, INFRA_TIMEOUT, "BatchTimeout");
    return outcomeFromDurableRun(store, questionId, runId, elapsed, detail, settleError, "failed");
  }

  const result = attempt.peek()!;
  if (result.state === "rejected") {
    // 一道题的故障不该让另外 124 题陪葬。
    const settleError = settleRun(store, runId, INFRA_ERROR, "BatchError");
    return outcomeFromDurableRun(store, questionId, runId, elapsed, describe(result.reason), settleError, "error");
  }
  const currentFacts = readBatchFacts(store, runId);
  const settleError =
    currentFacts.facts?.status === "running"
      ? settleRun(
          store,
          runId,
          result.value.status === "failed" ? (result.value.errorCode ?? INFRA_ERROR) : INFRA_ERROR,
          "BatchIncomplete",
        )
      : currentFacts.error;
  return outcomeFromDurableRun(
    store,
    questionId,
    runId,
    elapsed,
    result.value.status === "completed" ? "" : `run ${result.value.status}`,
    settleError,
    result.value.status === "failed" ? "failed" : "error",
  );
}

function settleRun(store: SqliteStore, runId: string, failureCode: string, errorType: string): string | null {
  try {
    store.settleAbandonedRun(runId, failureCode, errorType);
    return null;
  } catch (error) {
    return describe(error);
  }
}

/** Translate the durable Run state into the only batch verdict we can publish. */
function outcomeFromDurableRun(
  store: SqliteStore,
  questionId: number,
  runId: string,
  elapsed: () => number,
  detail: string,
  settleError: string | null,
  fallbackStatus: "failed" | "error",
): QuestionOutcome {
  const current = readBatchFacts(store, runId);
  const facts = current.facts;
  if (facts === null) {
    return outcome(
      questionId,
      "error",
      elapsed(),
      `${detail}; ${current.error ? `无法读取 durable 状态：${current.error}` : `run ${runId} 不存在`}`,
      INFRA_ERROR,
      runId,
    );
  }
  if (settleError !== null && facts.status === "running") {
    return outcome(questionId, "error", elapsed(), `${detail}; 无法持久化终态：${settleError}`, INFRA_ERROR, runId);
  }
  switch (facts.status) {
    case "completed":
      return outcome(questionId, "passed", elapsed(), detail, null, runId);
    case "review_rejected":
      return outcome(questionId, "failed", elapsed(), detail || "run review_rejected", "review_rejected", runId);
    case "failed":
      return outcome(
        questionId,
        fallbackStatus,
        elapsed(),
        detail || `run failed${facts.errorCode ? `: ${facts.errorCode}` : ""}`,
        facts.errorCode ?? INFRA_ERROR,
        runId,
      );
    case "running":
      return outcome(questionId, "error", elapsed(), `${detail}; run 仍处于 running`, INFRA_ERROR, runId);
  }
}

function readBatchFacts(
  store: SqliteStore,
  runId: string,
): {
  facts: ReturnType<SqliteStore["batchRunFacts"]>;
  error: string | null;
} {
  try {
    return { facts: store.batchRunFacts(runId), error: null };
  } catch (error) {
    return { facts: null, error: describe(error) };
  }
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

/** The batch gate only accepts terminal facts; a dry-run plan remains omitted. */
function terminalStatusFor(outcome: QuestionOutcome): BatchTerminalStatus | null {
  // Reviewer 明确拒绝表示这道题有完整运行事实，但科学判断仍需人工处理；
  // 它不是基础设施/执行失败，不能混进 failure 后丢掉这一边界。
  if (outcome.classification === "review_rejected") return "human_review";
  if (outcome.classification === "partial") return "partial";
  switch (outcome.status) {
    case "passed":
    case "skipped":
      return "success";
    case "failed":
    case "error":
    case "missing":
      return "failure";
    case "planned":
      return null;
  }
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
    (value) => {
      outcome = { state: "fulfilled", value };
    },
    (reason: unknown) => {
      outcome = { state: "rejected", reason };
    },
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
  return [...counts]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, count]) => `${name} ${count}`)
    .join("，");
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

/** 真实执行器：每道题一个 Harness，绑在这道题自己的取消信号上。
 *
 * 并发的题共用同一个 executor，这是有意的：`Runner.run` 每次调用自建 RunState，
 * 不跨调用留状态；被共用的只有模型客户端和它底下的连接池，那本来就该共用。
 */
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

export async function main(
  argv: string[] = process.argv.slice(2),
  runtime: {
    nodeVersion?: string;
    modelCredential?: boolean;
    sourceFact?: typeof readSourceIdentity;
    run?: RunQuestion;
  } = {},
): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        ids: { type: "string" },
        "manifest-id": { type: "string" },
        "confirm-science125": { type: "boolean", default: false },
        "release-commit": { type: "string" },
        // 同时在飞几道题。默认 3、上限 MAX_CONCURRENCY，安全性论证见 `runBatch`。
        concurrency: { type: "string" },
        "dry-run": { type: "boolean", default: false },
        preflight: { type: "boolean", default: false },
        // 消融臂：关掉跨 run 记忆的注入与写回。被消融的是数据通道本身，不是一个返回
        // 空结果的工具 —— TS 栈没有 memory_search，模型的记忆面只有注入这一条。
        "no-memory": { type: "boolean", default: false },
        "confirm-memory-ablation": { type: "boolean", default: false },
        "repo-root": { type: "string" },
        db: { type: "string" },
      },
      strict: true,
    });
  } catch (error) {
    process.stdout.write(`[batch] ${describe(error)}\n`);
    return 2;
  }
  const manifestId = parsed.values["manifest-id"];
  const preflight = parsed.values.preflight === true;
  if (preflight && parsed.values["dry-run"] === true) {
    process.stdout.write("[batch] --preflight 与 --dry-run 不能同时使用；前者检查正式付费启动门，后者只规划题目。\n");
    return 2;
  }
  if (preflight && manifestId) {
    process.stdout.write("[batch] --preflight 不能与 --manifest-id 混用；resume 必须打开 SQLite 核对既有事实。\n");
    return 2;
  }
  if (!parsed.values.ids && !manifestId) {
    process.stdout.write("[batch] 缺少 --ids 或 --manifest-id，例如 `--ids 1-125`。\n");
    return 2;
  }
  let questionIds: number[] | null = null;
  let concurrency: number;
  try {
    questionIds = parsed.values.ids ? parseIds(parsed.values.ids) : null;
    concurrency = parseConcurrency(parsed.values.concurrency);
  } catch (error) {
    process.stdout.write(`[batch] ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }

  const dryRun = parsed.values["dry-run"] === true;
  const noMemory = parsed.values["no-memory"] === true;
  const confirmedScience125 = parsed.values["confirm-science125"] === true;
  const confirmedMemoryAblation = parsed.values["confirm-memory-ablation"] === true;
  const releaseCommit = parsed.values["release-commit"];
  const runtimeError = validateBatchRuntime({
    nodeVersion: runtime.nodeVersion ?? process.version,
    dryRun,
  });
  if (runtimeError) {
    process.stdout.write(`[batch] ${runtimeError}\n`);
    return 2;
  }
  const requestedDbPath = parsed.values.db || process.env.LUUP_DATABASE || "outputs/runtime/typescript-runs.db";
  // Pure planning must not leave an empty manifest or SQLite files behind. Resuming by manifest ID is
  // intentionally read-only planning against the durable batch that the operator named.
  const dbPath = dryRun && !manifestId ? ":memory:" : requestedDbPath;
  const repoRoot = resolve(parsed.values["repo-root"] ?? MODULE_REPO_ROOT);
  if (questionIds !== null) {
    try {
      preflightQuestionIds(questionIds);
    } catch (error) {
      process.stdout.write(`[batch] ${describe(error)}\n`);
      return 2;
    }
  }
  const launchAdmission = admitPaidBatch({
    stage: "launch",
    questionIds,
    dryRun,
    noMemory,
    manifestId,
    confirmedScience125,
    confirmedMemoryAblation,
    releaseCommit,
    repoRoot,
    databasePath: requestedDbPath,
  });
  if (!launchAdmission.admitted) {
    process.stdout.write(`[batch] ${launchAdmission.error}\n`);
    return 2;
  }
  const credentialAvailable = runtime.modelCredential ?? modelConfigStatus().credential !== "absent";
  if (!dryRun && !credentialAvailable) {
    process.stdout.write("[batch] 缺少 QWEN_API_KEY，非 dry-run 批跑已拒绝启动。\n");
    return 2;
  }
  if (preflight) {
    if (!launchAdmission.plan.formal) {
      process.stdout.write("[batch] --preflight 只验收正式 Phase A 全量或预注册 Phase B memory-off 批次。\n");
      return 2;
    }
    const nodeVersion = runtime.nodeVersion ?? process.version;
    process.stdout.write("[batch] preflight admitted\n");
    process.stdout.write(
      `${JSON.stringify(
        {
          status: "admitted",
          phase: noMemory ? "phase_b" : "phase_a",
          questionCount: questionIds?.length ?? 0,
          questionIds: compactIds(questionIds ?? []),
          memoryArm: launchAdmission.plan.memoryArm,
          databasePath: requestedDbPath,
          nodeVersion,
          sourceIdentity: launchAdmission.plan.sourceIdentity,
          releaseGuarded: launchAdmission.plan.releaseGuarded,
          credential: "configured",
        },
        null,
        2,
      )}\n`,
    );
    return 0;
  }
  const store = new SqliteStore(dbPath);
  try {
    let openedManifest: BatchManifestSnapshot | null = null;
    if (manifestId) {
      try {
        openedManifest = BatchManifest.open(store, manifestId).snapshot();
        questionIds ??= openedManifest.expectedIds;
      } catch (error) {
        process.stdout.write(`[batch] ${describe(error)}\n`);
        return 2;
      }
    }
    if (questionIds === null) {
      process.stdout.write("[batch] 无法确定批次题集。\n");
      return 2;
    }
    try {
      preflightQuestionIds(questionIds);
    } catch (error) {
      process.stdout.write(`[batch] ${describe(error)}\n`);
      return 2;
    }
    if (openedManifest !== null) {
      if (!dryRun) {
        const existingRuns = openedManifest.records.flatMap((record) => {
          if (record.runId === null) return [];
          const facts = store.batchRunFacts(record.runId);
          return facts === null ? [] : [facts];
        });
        const resumeAdmission = admitPaidBatch({
          stage: "resume",
          questionIds,
          noMemory,
          confirmedScience125,
          sourceIdentity: launchAdmission.plan.sourceIdentity,
          existingRuns,
        });
        if (!resumeAdmission.admitted) {
          process.stdout.write(`[batch] ${resumeAdmission.error}\n`);
          return 2;
        }
      }
    }
    const report = await runBatch(questionIds, {
      store,
      // dry-run 一次运行都不发起，所以也不构造需要 QWEN_API_KEY 的执行器。
      runQuestion: dryRun
        ? () => Promise.reject(new Error("dry-run 不执行"))
        : createHarnessRunner(
            store,
            launchAdmission.plan.memoryArm === "off" ? null : createCampaignMemory(repoRoot, dbPath),
          ),
      repoRoot,
      dryRun,
      concurrency,
      memoryArm: launchAdmission.plan.memoryArm,
      sourceIdentity: launchAdmission.plan.sourceIdentity,
      manifestId,
    });
    if (dryRun && !manifestId) process.stdout.write("[batch] dry-run 不创建 manifest。\n");
    // A full-batch exit code requires both clean outcomes and exact manifest coverage.
    // `--dry-run` is a planning command, so it may intentionally have omitted terminals.
    return (dryRun || report.manifest.complete) && report.outcomes.every((item) => CLEAN.has(item.status)) ? 0 : 1;
  } finally {
    store.close();
  }
}

if (import.meta.filename === process.argv[1]) {
  process.exitCode = await main();
}
