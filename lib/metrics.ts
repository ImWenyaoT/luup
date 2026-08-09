/**
 * **Tier1 派生指标（criteria H）—— M4 交付率 / M5 Pass^2 / M6 成本 / M7 返工 / M8 文献健康。**
 *
 * 三条硬纪律，写在最前面，因为它们决定了这个模块能做什么、不能做什么：
 *
 * 1. **零 LLM。** 本文件不 import 任何模型、不发任何网络请求。指标必须能在断网、
 *    没有 API key 的机器上复算 —— 否则它就不是「评估系统」，而是被评估系统的一部分。
 * 2. **零新增采集。** 数据源只有既有工件：`runOutcome`（终态）、`verdicts/`（返工）、
 *    `usage.jsonl`（成本）、`meta.json` / `question.md`（题号）、`memory/papers/`（文献）。
 *    新增采集面 = 新增一份会与真相分叉的第二事实源（docs/design/backlog.md 已按同一
 *    理由否掉统一 trace）。
 * 3. **判定不重写。** 「这个 run 算不算交付」只有一个 owner（`lib/runOutcome.ts`），
 *    「这个节点跑了几轮、熔没熔断」只有一个 owner（`lib/rework.ts`）。本文件只做聚合，
 *    一旦在这里重写判据，仪表台与批次报告就会对同一个目录给出两个答案 —— 那正是
 *    ch6 L670「性能下降先查评估系统」说的那类故障。
 *
 * ## interface 就是 test surface
 *
 * 每个指标都是**纯函数 + 一个读盘 adapter**（与 runOutcome / rework 同构）：
 * `aggregateUsage` / `reworkMetrics` / `literatureMetrics` / `deliveryRate` / `passSquared`
 * / `libraryReuse` / `mcnemar` 不碰 fs，`readRunMetrics(dir)` 是唯一的读盘入口。
 * scripts/selftest-metrics.ts 因此能对仓库现有 runs/ 做钉死期望值的可复算断言。
 */
import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { arxivIdFromFilename } from "#lib/paperStore.ts";
import { RUNS_DIR } from "./paths.ts";
import { parseQuestion } from "./questionText.ts";
import { isRunId } from "./runId.ts";
import {
  REWORK_NODES,
  type ReworkEvidence,
  type ReworkNode,
  isRejectedDraft,
  readVerdictEvidence,
  reworkBudget,
} from "./rework.ts";
import { type RunPhase, readRunEvidence, runOutcome } from "./runOutcome.ts";

/* ================================================================== */
/* M6 成本会计                                                          */
/* ================================================================== */

/**
 * 一次调用或一组调用的 token 计数。字段名对齐 `usage.jsonl` 里百炼返回的原始口径
 * （`agent/lib/model.ts` 的 teeUsage 原样落盘），不做二次命名。
 *
 * `cached` 是 input 的**子集**（`input_tokens_details.cached_tokens`），不参与求和 ——
 * 把它加进 total 会把同一段前缀数两遍。
 */
export type TokenTotals = {
  calls: number;
  input: number;
  output: number;
  /** output 的子集：思考链 token（`output_tokens_details.reasoning_tokens`）。 */
  reasoning: number;
  /** input 的子集：命中前缀缓存的部分。 */
  cached: number;
  total: number;
};

/**
 * thinking 档：`enable_thinking` 是 luup 唯一能真正关掉推理的开关（见 agent/lib/model.ts），
 * 而它带来的 token 放大约 7 倍 —— 成本必须按档拆开看，混在一起的 token/题没有决策价值。
 * `unknown` 是老 usage.jsonl（没有 thinking 字段）的去处：缺失不冒充 false。
 */
export type ThinkingTier = "thinking" | "plain" | "unknown";

export type UsageAggregate = { all: TokenTotals; byTier: Record<ThinkingTier, TokenTotals> };

export const emptyTotals = (): TokenTotals => ({ calls: 0, input: 0, output: 0, reasoning: 0, cached: 0, total: 0 });

/** usage.jsonl 的一行。 */
export type UsageSample = { atMs: number | null; tier: ThinkingTier; totals: TokenTotals };

const int = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : 0);

