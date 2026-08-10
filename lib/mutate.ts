/**
 * **M10 变异体校准 —— judge 到底在不在判事（criteria H）。**
 *
 * ## 为什么不是人标 gold set
 *
 * ch6 L312 给的校准方案是「100–200 条人工标注的 gold set + Cohen's kappa > 0.7」。
 * 那与 luup 的 **human over the loop**（人不在环内）直接冲突，且 125 题战役也养不起
 * 这么一套标注流程。
 *
 * 替代设计：**已知标签不需要人来打 —— 由确定性劣化生成。** 取一份已经 ALL PASS 的
 * proposal，施加若干种可编程的定向劣化，每一种的正确排序都是**先验已知**的
 * （劣化版必须严格低于原版；插了无出处数值的那一版必须触发 veto）。
 * 于是「judge 有没有判别力」变成一个可自动复算的数字：**检出率**。
 *
 * 检出率低时，结论是**改 rubric，不是改 agent** —— 这正是 ch6 L670
 * 「性能下降先查评估系统，再查 agent」的落点。
 *
 * ## 变异体必须是纯函数
 *
 * `apply` 不得改写入参（selftest 逐条断言「两次施加同结果」与「原 proposal 未被就地改写」）。
 * 随机化的劣化会让检出率每次都不一样，那就不是校准而是抽奖。
 */
import type { Proposal } from "#lib/agents/contracts.ts";

/** 先验期望：`lower` = 分数必须低于原版；`veto` = 必须触发虚构类断言 veto。 */
export type MutationExpectation = "lower" | "veto";

export type Mutation = {
  id: string;
  label: string;
  expect: MutationExpectation;
  /** 这个变异体在探测 judge 的哪一种盲区。 */
  probes: string;
  apply: (p: Proposal) => Proposal;
};

/** 深拷贝，保证 apply 不碰入参。proposal 是纯 JSON 结构，structuredClone 够用。 */
const clone = (p: Proposal): Proposal => structuredClone(p);

/** 推导链的连接词：删掉含它们的句子，等于抽掉「为什么」只留「是什么」。 */
const DERIVATION_MARKERS = ["因此", "由于", "所以", "从而", "推断", "可见", "故而", "因而"];

export const MUTATIONS: Mutation[] = [
  {
    id: "verbose-noinfo",
    label: "加长零信息段（原样复读 rationale）",
    expect: "lower",
    probes:
      "长度偏置（ch6 L324）。信息量一字未增，篇幅翻倍。judge 若给更高分，说明它在按长度打分，" +
      "rubric 的「篇幅不计分」没有生效 —— 这是一次性抓，不建长期相关性监控流水线。",
    apply: (p) => {
      const next = clone(p);
      next.rationale = `${p.rationale}\n\n${p.rationale}`;
      return next;
    },
  },
  {
    id: "strip-derivation",
    label: "删推导链句（只留结论）",
    expect: "lower",
    probes: "推导自洽维度。结论全在，但「为什么」被抽掉了 —— judge 若仍给高分，说明它只在看有没有话说。",
    apply: (p) => {
      const next = clone(p);
      const sentences = p.rationale.split(/(?<=[。；！？\n])/);
      const kept = sentences.filter((s) => !DERIVATION_MARKERS.some((m) => s.includes(m)));
      // 全被删光时保底留最后一句，否则变异体会退化成空串（那测的就不是推导链了）
      next.rationale = (kept.join("").trim() || sentences[sentences.length - 1] || p.rationale).trim();
      return next;
    },
  },
  {
    id: "unsourced-number",
    label: "插无出处数值",
    expect: "veto",
    probes: "veto 条款本身。凭空出现的具体百分比在正文与 references 里都找不到出处，必须触发 veto 而不只是扣分。",
    apply: (p) => {
      const next = clone(p);
      next.results = `${p.results}\n\n初步测算表明，本方案可将该参数的不确定度压缩 37.4%，并把误判率降到 2.1% 以下。`;
      return next;
    },
  },
  {
    id: "swap-fields",
    label: "字段互换（methods ↔ technicalDetails）",
    expect: "lower",
    probes:
      "方案可落地维度。两段文字都还在、都还通顺，但装错了字段：judge 若察觉不到，说明它在判「有没有内容」而不是「内容对不对位」。",
    apply: (p) => {
      const next = clone(p);
      next.methods = p.technicalDetails;
      next.technicalDetails = p.methods;
      return next;
    },
  },
  {
    id: "bland-relevance",
    label: "引用 relevance 置空话",
    expect: "lower",
    probes: "引用支撑度维度。引用条目一条不少（B1–B4 照样全过），但「支撑了哪个论断」被抹平成套话。",
    apply: (p) => {
      const next = clone(p);
      next.references = p.references.map((r) => ({ ...r, relevance: "该文献与本研究相关。" }));
      return next;
    },
  },
];

