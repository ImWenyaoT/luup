/** 离线指标：从一个跑完的 SQLite 库读出预注册协议要的那几个数。
 *
 * 移植自 Python 期 `app/evaluation.py`（ADR-0004 已删），按 TS 栈的事实面重写而不是逐行翻译。口径必须
 * 跟着执行栈变，其余一字不动：
 *
 * - **记忆泄漏**改成**记忆注入**。Python 有 `memory_search` 工具，所以泄漏度量的是
 *   「模型自己读了几次记忆」；TS 栈没有这个工具，记忆通道只有开局那一次确定性注入，
 *   于是唯一该数的是 `campaign.prior_attempts` 事件里的条数。消融生效门随之变成
 *   「off 臂注入条数必须为 0」——被消融的是数据通道本身，不是一个返回空结果的工具。
 * - **corrections** 直接读 `attempts.corrections`：一个业务 Attempt 内的一次结构化纠错，
 *   Python 期没有对应字段。它不是「重试」，`no_retry` 契约不受影响。
 *
 * 与 `scoring.ts` 分工不同、故意不互相 import：scoring 给单个 Run 打过程分（六分制），
 * 这里做的是跨 Run 的率与配对比较。两份文件各自重写 URL 归一化之类的小工具，
 * 理由同 scoring.ts 顶部所述 —— 评估口径必须比被评的代码更稳定。
 *
 *     bun run eval --db outputs/runtime/typescript-runs.db
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Database } from "bun:sqlite";
import { parseArgs } from "node:util";

import { resolveManifestRunScope, type ManifestRunScope } from "../reporting/manifest-scope.ts";

/** 不反映提案质量的失败类别：环境、供应商、凭据、超时 —— 换个模型再跑一遍也修不掉，
 *  只有改环境才修得掉。质量分母把它们整个排除。
 *
 * 写成字面量而不是 import `agent/failures.ts`，是为了让离线评估不反向依赖生产 agent 代码 ——
 * 改 agent 不该改掉历史跑批的读数。它与那边的 `INFRASTRUCTURE_FAILURE_CODES` **不再是同一个
 * 集合**，两者回答的是两个问题：那边是**熔断口径**（连续 2 次即停批），只有 `infra_error` /
 * `infra_timeout` 两个码，且已作为 `controls.batch_circuit_breakers.outage_classes` 写进预注册
 * 协议，不得因读数需要而改动；这里是**读数口径**，按「谁能修」分桶。同一个码可以既不停批又该被
 * 剔出质量分母（`provider_error`），这是两个口径本来就该分开的理由。 */
export const INFRASTRUCTURE_CLASSES: ReadonlySet<string> = new Set([
  "infra_error",
  "infra_timeout",
  "missing_credential",
  "provider_error",
  "deadline_exceeded",
]);

/** 反映提案质量的失败类别：责任在 harness 或模型自己，改我们的代码/提示/输入就能修，
 *  因此必须留在质量分母里被看见。
 *
 * `context_overflow` 属这里不属环境类：上下文塞爆是我们塞多了，不是 provider 宕机（Wave 3 裁决，
 * 见 `docs/design/dsh-borrowings.md`）。`runtime_error` 同理 —— 它是 harness 自己抛出的、没被
 * 归类的异常（`src/harness.ts` 的 catch 兜底、`src/server.ts` 的 promise 兜底），是我们的 bug，
 * 不给它一张环境类的免票。 */
export const QUALITY_CLASSES: ReadonlySet<string> = new Set([
  "invalid_output",
  "verifier_refs",
  "context_overflow",
  "runtime_error",
]);

/** `review_rejected` **不是** failure code：它是 Reviewer 否决后的终态（`runs.status`），
 *  harness 把同名字符串一并写进 `error_code` 只是为了让终态自证。它是**质量判定的未交付**，
 *  在失败分类里单列一档，既不混进 quality 的码分布，也不进 infrastructure ——
 *  M4 的两个分母都照旧算它一个未交付。 */
