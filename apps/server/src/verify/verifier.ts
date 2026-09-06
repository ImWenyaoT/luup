/** 终局引用验收：把 B1/B3 的离线判定与 B2/B4 的 arXiv 独立反查合成一个结论。
 *
 * 移植自 Python 期 `app/agent/verifier.py`（ADR-0004 已删）。它是整条流水线上唯一一道**不问模型**的验收：
 * Reviewer 说 accepted 只代表另一个模型觉得计划好，这里回答的是「计划引的文献真的存在，
 * 而且就是本 run 检索到的那几篇」。零 LLM，可复跑，结论可以逐条摆进报告。
 */

import { fetchArxivByIds, publishedYear, type ArxivRecord } from "../agent/arxiv.ts";
import { resolveCrossrefDoi, type CrossrefRecord } from "../agent/crossref.ts";
import type { Research, ResearchPlan } from "../agent/contracts.ts";
import type { FailureCode } from "../agent/failures.ts";
import {
  checkFrozenMembership,
  checkReferenceCount,
  checkResolvedMetadata,
  checkResolvedDoiMetadata,
  checkResolvedDoiTitles,
  checkResolvedTitles,
  collectFrozenCards,
  normalizeArxivId,
  normalizeDoi,
  resolveTargets,
  type DoiResolvedRecord,
  type ReferenceCheck,
  type ResolvedRecord,
} from "./references.ts";

/** arXiv 反查的注入点。测试给替身，生产给 fetchArxivByIds —— 验收器本身不碰网络细节。 */
export type ArxivLookup = (ids: readonly string[], signal?: AbortSignal) => Promise<ResolvedRecord[]>;

/** Crossref DOI 精确反查注入点。返回缺失记录的 DOI 时直接省略，验收器会判 verifier_refs。 */
export type DoiLookup = (dois: readonly string[], signal?: AbortSignal) => Promise<DoiResolvedRecord[]>;

/** 一次引用验收的完整结论与逐条证据。 */
export type ReferenceVerification = {
  ok: boolean;
  referenceCount: number;
  /** 本 run 冻结证据里的来源条数。 */
  frozenSources: number;
  /** 走了 arXiv 独立反查的引用条数。 */
  arxivChecked: number;
  /** 走了 Crossref DOI 精确反查的引用条数。 */
  doiChecked: number;
  /** 只做了冻结集归属检查的引用条数（既无 arXiv id 也无 DOI 的普通网页）。 */
  membershipOnly: number;
  checks: ReferenceCheck[];
  failed: string[];
  /** arXiv 不可达。这不等于引用造假，报告与评估要把它排除在质量分母之外。 */
  infraError: boolean;
};

export type ReferenceVerifier = (input: {
  plan: ResearchPlan;
  research: readonly Research[];
  signal?: AbortSignal;
}) => Promise<ReferenceVerification>;

/** arXiv 通路整体失效时那一条检查的 ID。它是「结论未取得」，不是「引用不合格」。 */
const RESOLVE_CHECK_ID = "B2.resolve";

const toResolved = (record: ArxivRecord): ResolvedRecord => ({
  arxivId: record.arxivId,
  title: record.title,
  authors: record.authors,
  year: publishedYear(record.published),
});

/** 生产反查通路：走 arXiv 官方 id_list，经模块级限速闸。 */
const arxivLookup: ArxivLookup = async (ids, signal) => (await fetchArxivByIds(ids, { signal })).map(toResolved);

const toDoiResolved = (record: CrossrefRecord): DoiResolvedRecord => ({
  doi: normalizeDoi(record.doi)!,
  title: record.title,
  authors: record.authors,
  year: /^\d{4}/.test(record.published) ? Number(record.published.slice(0, 4)) : null,
});

class PartialDoiLookupError extends Error {
  constructor(
    readonly records: DoiResolvedRecord[],
    readonly failures: readonly { doi: string; reason: string }[],
  ) {
    super(`Crossref DOI lookup failed for ${failures.length} record(s)`);
  }
}

function doiLookupWith(resolve: typeof resolveCrossrefDoi): DoiLookup {
  return async (dois, signal) => {
    signal?.throwIfAborted();
    const settled = await Promise.allSettled(dois.map((doi) => resolve(doi, { signal })));
    signal?.throwIfAborted();
    const records: DoiResolvedRecord[] = [];
    const failures: { doi: string; reason: string }[] = [];
    for (const [index, result] of settled.entries()) {
      if (result.status === "fulfilled") {
        if (result.value !== null) records.push(toDoiResolved(result.value));
      } else {
        failures.push({
          doi: dois[index]!,
          reason: result.reason instanceof Error ? result.reason.message : String(result.reason),
        });
      }
    }
    if (failures.length > 0) throw new PartialDoiLookupError(records, failures);
    return records;
  };
}