/**
 * `usage.jsonl` 原文 → 逐行样本。**坏行跳过，不抛**：用量是尽力而为的凭据
 * （teeUsage 本身也是静默失败的），一行写坏不该让整份成本报告消失。
 */
export function parseUsageLines(text: string | null | undefined): UsageSample[] {
  if (!text) return [];
  const out: UsageSample[] = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(t);
    } catch {
      continue;
    }
    if (typeof raw !== "object" || raw === null) continue;
    const rec = raw as Record<string, unknown>;
    const u = (typeof rec.usage === "object" && rec.usage !== null ? rec.usage : {}) as Record<string, unknown>;
    const outDetails = (u.output_tokens_details ?? {}) as Record<string, unknown>;
    const inDetails = (u.input_tokens_details ?? {}) as Record<string, unknown>;
    const input = int(u.input_tokens);
    const output = int(u.output_tokens);
    const at = typeof rec.at === "string" ? Date.parse(rec.at) : Number.NaN;
    out.push({
      atMs: Number.isNaN(at) ? null : at,
      tier: rec.thinking === true ? "thinking" : rec.thinking === false ? "plain" : "unknown",
      totals: {
        calls: 1,
        input,
        output,
        reasoning: int(outDetails.reasoning_tokens),
        cached: int(inDetails.cached_tokens),
        // total 缺省时按 input+output 兜底：老格式没有 total_tokens，硬记 0 会让成本凭空消失
        total: int(u.total_tokens) || input + output,
      },
    });
  }
  return out;
}

function addInto(acc: TokenTotals, t: TokenTotals): void {
  acc.calls += t.calls;
  acc.input += t.input;
  acc.output += t.output;
  acc.reasoning += t.reasoning;
  acc.cached += t.cached;
  acc.total += t.total;
}

export function aggregateUsage(samples: UsageSample[]): UsageAggregate {
  const agg: UsageAggregate = {
    all: emptyTotals(),
    byTier: { thinking: emptyTotals(), plain: emptyTotals(), unknown: emptyTotals() },
  };
  for (const s of samples) {
    addInto(agg.all, s.totals);
    addInto(agg.byTier[s.tier], s.totals);
  }
  return agg;
}

/**
 * 单价表。**默认全为 null（未配置）**，此时 `costOf` 返回 null，报告里显示「—」。
 *
 * 这是有意的：仓库里没有任何一份可引用的百炼 qwen3.7-plus 报价单，把一个记忆里的数字
 * 硬编进来，会让 ¥/题 看起来像实测而其实是编的 —— 而 ¥/题 要用来拍板「全量 125 题跑不跑得起」。
 * 要出 ¥ 就显式配（下面三个环境变量），并在报告脚注里写清出处与日期。
 *
 * 出处（填数时请到这里核对并更新 `source`）：
 *   阿里云百炼「模型计费」控制台 → 通义千问-Plus 系列的输入/输出百万 token 单价。
 *   命中前缀缓存的 input 另有折扣价，本表**不建模**：usage.jsonl 里有 cached_tokens，
 *   要精算时再加一列 `cachedInputPerMTok`，别在这里拍脑袋打折。
 */
export type PriceTable = {
  currency: string;
  /** 每百万 input token 的价格；null = 未配置。 */
  inputPerMTok: number | null;
  /** 每百万 output token 的价格（含 reasoning —— 思考链按 output 计费）；null = 未配置。 */
  outputPerMTok: number | null;
  source: string;
};

export const PRICE_ENV = {
  input: "LUUP_PRICE_INPUT_PER_MTOK",
  output: "LUUP_PRICE_OUTPUT_PER_MTOK",
  currency: "LUUP_PRICE_CURRENCY",
} as const;

export const DEFAULT_PRICE_TABLE: PriceTable = {
  currency: "CNY",
  inputPerMTok: null,
  outputPerMTok: null,
  source: `未配置（设 ${PRICE_ENV.input} / ${PRICE_ENV.output}，出处填阿里云百炼计费页 + 查询日期）`,
};