export const REVIEW_REJECTED = "review_rejected";

/** 开局注入了几条战役记录，落在这个事件里。消融生效门读它。 */
export const INJECTION_EVENT = "campaign.prior_attempts";

const ARXIV_TOOL = "arxiv_search";

type Row = Record<string, unknown>;

/** 一个 Run 的一行规范化事实。缺失一律保留成 null，绝不用零顶替。 */
export type RunFacts = {
  readonly runId: string;
  readonly questionId: number | null;
  readonly status: string;
  readonly errorCode: string | null;
  readonly memoryArm: string | null;
  /** 产出这个 Run 的代码版本标签：`<commit>` / `<commit>+dirty` / `unknown`。 */
  readonly cohort: string;
  readonly deliverable: boolean;
  readonly attempts: number;
  readonly correctedAttempts: number;
  readonly corrections: number | null;
  /** Attempts whose correction count was missing or malformed. */
  readonly unknownCorrectionAttempts: number;
  /** 走到过 Reviewer（有一个完成的 reviewer Attempt）。 */
  readonly reviewed: boolean;
  /** 终态是 review_rejected：Reviewer 的否决没有被一次修订救回来。 */
  readonly rejected: boolean;
  readonly arxivCalls: number;
  /** 本 Run 内去重后的 arXiv query 数。等于调用数说明一次没重复查。 */
  readonly distinctQueries: number;
  /** 开局注入的战役记录条数；库里没有这条事件时为 null（「不知道」不是 0）。 */
  readonly injected: number | null;
};

/** off 臂的 run 必须什么都没读到，否则它不是对照臂。
 *
 * 依据与 Python `RunFacts.ablation_effective` 同源，判据换成 TS 栈唯一的记忆通道：
 * 注入条数。没有注入事件的 run（Wave 1 之前建的库）算不出泄漏，不据此判失效，
 * 但会在 `runsWithoutInjectionEvent` 里单列，读数的人自己决定信不信。
 */
export function ablationEffective(facts: RunFacts): boolean | null {
  if (facts.memoryArm !== "off") return true;
  if (facts.injected === null) return null;
  return facts.injected === 0;
}

// --- 从 SQLite 读事实 ---------------------------------------------------

const text = (value: unknown): string | null => (typeof value === "string" && value ? value : null);
const count = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;

function injectionCount(row: Row | undefined): number | null {
  if (!row) return null;
  try {
    const value = (JSON.parse(String(row.payload_json)) as { count?: unknown }).count;
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
  } catch {
    return null;
  }
}

/** 折叠空白并转小写：判断两次检索是不是「同一次查询」。 */
export function normalizeQuery(value: string): string {
  return value.split(/\s+/).filter(Boolean).join(" ").toLowerCase();
}

function cohortLabel(raw: unknown): string {
  const json = text(raw);
  if (json === null) return "unknown";
  let parsed: { gitCommit?: unknown; treeDirty?: unknown };
  try {
    parsed = JSON.parse(json);
  } catch {
    return "unknown";
  }
  const commit = text(parsed.gitCommit);
  if (commit === null) return "unknown";
  // 工作树不干净时 commit 不唯一标识实际跑的代码，`+dirty` 必须进标签。
  return parsed.treeDirty === true ? `${commit}+dirty` : commit;
}

/** 把一个库里所有 Run 读成 RunFacts。只读打开，绝不会写到被评的库。 */
export function loadRunFacts(dbPath: string, manifestId?: string): RunFacts[] {
  const db = new Database(dbPath, { readonly: true });
  try {
    const scope = manifestId === undefined ? undefined : resolveManifestRunScope(db, manifestId);
    return loadRunFactsFromDatabase(db, scope);
  } finally {
    db.close();
  }
}