const doiLookup = doiLookupWith(resolveCrossrefDoi);

/** 组装一个验收器。`lookup` 可注入，测试因此零网络零 LLM。 */
export function createReferenceVerifier(
  options: {
    lookup?: ArxivLookup;
    doiLookup?: DoiLookup;
    resolveSingleDoi?: typeof resolveCrossrefDoi;
  } = {},
): ReferenceVerifier {
  const lookup = options.lookup ?? arxivLookup;
  const resolveDoi =
    options.doiLookup ?? (options.resolveSingleDoi ? doiLookupWith(options.resolveSingleDoi) : doiLookup);

  return async ({ plan, research, signal }) => {
    signal?.throwIfAborted();
    const cards = collectFrozenCards(research.flatMap((artifact) => artifact.citations));
    const targets = resolveTargets(plan.references, cards);
    const checks: ReferenceCheck[] = [
      checkReferenceCount(plan.references),
      ...checkFrozenMembership(targets, cards.size),
    ];

    // 只有在冻结证据里有卡片的引用才允许反查；未冻结的引用先由 B1 判死，不能替它寻找证据。
    const resolvable = targets.filter((target) => target.arxivId !== null && target.card !== null);
    const doiResolvable = targets.filter((target) => target.doi !== null && target.card !== null);
    let infraError = false;
    let arxivInfraError = false;
    let doiChecked = 0;
    if (resolvable.length > 0) {
      try {
        const records = await lookup(
          resolvable.map((target) => target.rawArxivId!),
          signal,
        );
        signal?.throwIfAborted();
        const resolved = new Map<string, ResolvedRecord>();
        for (const record of records) resolved.set(normalizeArxivId(record.arxivId), record);
        checks.push(...checkResolvedTitles(resolvable, resolved), ...checkResolvedMetadata(resolvable, resolved));
      } catch (error) {
        signal?.throwIfAborted();
        // arXiv 不可达属于基础设施故障，不等于引用造假：只记一条「结论未取得」，
        // 不给每条引用扣一顶造假的帽子。
        infraError = true;
        arxivInfraError = true;
        checks.push({
          id: RESOLVE_CHECK_ID,
          pass: false,
          detail: `arXiv 独立反查失败：${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }

    if (doiResolvable.length > 0) {
      try {
        const records = await resolveDoi(
          doiResolvable.map((target) => target.doi!),
          signal,
        );
        signal?.throwIfAborted();
        const resolved = new Map<string, DoiResolvedRecord>();
        for (const record of records) {
          const normalized = normalizeDoi(record.doi);
          if (normalized !== null) resolved.set(normalized, record);
        }
        checks.push(
          ...checkResolvedDoiTitles(doiResolvable, resolved),
          ...checkResolvedDoiMetadata(doiResolvable, resolved),
        );
        doiChecked = doiResolvable.length;
      } catch (error) {
        signal?.throwIfAborted();
        infraError = true;
        if (error instanceof PartialDoiLookupError) {
          const resolved = new Map(error.records.map((record) => [normalizeDoi(record.doi)!, record]));
          const succeeded = doiResolvable.filter((target) => resolved.has(target.doi!));
          checks.push(...checkResolvedDoiTitles(succeeded, resolved), ...checkResolvedDoiMetadata(succeeded, resolved));
          doiChecked = succeeded.length;
          for (const failure of error.failures) {
            checks.push({
              id: "B2.doi.resolve",
              pass: false,
              detail: `Crossref DOI ${failure.doi} 独立反查失败：${failure.reason}`,
            });
          }
        } else {
          checks.push({
            id: "B2.doi.resolve",
            pass: false,
            detail: `Crossref DOI 独立反查失败：${error instanceof Error ? error.message : String(error)}`,
          });
        }
      }
    }

    const failed = checks.filter((check) => !check.pass).map((check) => check.id);
    return {
      ok: failed.length === 0,
      referenceCount: plan.references.length,
      frozenSources: cards.size,
      arxivChecked: arxivInfraError ? 0 : resolvable.length,
      doiChecked,
      membershipOnly: targets.filter((target) => target.arxivId === null && target.doi === null).length,
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
  const qualityFailures = verification.failed.filter((id) => id !== RESOLVE_CHECK_ID && id !== "B2.doi.resolve");
  return qualityFailures.length > 0 ? "verifier_refs" : "infra_error";
}