const positive = (raw: string | undefined): number | null => {
  if (raw === undefined) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

export function priceTableFromEnv(env: Record<string, string | undefined> = process.env): PriceTable {
  const inputPerMTok = positive(env[PRICE_ENV.input]);
  const outputPerMTok = positive(env[PRICE_ENV.output]);
  if (inputPerMTok === null && outputPerMTok === null) return DEFAULT_PRICE_TABLE;
  return {
    currency: env[PRICE_ENV.currency]?.trim() || DEFAULT_PRICE_TABLE.currency,
    inputPerMTok,
    outputPerMTok,
    source: `环境变量 ${PRICE_ENV.input} / ${PRICE_ENV.output}`,
  };
}

/** 成本。任一单价未配置即返回 null —— 半张价目表算出来的钱比没有更危险。 */
export function costOf(t: TokenTotals, p: PriceTable): number | null {
  if (p.inputPerMTok === null || p.outputPerMTok === null) return null;
  return (t.input / 1e6) * p.inputPerMTok + (t.output / 1e6) * p.outputPerMTok;
}

/* ================================================================== */
/* M7 返工强度                                                          */
/* ================================================================== */

export type ReworkMetrics = {
  /** 每节点已落盘的语义轮数。 */
  rounds: Record<ReworkNode, number>;
  /** 每节点 verdict !== "pass" 的次数。 */
  rejects: Record<ReworkNode, number>;
  /** 每节点 `verdicts/<name>.rejected.json` 草稿数（master 把 verdict 写坏了）。 */
  formatRetries: Record<ReworkNode, number>;
  totalRounds: number;
  totalRejects: number;
  totalFormatRetries: number;
  /** 连续 reject 达熔断线的节点。 */
  circuitBroken: ReworkNode[];
  /** 预算耗尽（熔断或轮数用完）的节点。 */
  exhausted: ReworkNode[];
};

const zeroByNode = (): Record<ReworkNode, number> =>
  Object.fromEntries(REWORK_NODES.map((n) => [n, 0])) as Record<ReworkNode, number>;

/**
 * 返工强度。轮数/熔断的判定**整个借自 `reworkBudget`** —— 那是「还能不能再来一轮」的
 * 唯一 owner，指标层再数一遍就等于给「第几轮」造第二个答案。
 */
export function reworkMetrics(e: ReworkEvidence): ReworkMetrics {
  const budget = reworkBudget(e);
  const rounds = zeroByNode();
  const rejects = zeroByNode();
  const formatRetries = zeroByNode();
  const circuitBroken: ReworkNode[] = [];
  const exhausted: ReworkNode[] = [];

  for (const node of REWORK_NODES) {
    const b = budget[node];
    rounds[node] = b.semanticRounds;
    formatRetries[node] = b.formatRetries;
    if (b.verdict === "exhausted") {
      exhausted.push(node);
      if (b.governingCap === "node.circuitBreaker") circuitBroken.push(node);
    }
  }
  for (const v of e.verdicts) {
    if (v.verdict === "pass") continue;
    const node = v.node as ReworkNode;
    if (node in rejects) rejects[node] += 1;
  }

  const sum = (r: Record<ReworkNode, number>) => REWORK_NODES.reduce((a, n) => a + r[n], 0);
  return {
    rounds,
    rejects,
    formatRetries,
    totalRounds: sum(rounds),
    totalRejects: sum(rejects),
    totalFormatRetries: sum(formatRetries),
    circuitBroken,
    exhausted,
  };
}

/* ================================================================== */
/* M8 文献健康度                                                        */
/* ================================================================== */

export type LiteratureMetrics = {
  /** 本次 run 实检落盘的文献数（`memory/papers/*.md`）。 */
  papers: number;
  paperIds: string[];
  /** proposal 的引用条数；没有 proposal 时 null。 */
  refs: number | null;
  refIds: string[];
  /** 引用里落在本 run papers/ 的条数（B1 的确定性口径）；没有 proposal 时 null。 */
  refsInPapers: number | null;
  /** refsInPapers / refs；refs 为 0 或 null 时 null。 */
  hitRate: number | null;
};

export function literatureMetrics(input: { paperIds: string[]; refIds: string[] | null }): LiteratureMetrics {
  const paperIds = [...new Set(input.paperIds)].sort();
  const known = new Set(paperIds);
  const refIds = input.refIds ?? [];
  const refsInPapers = input.refIds === null ? null : refIds.filter((r) => known.has(r)).length;
  return {
    papers: paperIds.length,
    paperIds,
    refs: input.refIds === null ? null : refIds.length,
    refIds,
    refsInPapers,
    hitRate: refsInPapers === null || refIds.length === 0 ? null : refsInPapers / refIds.length,
  };
}

/** 跨 run 的文献复用：同一篇文献在更早的 run 里出现过几次。 */
export type LibraryReuse = {
  /** 累计保存次数（各 run 的 papers 数相加）。 */
  totalSaves: number;
  /** 去重后的文献数。 */
  distinct: number;
  /** (totalSaves - distinct) / totalSaves；没有保存过任何文献时 null。 */
  reuseRate: number | null;
  perRun: Array<{ id: string; papers: number; reusedFromEarlier: number }>;
};

/**
 * `runs` 必须按时间升序（`readAllRunMetrics` 已保证）：「复用」的语义是
 * **这一篇在更早的 run 里已经检到过**，顺序错了这个数就没有意义。
 */
export function libraryReuse(runs: RunMetrics[]): LibraryReuse {
  const seen = new Set<string>();
  const perRun: LibraryReuse["perRun"] = [];
  let totalSaves = 0;
  for (const r of runs) {
    const ids = r.literature.paperIds;
    let reused = 0;
    for (const id of ids) if (seen.has(id)) reused += 1;
    for (const id of ids) seen.add(id);
    totalSaves += ids.length;
    perRun.push({ id: r.id, papers: ids.length, reusedFromEarlier: reused });
  }
  return {
    totalSaves,
    distinct: seen.size,
    reuseRate: totalSaves === 0 ? null : (totalSaves - seen.size) / totalSaves,
    perRun,
  };
}

/* ================================================================== */
/* 逐 run 汇总（唯一的读盘 adapter）                                      */
/* ================================================================== */

export type RunMetrics = {
  id: string;
  /** meta.json 优先，缺失时退回 question.md 的来源行（与 lib/runs.ts 同款兜底）。 */
  questionId: number | null;
  phase: RunPhase;
  deliverable: boolean;
  terminal: boolean;
  startedMs: number | null;
  finishedMs: number | null;
  durationSec: number | null;
  /**
   * 起止时间是否两端都来自 meta.json。false = 至少一端是 `runOutcome` 的兜底
   * （run id 时间戳 / 文件 mtime）。**mtime 兜底在报告里不可信**：一次 git checkout
   * 就会把全目录的 mtime 刷成「现在」，于是老 run 显示跑了 27 小时。
   * 成本/耗时表因此只采信 metaTimed 的那些，其余显示「—」。
   */
  metaTimed: boolean;
  usage: UsageAggregate;
  /** 没有 usage.jsonl —— 与「跑了但一个 token 都没花」是两回事，报告里必须分开显示。 */
  usageMissing: boolean;
  rework: ReworkMetrics;
  /** run 目录**顶层**的 `*.rejected.json`（节点工件的 schema 打回，如 proposal.json.rejected.json）。 */
  artifactDrafts: number;
  literature: LiteratureMetrics;
  /**
   * M9 诊断分（`score.json`，由 `scripts/score-run.ts` 落盘）；没跑过评分为 null。
   *
   * **本模块只搬运，不判定**：Tier1 是零 LLM 的，分数从盘上读进来只为喂给版本择优。
   * 它永远不参与 `deliverable` —— 那是确定性 gate 的地盘（criteria H：分数不进 gate）。
   */
  score: RunScore | null;
};

/** score.json 里择优与报告用得上的部分。字段语义见 lib/scoring.ts 的 ScoreFile。 */
export type RunScore = { weighted: number; max: number; percent: number; veto: boolean; rubricVersion: string };

const readTextOrNull = (path: string): string | null => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
};