function loadRunFactsFromDatabase(db: Database, scope?: ManifestRunScope): RunFacts[] {
  // memory_arm 是 Wave 2 才补的列。评估是只读的，补不了列，所以缺列时读 null
  // 而不是让整份报告炸掉 —— 老库仍要能被读出交付率。
  const columns = new Set(
    (db.prepare("PRAGMA table_info(runs)").all() as Array<{ name: string }>).map((item) => item.name),
  );
  const arm = columns.has("memory_arm") ? "memory_arm" : "NULL AS memory_arm";
  const attemptColumns = new Set(
    (db.prepare("PRAGMA table_info(attempts)").all() as Array<{ name: string }>).map((item) => item.name),
  );
  const corrections = attemptColumns.has("corrections") ? "corrections" : "NULL AS corrections";
  const runs = db
    .prepare(
      `SELECT id, science125_id, status, error_code, source_identity_json, ${arm} ` +
        "FROM runs ORDER BY created_at, rowid",
    )
    .all() as Row[];
  return runs
    .filter((run) => scope === undefined || scope.includedRunIds.includes(String(run.id)))
    .map((run) => collectRunFacts(db, run, corrections));
}

function collectRunFacts(db: Database, run: Row, correctionsColumn: string): RunFacts {
  const runId = String(run.id);
  const attempts = db
    .prepare(`SELECT role, status, ${correctionsColumn} FROM attempts WHERE run_id = ?`)
    .all(runId) as Row[];
  const queries = (
    db
      .prepare(
        `SELECT te.query FROM tool_evidence AS te JOIN attempts AS a ON a.id = te.attempt_id
     WHERE a.run_id = ? AND te.tool_name = ?`,
      )
      .all(runId, ARXIV_TOOL) as Row[]
  ).map((row) => normalizeQuery(String(row.query)));
  const injection = db
    .prepare("SELECT payload_json FROM events WHERE run_id = ? AND kind = ? ORDER BY version LIMIT 1")
    .get(runId, INJECTION_EVENT) as Row | undefined;

  const questionId = run.science125_id;
  const correctionValues = attempts.map((item) => count(item.corrections));
  const unknownCorrectionAttempts = correctionValues.filter((value) => value === null).length;
  const knownCorrections = correctionValues.filter((value): value is number => value !== null);
  return {
    runId,
    questionId: typeof questionId === "number" ? questionId : null,
    status: String(run.status),
    errorCode: text(run.error_code),
    memoryArm: text(run.memory_arm),
    cohort: cohortLabel(run.source_identity_json),
    deliverable: run.status === "completed",
    attempts: attempts.length,
    correctedAttempts: knownCorrections.filter((value) => value > 0).length,
    corrections: unknownCorrectionAttempts > 0 ? null : knownCorrections.reduce((sum, value) => sum + value, 0),
    unknownCorrectionAttempts,
    reviewed: attempts.some((item) => item.role === "reviewer" && item.status === "completed"),
    rejected: run.status === "review_rejected",
    arxivCalls: queries.length,
    distinctQueries: new Set(queries).size,
    injected: injectionCount(injection),
  };
}

// --- 指标（纯函数） -----------------------------------------------------

export type Proportion = { rate: number | null; se: number | null };

/** 比例与它的二项标准误 √(p(1-p)/n)。分母为 0 时两者都是 null，不是 0。 */
export function proportion(successes: number, total: number): Proportion {
  if (total <= 0) return { rate: null, se: null };
  const rate = successes / total;
  return { rate, se: Math.sqrt((rate * (1 - rate)) / total) };
}

const ratio = (part: number, total: number): number | null => (total > 0 ? part / total : null);

/** M4 交付率，两个分母都报：总体 + 剔除 infrastructure。
 *
 * 质量口径把 `INFRASTRUCTURE_CLASSES` 里的失败整个剔出分母 —— arXiv 不可达、provider 报错、
 * 缺凭据、超时，都不是科研质量的证据。`review_rejected` 与 unclassified **不剔**：前者是质量
 * 判定的未交付，后者存疑，两者都得留在质量分母里被看见。 */
