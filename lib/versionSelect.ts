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
 *   1. **gate**：不可交付（`runOutcome().deliverable === false`）或 M9 触发虚构类断言
 *      veto 的版本**直接出局**，不参与后续任何比较。分数再高也不行 —— veto 与质量正交
 *      （ch6 L61：一份流畅、详尽、彬彬有礼却含假信息的答复，比一份简短但准确的危害大得多）。
 *   2. **M9 总分**降序。未评分（null）排在所有已评分之后：「没测过」不是「测过且很好」。
 *   3. **refs 数**降序。同分时证据面更宽的那版更值得交。
 *   4. **token 成本**升序。前三级全平时选更便宜的那版（125 题战役里这是真金白银）。
 *      成本未知（null）排在最后 —— 同样不许靠「没数据」取胜。
 *   5. run id 升序。全同则取最早的一版，只为**确定性**：择优不能依赖输入顺序。
 *
 * ## 落败版本不删
 *
 * `ranked` 返回全部候选（含出局者与出局理由）。负结果是记忆的一部分
 * （memory/SCHEMA.md 的不可压缩字段同理）：下次重跑要知道哪一版为什么没被选。
 */

export type VersionCandidate = {
  runId: string;
  /** 交付 gate：`runOutcome().deliverable`。调用方给，本模块不读盘。 */
  deliverable: boolean;
  /** M9 虚构类断言 veto。没跑过 M9 时传 false（未评分 ≠ 被 veto）。 */
  veto: boolean;
  /** M9 加权总分；未评分为 null。 */
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
  eliminated: Array<{ runId: string; reason: string }>;
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

export function selectVersion(candidates: VersionCandidate[]): VersionChoice {
  if (candidates.length === 0) {
    return { winner: null, ranked: [], reason: "没有候选版本", eliminated: [] };
  }

  const eliminated: VersionChoice["eliminated"] = [];
  const survivors: VersionCandidate[] = [];
  for (const c of candidates) {
    if (!c.deliverable) {
      eliminated.push({ runId: c.runId, reason: "未通过交付 gate（runOutcome 判定不可交付）" });
      continue;
    }
    if (c.veto) {
      eliminated.push({ runId: c.runId, reason: "M9 虚构类断言 veto" });
      continue;
    }
    survivors.push(c);
  }

  if (survivors.length === 0) {
    return { winner: null, ranked: [], reason: "没有版本通过 gate", eliminated };
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

  return { winner, ranked, reason, eliminated };
}