const listDir = (path: string): string[] => {
  try {
    return readdirSync(path, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name);
  } catch {
    return [];
  }
};

/**
 * proposal.json → 引用 id 列表。**故意宽松**：这里要的是「模型声称引了哪些」，
 * 合不合契约由 `scripts/verify-proposal.ts` 判 —— 用 ProposalSchema 一票拒掉的话，
 * 一份被打回的 proposal 就在文献指标里彻底隐身，而那恰恰是最该被看见的一类。
 * 文件不存在返回 null（「没有 proposal」≠「proposal 里 0 条引用」）。
 */
function readRefIds(runDir: string): string[] | null {
  const raw = readTextOrNull(join(runDir, "proposal.json"));
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const refs = (parsed as { references?: unknown })?.references;
  if (!Array.isArray(refs)) return [];
  return refs
    .map((r) => (typeof (r as { arxivId?: unknown })?.arxivId === "string" ? (r as { arxivId: string }).arxivId : null))
    .filter((x): x is string => x !== null);
}

/**
 * `score.json` → 择优用得上的几个数。**宽松读**：字段缺失/写坏一律当没评过分
 * （null），绝不半信半疑地补默认值 —— 一个编出来的 0 分会让「没评过」在择优里
 * 变成「评过且很差」。
 */