export function deliveryRate(facts: readonly RunFacts[]) {
  const quality = facts.filter((item) => item.deliverable || !INFRASTRUCTURE_CLASSES.has(item.errorCode ?? ""));
  const delivered = facts.filter((item) => item.deliverable).length;
  const deliveredQuality = quality.filter((item) => item.deliverable).length;
  return {
    runs: facts.length,
    deliverable: delivered,
    ...proportion(delivered, facts.length),
    excludingInfrastructure: {
      runs: quality.length,
      deliverable: deliveredQuality,
      ...proportion(deliveredQuality, quality.length),
    },
  };
}

/** 按题分组并按时间排序。同毫秒的多条靠读取顺序（created_at, rowid）兜底。 */
function byQuestion(facts: readonly RunFacts[]): Array<[number, RunFacts[]]> {
  const groups = new Map<number, RunFacts[]>();
  for (const item of facts) {
    if (item.questionId === null) continue;
    const bucket = groups.get(item.questionId);
    if (bucket) bucket.push(item);
    else groups.set(item.questionId, [item]);
  }
  return [...groups].sort(([left], [right]) => left - right);
}

/** M5 Pass^2：同题**时间相邻**两个 run 都交付的比例。
 *
 * 口径按预注册协议 declarations.pass_squared：这是**机会样本**，不是设计的 k=2 独立重复
 * 采样 —— 两条 run 之间可能隔着 harness 改动与不同的记忆状态。报告引用它必须带上这句。
 */
export function passSquared(facts: readonly RunFacts[]) {
  let pairs = 0;
  let both = 0;
  for (const [, group] of byQuestion(facts)) {
    for (let index = 1; index < group.length; index += 1) {
      pairs += 1;
      if (group[index - 1]!.deliverable && group[index]!.deliverable) both += 1;
    }
  }
  return { pairs, both, ...proportion(both, pairs) };
}

/** 结构化纠错的用量。分母是 Attempt，不是 Run：纠错是 Attempt 内的第二次调用。 */
export function correctionRate(facts: readonly RunFacts[]) {
  const attempts = facts.reduce((sum, item) => sum + item.attempts, 0);
  const unknownAttempts = facts.reduce((sum, item) => sum + item.unknownCorrectionAttempts, 0);
  const knownAttempts = attempts - unknownAttempts;
  const corrected = facts.reduce((sum, item) => sum + item.correctedAttempts, 0);
  const knownCorrections = facts.every((item) => item.corrections !== null)
    ? facts.reduce((sum, item) => sum + (item.corrections ?? 0), 0)
    : null;
  return {
    attempts,
    knownAttempts,
    unknownAttempts,
    correctedAttempts: corrected,
    corrections: knownCorrections,
    ...proportion(corrected, knownAttempts),
  };
}

/** Reviewer 否决率：走到过评审的 run 里，最终仍以 review_rejected 收场的比例。
 *
 * 分母只算真的被评审过的 run —— 半路挂在 researcher 上的 run 没给 Reviewer 表态的机会，
 * 把它算进分母会把执行故障读成「评审很宽松」。
 */
export function reviewRejectionRate(facts: readonly RunFacts[]) {
  const reviewed = facts.filter((item) => item.reviewed).length;
  const rejected = facts.filter((item) => item.rejected).length;
  return { reviewed, rejected, ...proportion(rejected, reviewed) };
}

/** 检索健康：调用了多少次 arXiv，其中有多少次是换了词的。 */
export function searchHealth(facts: readonly RunFacts[]) {
  const calls = facts.reduce((sum, item) => sum + item.arxivCalls, 0);
  const distinct = facts.reduce((sum, item) => sum + item.distinctQueries, 0);
  return {
    runsWithSearches: facts.filter((item) => item.arxivCalls > 0).length,
    arxivCalls: calls,
    distinctQueries: distinct,
    // 同一个 run 里把同一句话查了两遍的比例。高说明 researcher 在原地打转。
    repeatedRate: ratio(calls - distinct, calls),
  };
}

