/** 终局引用验收：把 B1/B3 的离线判定与 B2/B4 的 arXiv 独立反查合成一个结论。
 *
 * 移植自 Python 期 `app/agent/verifier.py`（ADR-0004 已删）。它是整条流水线上唯一一道**不问模型**的验收：
 * Reviewer 说 accepted 只代表另一个模型觉得计划好，这里回答的是「计划引的文献真的存在，
 * 而且就是本 run 检索到的那几篇」。零 LLM，可复跑，结论可以逐条摆进报告。
 */

import { fetchArxivByIds, publishedYear, type ArxivRecord } from "../agent/arxiv.ts";
import type { Research, ResearchPlan } from "../agent/contracts.ts";
import type { FailureCode } from "../agent/failures.ts";
import {
  checkFrozenMembership,
  checkReferenceCount,
  checkResolvedMetadata,
  checkResolvedTitles,
  collectFrozenCards,
  normalizeArxivId,
  resolveTargets,
  type ReferenceCheck,
  type ResolvedRecord,
} from "./references.ts";

/** arXiv 反查的注入点。测试给替身，生产给 fetchArxivByIds —— 验收器本身不碰网络细节。 */
export type ArxivLookup = (ids: readonly string[]) => Promise<ResolvedRecord[]>;

/** 一次引用验收的完整结论与逐条证据。 */
export type ReferenceVerification = {
  ok: boolean;
  referenceCount: number;
  /** 本 run 冻结证据里的来源条数。 */
  frozenSources: number;
  /** 走了 arXiv 独立反查的引用条数。 */
  arxivChecked: number;
  /** 只做了冻结集归属检查的引用条数（Crossref/网页来源，没有反查通路）。 */
  membershipOnly: number;
  checks: ReferenceCheck[];
  failed: string[];
  /** arXiv 不可达。这不等于引用造假，报告与评估要把它排除在质量分母之外。 */
  infraError: boolean;
};

export type ReferenceVerifier = (input: {
  plan: ResearchPlan;
  research: readonly Research[];
}) => Promise<ReferenceVerification>;

/** arXiv 通路整体失效时那一条检查的 ID。它是「结论未取得」，不是「引用不合格」。 */
export const RESOLVE_CHECK_ID = "B2.resolve";

const toResolved = (record: ArxivRecord): ResolvedRecord => ({
  arxivId: record.arxivId,
  title: record.title,
  authors: record.authors,
  year: publishedYear(record.published),
});

/** 生产反查通路：走 arXiv 官方 id_list，经模块级限速闸。 */
export const arxivLookup: ArxivLookup = async (ids) =>
  (await fetchArxivByIds(ids)).map(toResolved);

/** 组装一个验收器。`lookup` 可注入，测试因此零网络零 LLM。 */
export function createReferenceVerifier(
  options: { lookup?: ArxivLookup } = {},
): ReferenceVerifier {
  const lookup = options.lookup ?? arxivLookup;

  return async ({ plan, research }) => {
    const cards = collectFrozenCards(research.flatMap((artifact) => artifact.citations));
    const targets = resolveTargets(plan.references, cards);
    const checks: ReferenceCheck[] = [
      checkReferenceCount(plan.references),
      ...checkFrozenMembership(targets, cards.size),
    ];

    // 只有「提得出 arXiv id 且在冻结证据里有卡片」的引用才有可比对的两端。
    const resolvable = targets.filter((target) => target.arxivId !== null && target.card !== null);
    let infraError = false;
    if (resolvable.length > 0) {
      try {
        const records = await lookup(resolvable.map((target) => target.rawArxivId!));
        const resolved = new Map<string, ResolvedRecord>();
        for (const record of records) resolved.set(normalizeArxivId(record.arxivId), record);
        checks.push(
          ...checkResolvedTitles(resolvable, resolved),
          ...checkResolvedMetadata(resolvable, resolved),
        );
      } catch (error) {
        // arXiv 不可达属于基础设施故障，不等于引用造假：只记一条「结论未取得」，
        // 不给每条引用扣一顶造假的帽子。
        infraError = true;
        checks.push({
          id: RESOLVE_CHECK_ID,
          pass: false,
          detail: `arXiv 独立反查失败：${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }

    const failed = checks.filter((check) => !check.pass).map((check) => check.id);
    return {
      ok: failed.length === 0,
      referenceCount: plan.references.length,
      frozenSources: cards.size,
      arxivChecked: infraError ? 0 : resolvable.length,
      membershipOnly: targets.length - resolvable.length,
      checks,
      failed,
      infraError,
    };
  };
}

/** 验收未通过时该记哪个失败码。
 *
 * 基础设施故障与质量失败要分开记账，否则 arXiv 抽风的那一夜会在报告里表现为
 * 「引用造假率飙升」。两者同时出现时以质量失败为准 —— 网络好坏改变不了 B1/B3 的结论。
 */
export function verificationFailureCode(verification: ReferenceVerification): FailureCode {
  const qualityFailures = verification.failed.filter((id) => id !== RESOLVE_CHECK_ID);
  return qualityFailures.length > 0 ? "verifier_refs" : "infra_error";
}
