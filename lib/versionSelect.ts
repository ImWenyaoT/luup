/**
 * **版本择优 —— 同题多 run 选哪一版进交付清单，全系统唯一 owner。**
 *
 * criteria H 的自进化闭环里，择优是**纯函数**，不是 judge 的自由裁量：judge 只提供
 * 一个分量（M9 总分），谁赢由字典序规则决定。理由与 `lib/runOutcome.ts` / `lib/rework.ts`
 * 完全一致 —— 判定权归代码。让模型「综合考虑后选一版」等于把交付清单交给一个
 * 无法复算、无法回放、每次结论都可能不同的过程。
 *
 * ## 字典序（不要重排）
 *
 *   1. **gate —— 只有确定性判据**：`runOutcome().deliverable === false` 的版本直接出局。
 *      判定权在 `lib/runOutcome.ts` 与 `scripts/verify-proposal.ts`（A/B1–B4），不在模型。
 *   2. **M9 总分**降序（tie-break，不是 gate）。未评分（null）排在所有已评分之后：
 *      「没测过」不是「测过且很好」。
 *   3. **refs 数**降序。同分时证据面更宽的那版更值得交。
 *   4. **token 成本**升序。前三级全平时选更便宜的那版（125 题战役里这是真金白银）。
 *      成本未知（null）排在最后 —— 同样不许靠「没数据」取胜。
 *   5. run id 升序。全同则取最早的一版，只为**确定性**：择优不能依赖输入顺序。
 *
 * ## veto 是 advisory，不是 gate（master 裁决，2026-08-09）
 *
 * M9 的虚构类断言 veto **只记录、只展示，不出局**。理由是 criteria H 的预先原则
 * 「gate 全确定性，judge 只产诊断分不产 gate」—— 让一个同族 LLM 的判断决定「这一版能不能交」，
 * 就是把交付面交给一个无法复算的过程。
 *
 * 这条不是纸面推演：本仓库的 M10 校准实测（`runs/20260808-134046/calibration.md`）给出
 * **检出 0/4、一次逆序**，同一份 proposal 三次采样的加权分是 20/21/22，而变异体的效应量落在
 * −2…+1 —— **judge 的自噪声带比它要测的差异还宽**。据此把 veto 留在 gate 上，只会让
 * 一个噪声源否掉真实交付物（实测：Q61 两版都被 veto 挡下，择优退化成「没有版本通过 gate」）。
 *
 * 因此 `veto` 字段照旧从 score.json 读进来、照旧出现在候选与 stats 的「⚠ M9 诊断」列里，
 * 供人和下一次重跑消费；它只是**不再改变胜者**。score.json 本身一字不动。
 *
 * ## 落败版本不删
 *
 * `ranked` 返回全部通过 gate 的候选（含 veto 标志），`eliminated` 带出局理由。负结果是
 * 记忆的一部分（memory/SCHEMA.md 的不可压缩字段同理）：下次重跑要知道哪一版为什么没被选。
 */

export type VersionCandidate = {
  runId: string;
  /**
   * 交付 gate：`runOutcome().deliverable`。调用方给，本模块不读盘。
   * **这是唯一的 gate** —— 全部由确定性判据得出（A/B1–B4 验收器 + 终态判定）。
   */
  deliverable: boolean;
  /**
   * M9 虚构类断言 veto。**advisory：只记录不出局**（见文件头「veto 是 advisory」）。
   * 没跑过 M9 时传 false —— 未评分 ≠ 被 veto，但两者在择优里的效果现在都是「不影响胜负」。
   */
  veto: boolean;
  /** M9 加权总分（诊断分，tie-break 用）；未评分为 null。 */
  score: number | null;
  /** proposal 的引用条数；未知为 null。 */
  refs: number | null;
  /** 本次 run 的 total token（M6）；未知为 null。 */
  tokens: number | null;
};

export type VersionChoice = {
  winner: VersionCandidate | null;
  /** 通过 gate 的候选，按字典序排好；出局者不在其中。 */
  ranked: VersionCandidate[];
  /** 哪一级分出的胜负（或为什么没有胜者）。 */
  reason: string;
  /** 出局者。**只可能因为 `deliverable === false`** —— veto 不出局。 */
  eliminated: Array<{ runId: string; reason: string }>;
  /**
   * 通过 gate 但 M9 报了 veto 的版本（含胜者本身）。**诊断信息，不影响胜负**：
   * 交给 stats 的「⚠ M9 诊断」列与重跑时的题页消费。
   */
  advisories: Array<{ runId: string; note: string }>;
};

/** 降序比较：null 永远排在数字之后。 */
const descNullsLast = (a: number | null, b: number | null): number => {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b - a;
};

/** 升序比较：null 永远排在数字之后。 */
const ascNullsLast = (a: number | null, b: number | null): number => {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
};

/** advisory 文案的唯一出处：stats 的「⚠ M9 诊断」列与题页读的是同一句。 */
export const VETO_ADVISORY = "M9 报了虚构类断言 veto（诊断，不影响择优）";

export function selectVersion(candidates: VersionCandidate[]): VersionChoice {
  if (candidates.length === 0) {
    return { winner: null, ranked: [], reason: "没有候选版本", eliminated: [], advisories: [] };
  }

  const eliminated: VersionChoice["eliminated"] = [];
  const survivors: VersionCandidate[] = [];
  for (const c of candidates) {
    // gate 只有这一条，且它是确定性的。veto 在下面只记 advisory，不出局。
    if (!c.deliverable) {
      eliminated.push({ runId: c.runId, reason: "未通过交付 gate（runOutcome 判定不可交付）" });
      continue;
    }
    survivors.push(c);
  }

  const advisories = survivors.filter((c) => c.veto).map((c) => ({ runId: c.runId, note: VETO_ADVISORY }));

  if (survivors.length === 0) {
    return { winner: null, ranked: [], reason: "没有版本通过交付 gate", eliminated, advisories };
  }

  const ranked = [...survivors].sort(
    (a, b) =>
      descNullsLast(a.score, b.score) ||
      descNullsLast(a.refs, b.refs) ||
      ascNullsLast(a.tokens, b.tokens) ||
      a.runId.localeCompare(b.runId),
  );

  const winner = ranked[0];
  const runnerUp = ranked[1];
  const reason =
    runnerUp === undefined
      ? "唯一通过 gate 的版本"
      : descNullsLast(winner.score, runnerUp.score) !== 0
        ? "M9 总分更高"
        : descNullsLast(winner.refs, runnerUp.refs) !== 0
          ? "M9 总分持平，refs 更多"
          : ascNullsLast(winner.tokens, runnerUp.tokens) !== 0
            ? "M9 总分与 refs 持平，token 成本更低"
            : "各级全部持平，按 run id 取最早的一版";

  return { winner, ranked, reason, eliminated, advisories };
}