/** 记忆注入统计 + 消融生效门。TS 栈唯一的记忆通道就是这条注入。 */
export function memoryInjection(facts: readonly RunFacts[]) {
  const known = facts.filter((item) => item.injected !== null);
  const entries = known.reduce((sum, item) => sum + item.injected!, 0);
  return {
    runsWithInjectionEvent: known.length,
    runsWithoutInjectionEvent: facts.length - known.length,
    runsWithPriorAttempts: known.filter((item) => item.injected! > 0).length,
    entries,
    entriesPerRun: ratio(entries, known.length),
    byArm: {
      on: known.filter((item) => item.memoryArm === "on").reduce((sum, item) => sum + item.injected!, 0),
      off: known.filter((item) => item.memoryArm === "off").reduce((sum, item) => sum + item.injected!, 0),
      unlabelled: known.filter((item) => item.memoryArm === null).reduce((sum, item) => sum + item.injected!, 0),
    },
    // 消融失效：off 臂却读到了记忆。这些 run 不是对照，必须剔出配对。
    ablationIneffectiveRuns: facts.filter((item) => ablationEffective(item) === false).map((item) => item.runId),
    ablationUnknownRuns: facts.filter((item) => ablationEffective(item) === null).map((item) => item.runId),
  };
}

/** 未交付的构成：review_rejected 单列，其余按 quality / infrastructure / unclassified 三桶分。
 *
 * 桶归属由上面两个字面量集合**穷举**，不再用「非环境即质量」的补集推断：补集会让任何一个
 * 没被裁决过的码（老库里的 Python 期分类、将来新加的码）自动获得质量类身份，读数的人看不出
 * 它其实没被裁决过。落不进任何一个集合的码进 unclassified 并在那里列出码名 ——
 * 「不知道」必须长得像不知道。
 *
 * 四档之和 = failed（未交付 run 数）。unclassified 的 run 仍留在 M4 的质量分母里：
 * 只有被明确裁决为环境类的才有资格被剔除，存疑一律不给免票。
 */
export function failureClasses(facts: readonly RunFacts[]) {
  const failed = facts.filter((item) => !item.deliverable);
  const tally = (group: readonly RunFacts[]) => {
    const counts: Record<string, number> = {};
    for (const item of group) {
      if (item.errorCode) counts[item.errorCode] = (counts[item.errorCode] ?? 0) + 1;
    }
    return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
  };
  // 终态是 review_rejected 的 run 先摘出去：它不是失败分类，是质量判定的未交付。
  // 老库里可能只有 status 没写 error_code，两种形状都认。
  const isRejected = (item: RunFacts): boolean => item.rejected || item.errorCode === REVIEW_REJECTED;
  const rejected = failed.filter(isRejected);
  const classified = failed.filter((item) => !isRejected(item));
  const infrastructure = classified.filter((item) => INFRASTRUCTURE_CLASSES.has(item.errorCode ?? ""));
  const quality = classified.filter((item) => QUALITY_CLASSES.has(item.errorCode ?? ""));
  const unclassified = classified.filter(
    (item) => !INFRASTRUCTURE_CLASSES.has(item.errorCode ?? "") && !QUALITY_CLASSES.has(item.errorCode ?? ""),
  );
  return {
    failed: failed.length,
    reviewRejected: rejected.length,
    infrastructure: { count: infrastructure.length, byClass: tally(infrastructure) },
    quality: { count: quality.length, byClass: tally(quality) },
    unclassified: { count: unclassified.length, byClass: tally(unclassified) },
  };
}

/** 按代码版本分 cohort，各组独立报交付率。dirty tree 自成一组。 */
export function cohorts(facts: readonly RunFacts[]): Record<string, ReturnType<typeof deliveryRate>> {
  const groups = new Map<string, RunFacts[]>();
  for (const item of facts) {
    const bucket = groups.get(item.cohort);
    if (bucket) bucket.push(item);
    else groups.set(item.cohort, [item]);
  }
  return Object.fromEntries(
    [...groups]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([label, group]) => [label, deliveryRate(group)]),
  );
}