function readScore(runDir: string): RunScore | null {
  const raw = readTextOrNull(join(runDir, "score.json"));
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const s = parsed as Record<string, unknown>;
  const veto = (s.veto as { triggered?: unknown } | undefined)?.triggered;
  if (typeof s.weighted !== "number" || typeof veto !== "boolean") return null;
  return {
    weighted: s.weighted,
    max: typeof s.max === "number" ? s.max : 0,
    percent: typeof s.percent === "number" ? s.percent : 0,
    veto,
    rubricVersion: typeof s.rubricVersion === "string" ? s.rubricVersion : "(未标注)",
  };
}

export function readRunMetrics(dir: string, id = basename(dir)): RunMetrics {
  const evidence = readRunEvidence(dir, id);
  const outcome = runOutcome(evidence);
  const usageText = readTextOrNull(join(dir, "usage.jsonl"));
  const topLevel = listDir(dir);

  return {
    id,
    questionId: evidence.meta?.questionId ?? parseQuestion(readTextOrNull(join(dir, "question.md"))).science125Id,
    phase: outcome.phase,
    deliverable: outcome.deliverable,
    terminal: outcome.terminal,
    startedMs: outcome.startedMs,
    finishedMs: outcome.finishedMs,
    durationSec:
      outcome.startedMs !== null && outcome.finishedMs !== null
        ? Math.round((outcome.finishedMs - outcome.startedMs) / 1000)
        : null,
    metaTimed: evidence.meta?.startedMs != null && evidence.meta?.finishedMs != null,
    usage: aggregateUsage(parseUsageLines(usageText)),
    usageMissing: usageText === null,
    rework: reworkMetrics(readVerdictEvidence(join(dir, "verdicts"))),
    artifactDrafts: topLevel.filter(isRejectedDraft).length,
    literature: literatureMetrics({
      paperIds: listDir(join(dir, "memory", "papers")).map(arxivIdFromFilename),
      refIds: readRefIds(dir),
    }),
    score: readScore(dir),
  };
}

/** 全量扫描。**按 run id 升序**（时间序）—— M5 与 M8 的复用口径都依赖这个顺序。 */
export function readAllRunMetrics(runsDir = RUNS_DIR): RunMetrics[] {
  let names: string[];
  try {
    names = readdirSync(runsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && isRunId(e.name))
      .map((e) => e.name);
  } catch {
    return [];
  }
  return names.sort().map((id) => readRunMetrics(join(runsDir, id), id));
}

/* ================================================================== */
/* M4 交付率 / M5 Pass^2 / M11 配对比较                                  */
/* ================================================================== */

export type DeliveryRate = { delivered: number; total: number; rate: number | null };

/**
 * M4。**分母写清是「已跑的 run」，不是 125** —— 拿 125 当分母会把「还没跑」说成「没交付」。
 */
export function deliveryRate(runs: RunMetrics[]): DeliveryRate {
  const delivered = runs.filter((r) => r.deliverable).length;
  return { delivered, total: runs.length, rate: runs.length === 0 ? null : delivered / runs.length };
}

/** 按题号分组，组内按时间升序（起始时间缺失时退回 run id）。没有题号的 run 不进组。 */
export function groupByQuestion(runs: RunMetrics[]): Map<number, RunMetrics[]> {
  const groups = new Map<number, RunMetrics[]>();
  for (const r of runs) {
    if (r.questionId === null) continue;
    const list = groups.get(r.questionId);
    if (list) list.push(r);
    else groups.set(r.questionId, [r]);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => (a.startedMs ?? 0) - (b.startedMs ?? 0) || a.id.localeCompare(b.id));
  }
  return groups;
}