/* ------------------------------------------------------------------ */
/* 检出率                                                               */
/* ------------------------------------------------------------------ */

export type MutantOutcome = { id: string; expect: MutationExpectation; weighted: number; veto: boolean };

export type DetectionRow = MutantOutcome & {
  /** 是否按先验期望被识别出来。inconclusive 的行永远是 false。 */
  detected: boolean;
  /**
   * 这一行判不了。目前只有一种成因：**原版自己就触发了 veto**，于是 veto 类变异体
   * 触发 veto 这件事不携带任何信息（「抓住了劣化」与「本来就在报警」长得一样）。
   * 判不了的行不进检出率的分母 —— 把它算成「检出」是自欺，算成「未检出」是冤枉。
   */
  inconclusive: boolean;
  /** 逆序：劣化版反而拿到更高分（`lower` 类专有）。 */
  inverted: boolean;
  delta: number;
};

export type DetectionTable = {
  baseline: { weighted: number; veto: boolean };
  rows: DetectionRow[];
  /** 全部变异体数（含判不了的）。 */
  total: number;
  /** 进入检出率分母的行数 = total - inconclusive。 */
  judgeable: number;
  detected: number;
  /** detected / judgeable；judgeable 为 0 时 null。 */
  detectionRate: number | null;
  inconclusive: number;
  inverted: number;
  vetoExpected: number;
  vetoHit: number;
};

/**
 * 检出率表。
 *
 * - `lower` 类：分数**严格低于**原版才算检出。持平不算 —— 「没看出区别」与「看出来了但很宽容」
 *   在决策上是同一件事：这个变异体没被抓住。
 * - `veto` 类：veto 位被置上**且原版没有触发** 才算检出。原版自己就在报警时，这一行判不了
 *   （见 `inconclusive`），退出分母而不是冒充一个 100%。
 */
export function detectionTable(
  baseline: { weighted: number; veto: boolean },
  mutants: MutantOutcome[],
): DetectionTable {
  const rows: DetectionRow[] = mutants.map((m) => {
    const inconclusive = m.expect === "veto" && baseline.veto;
    return {
      ...m,
      delta: m.weighted - baseline.weighted,
      inconclusive,
      detected: inconclusive ? false : m.expect === "veto" ? m.veto : m.weighted < baseline.weighted,
      inverted: m.expect === "lower" && m.weighted > baseline.weighted,
    };
  });
  const detected = rows.filter((r) => r.detected).length;
  const inconclusive = rows.filter((r) => r.inconclusive).length;
  const judgeable = rows.length - inconclusive;
  const vetoRows = rows.filter((r) => r.expect === "veto");
  return {
    baseline,
    rows,
    total: rows.length,
    judgeable,
    detected,
    detectionRate: judgeable === 0 ? null : detected / judgeable,
    inconclusive,
    inverted: rows.filter((r) => r.inverted).length,
    vetoExpected: vetoRows.length,
    vetoHit: vetoRows.filter((r) => r.veto).length,
  };
}