export type McNemar = {
  questions: Array<{ questionId: number; off: string; on: string; offPass: boolean; onPass: boolean }>;
  b: number;
  c: number;
  discordant: number;
  p: number;
  significant: boolean;
  concordantPass: number;
  concordantFail: number;
  regressionRate: number | null;
  excludedRuns: Array<{ questionId: number; runId: string; reason: string }>;
};

/** 精确二项双侧检验。n≈10 时 χ² 近似不可靠，所以直接算尾概率。 */
function exactBinomial(b: number, c: number): number {
  const discordant = b + c;
  if (discordant === 0) return 1;
  let tail = 0;
  for (let index = 0; index <= Math.min(b, c); index += 1) tail += choose(discordant, index);
  return Math.min(1, 2 * tail * 0.5 ** discordant);
}

function choose(n: number, k: number): number {
  let result = 1;
  for (let index = 0; index < k; index += 1) result = (result * (n - index)) / (index + 1);
  return result;
}

/** 同题 off/on 配对的 McNemar 2×2 表。baseline 是 off 臂，treatment 是 on 臂。
 *
 * 每题最多取一对：最新的**有效** off run 与最新的 on run。仍读到记忆的 off run 不是
 * 对照，剔出配对并单列 —— 让它进表，比较的就不再是「有记忆 vs 无记忆」。
 * 协议 statistics 已预先声明只报方向、cell 计数与效应量，`p` / `significant` 留在
 * JSON 里是为了样本足够时能复用同一条链路，本轮报告不得引用。
 */
export function memoryArmComparison(facts: readonly RunFacts[]): McNemar | null {
  const rows: McNemar["questions"] = [];
  const excluded: McNemar["excludedRuns"] = [];
  for (const [questionId, group] of byQuestion(facts)) {
    for (const item of group) {
      const effective = ablationEffective(item);
      if (item.memoryArm === "off" && effective !== true) {
        excluded.push({
          questionId,
          runId: item.runId,
          reason: effective === false ? "消融失效：off 臂仍被注入跨 run 记忆" : "消融状态未知：缺少有效注入事件",
        });
      }
    }
    const off = group.filter((item) => item.memoryArm === "off" && ablationEffective(item) === true).at(-1);
    const on = group.filter((item) => item.memoryArm === "on").at(-1);
    if (!off || !on) continue;
    rows.push({
      questionId,
      off: off.runId,
      on: on.runId,
      offPass: off.deliverable,
      onPass: on.deliverable,
    });
  }
  if (rows.length === 0 && excluded.length === 0) return null;

  const b = rows.filter((row) => !row.offPass && row.onPass).length;
  const c = rows.filter((row) => row.offPass && !row.onPass).length;
  const concordantPass = rows.filter((row) => row.offPass && row.onPass).length;
  const p = exactBinomial(b, c);
  return {
    questions: rows,
    b,
    c,
    discordant: b + c,
    p,
    significant: p < 0.05,
    concordantPass,
    concordantFail: rows.filter((row) => !row.offPass && !row.onPass).length,
    // 「没变差」比「变好」更容易由数据支持：off 已经能过的题里，开记忆后反而挂掉的比例。
    // baseline 一道都没过时分母不存在，报 null 而不是 0。
    regressionRate: ratio(c, concordantPass + c),
    excludedRuns: excluded,
  };
}

export type MetricsReport = ReturnType<typeof evaluate>;

export type MetricsManifestScope = {
  manifest_id: string;
  included_run_count: number;
  excluded_db_run_count: number;
  excluded_db_run_ids: string[];
};

function manifestScopeReport(scope: ManifestRunScope): MetricsManifestScope {
  return {
    manifest_id: scope.manifestId,
    included_run_count: scope.includedRunIds.length,
    excluded_db_run_count: scope.excludedDbRunIds.length,
    excluded_db_run_ids: [...scope.excludedDbRunIds],
  };
}