export type PassPair = { questionId: number; earlier: string; later: string; pass: boolean };
export type PassSquared = { pairs: PassPair[]; passed: number; total: number; rate: number | null };

/**
 * M5 Pass^2：同题**按时间序相邻**的两个 run 是否都可交付。
 *
 * 分母是「相邻对」不是「题」：跑过 1 次的题贡献 0 对，跑过 3 次的题贡献 2 对。
 * 这与 M4 是正交的两件事 —— M4 是覆盖（多少题交出来了），M5 是稳定（同一题再跑一次还成不成），
 * 混报即误导（ch6 L90 要求报告写清 k 的语义）。
 */
export function passSquared(runs: RunMetrics[]): PassSquared {
  const pairs: PassPair[] = [];
  for (const [questionId, list] of groupByQuestion(runs)) {
    for (let i = 1; i < list.length; i++) {
      pairs.push({
        questionId,
        earlier: list[i - 1].id,
        later: list[i].id,
        pass: list[i - 1].deliverable && list[i].deliverable,
      });
    }
  }
  const passed = pairs.filter((p) => p.pass).length;
  return { pairs, passed, total: pairs.length, rate: pairs.length === 0 ? null : passed / pairs.length };
}

export type McNemar = { b: number; c: number; discordant: number; p: number; significant: boolean };

const choose = (n: number, k: number): number => {
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
};

/**
 * 配对二元比较的精确二项检验（McNemar exact，双侧 α=0.05）。
 *
 * 只看**不一致**的对：b = 旧版失败而新版通过，c = 旧版通过而新版失败。一致的对
 * （两版都过 / 都不过）不携带任何「改动有没有效」的信息，把它们算进分母只会稀释信号 ——
 * 这正是同一批题上配对分析比两个独立成功率相减更灵敏的原因（ch6 L627）。
 *
 * 直觉刻度：全胜时约需 8 对不一致才显著；出现 1 个反例就要涨到 ~10 对。
 */
export function mcnemar(b: number, c: number): McNemar {
  const n = b + c;
  if (n === 0) return { b, c, discordant: 0, p: 1, significant: false };
  const lo = Math.min(b, c);
  let tail = 0;
  for (let i = 0; i <= lo; i++) tail += choose(n, i);
  const p = Math.min(1, 2 * tail * 0.5 ** n);
  return { b, c, discordant: n, p, significant: p < 0.05 };
}

export type PairedComparison = McNemar & {
  /** 参与配对的题（同题至少两版）。 */
  questions: Array<{ questionId: number; earlier: string; later: string; earlierPass: boolean; laterPass: boolean }>;
  concordantPass: number;
  concordantFail: number;
};

/**
 * M11 的仓库现状版：同题取**最早**与**最晚**两版做配对。
 *
 * 它不是「A/B 两个配置」的严格实验（那要求一次只改一个变量、两臂题号相同）——
 * 仓库里的多版本是迭代产物，不是对照臂。所以 stats 里这张表只在有配对数据时显示，
 * 并且必须连同「这是迭代前后，不是随机分臂」一起读。
 */
export function pairedComparison(runs: RunMetrics[]): PairedComparison {
  const questions: PairedComparison["questions"] = [];
  for (const [questionId, list] of groupByQuestion(runs)) {
    if (list.length < 2) continue;
    const earlier = list[0];
    const later = list[list.length - 1];
    questions.push({
      questionId,
      earlier: earlier.id,
      later: later.id,
      earlierPass: earlier.deliverable,
      laterPass: later.deliverable,
    });
  }
  const b = questions.filter((q) => !q.earlierPass && q.laterPass).length;
  const c = questions.filter((q) => q.earlierPass && !q.laterPass).length;
  return {
    ...mcnemar(b, c),
    questions,
    concordantPass: questions.filter((q) => q.earlierPass && q.laterPass).length,
    concordantFail: questions.filter((q) => !q.earlierPass && !q.laterPass).length,
  };
}

/** 节点名的短标签（报告表头用）。 */
export const NODE_LABEL: Record<ReworkNode, string> = {
  literature: "L 文献",
  hypothesis: "H 假设",
  critique: "C 批判",
  proposal: "W 计划",
};