/** 一整份离线报告。输入是一组 RunFacts，输出是纯 JSON —— 不读时钟、不碰网络。 */
export function evaluate(facts: readonly RunFacts[], source: string, scope?: ManifestRunScope) {
  const identified = facts.filter((item) => item.questionId !== null);
  const report = {
    source,
    runs: facts.length,
    statistics: {
      delivery: deliveryRate(facts),
      sourceIdentity: cohorts(facts),
      passSquared: passSquared(identified),
      corrections: correctionRate(facts),
      review: reviewRejectionRate(facts),
      searchHealth: searchHealth(facts),
      memoryInjection: memoryInjection(facts),
      failureClasses: failureClasses(facts),
    },
    pairedComparison: { memoryArms: memoryArmComparison(identified) },
  };
  return (scope === undefined ? report : { ...report, manifest_scope: manifestScopeReport(scope) }) as typeof report & {
    manifest_scope?: MetricsManifestScope;
  };
}

export function evaluateDatabase(dbPath: string, manifestId?: string): MetricsReport {
  const db = new Database(dbPath, { readonly: true });
  try {
    const scope = manifestId === undefined ? undefined : resolveManifestRunScope(db, manifestId);
    return evaluate(loadRunFactsFromDatabase(db, scope), resolve(dbPath), scope);
  } finally {
    db.close();
  }
}

// --- Markdown 报告 ------------------------------------------------------

const pct = (value: number | null): string => (value === null ? "—" : `${(value * 100).toFixed(1)}%`);
const pm = (value: Proportion): string =>
  value.rate === null ? "—" : `${pct(value.rate)} ± ${(value.se! * 100).toFixed(1)}pp`;

export function renderMarkdown(report: MetricsReport): string {
  const { statistics: stats, pairedComparison } = report;
  const lines = [
    "# Science-125 离线指标",
    "",
    `- 数据源：\`${report.source}\``,
    `- Run 总数：${report.runs}`,
    ...(report.manifest_scope === undefined
      ? []
      : [
          `- Manifest：\`${report.manifest_scope.manifest_id}\`；纳入 Run：${report.manifest_scope.included_run_count}；` +
            `排除的 DB Run：${report.manifest_scope.excluded_db_run_count}`,
          report.manifest_scope.excluded_db_run_count === 0
            ? "- 排除的 DB Run IDs：无"
            : `- 排除的 DB Run IDs：${report.manifest_scope.excluded_db_run_ids.join("、")}`,
        ]),
    "",
    "## 交付率（M4）",
    "",
    "| 分母 | Run 数 | 交付 | 率 ± SE |",
    "| --- | ---: | ---: | ---: |",
    `| 全部 | ${stats.delivery.runs} | ${stats.delivery.deliverable} | ${pm(stats.delivery)} |`,
    `| 剔除 infra 类 | ${stats.delivery.excludingInfrastructure.runs} | ` +
      `${stats.delivery.excludingInfrastructure.deliverable} | ${pm(stats.delivery.excludingInfrastructure)} |`,
    "",
    "## 按代码版本分组",
    "",
    "| cohort | Run 数 | 交付 | 率 ± SE |",
    "| --- | ---: | ---: | ---: |",
    ...Object.entries(stats.sourceIdentity).map(
      ([label, group]) => `| \`${label}\` | ${group.runs} | ${group.deliverable} | ${pm(group)} |`,
    ),
    "",
    "## 过程指标",
    "",
    "| 指标 | 分子 / 分母 | 率 |",
    "| --- | ---: | ---: |",
    `| Pass^2（同题相邻两 run，机会样本） | ${stats.passSquared.both} / ${stats.passSquared.pairs} | ` +
      `${pct(stats.passSquared.rate)} |`,
    `| 结构化纠错 | ${stats.corrections.correctedAttempts} / ${stats.corrections.knownAttempts} 已知 Attempt | ` +
      `${pct(stats.corrections.rate)}（未知 ${stats.corrections.unknownAttempts}） |`,
    `| Reviewer 否决 | ${stats.review.rejected} / ${stats.review.reviewed} 已评审 | ${pct(stats.review.rate)} |`,
    `| 重复检索 | ${stats.searchHealth.arxivCalls - stats.searchHealth.distinctQueries} / ` +
      `${stats.searchHealth.arxivCalls} 次 arXiv | ${pct(stats.searchHealth.repeatedRate)} |`,
    "",
    "## 记忆注入与消融生效门",
    "",
    `- 有注入事件的 run：${stats.memoryInjection.runsWithInjectionEvent}` +
      `（缺事件 ${stats.memoryInjection.runsWithoutInjectionEvent}）`,
    `- 注入条数合计：${stats.memoryInjection.entries}` +
      `（on ${stats.memoryInjection.byArm.on} / off ${stats.memoryInjection.byArm.off}` +
      ` / 未标臂 ${stats.memoryInjection.byArm.unlabelled}）`,
    `- 消融失效的 run：${stats.memoryInjection.ablationIneffectiveRuns.length}` +
      (stats.memoryInjection.ablationIneffectiveRuns.length > 0
        ? ` — ${stats.memoryInjection.ablationIneffectiveRuns.join("、")}`
        : "（off 臂注入恒为 0，消融成立）"),
    "",
    "## 失败分类",
    "",
    `- 未交付：${stats.failureClasses.failed}`,
    `- 质量类 ${stats.failureClasses.quality.count}：${JSON.stringify(stats.failureClasses.quality.byClass)}`,
    `- 环境类 ${stats.failureClasses.infrastructure.count}：` +
      JSON.stringify(stats.failureClasses.infrastructure.byClass),
    `- Reviewer 否决（review_rejected，不是 failure code）：${stats.failureClasses.reviewRejected}`,
    `- 未分类 ${stats.failureClasses.unclassified.count}：` + JSON.stringify(stats.failureClasses.unclassified.byClass),
    "",
    "> 桶归属按「谁能修」裁决：环境类（infra_error / infra_timeout / missing_credential /",
    "> provider_error / deadline_exceeded）剔出质量分母；质量类（invalid_output / verifier_refs /",
    "> context_overflow / runtime_error）留在分母里。review_rejected 单列，未分类不给免票。",
    "",
  ];

  const paired = pairedComparison.memoryArms;
  lines.push("## 记忆消融配对（McNemar）", "");
  if (paired === null) {
    lines.push("库里没有可配对的 on/off 同题 run。", "");
  } else {
    lines.push(
      `- 配对题数：${paired.questions.length}`,
      `- b（off 挂 ∧ on 过）：${paired.b}；c（off 过 ∧ on 挂）：${paired.c}；` + `不一致对：${paired.discordant}`,
      `- 一致通过：${paired.concordantPass}；一致失败：${paired.concordantFail}`,
      `- regressionRate = c/(concordantPass+c)：${pct(paired.regressionRate)}`,
      `- 被剔除的 off run：${paired.excludedRuns.length}`,
      "",
      "> 预注册协议只允许报方向、cell 计数与效应量；p 值与 significant 字段不得引用。",
      "",
    );
  }
  return `${lines.join("\n").replace(/\s+$/, "")}\n`;
}

function main(): void {
  const { values } = parseArgs({
    options: { db: { type: "string" }, out: { type: "string" }, "manifest-id": { type: "string" } },
  });
  if (!values.db) {
    console.error("用法：metrics.ts --db <runs.db> [--out <report.md>] [--manifest-id <id>]");
    process.exit(2);
  }
  const report = evaluateDatabase(values.db, values["manifest-id"]);
  if (values.out) {
    mkdirSync(dirname(resolve(values.out)), { recursive: true });
    writeFileSync(values.out, renderMarkdown(report), "utf8");
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === import.meta.filename) {
  main();
}
