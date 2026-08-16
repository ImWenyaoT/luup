/** B1–B4 确定性引用验收的判定规则。零 LLM、零网络 —— 全是纯函数。
 *
 * 移植自 Python 期 `app/domain/references.py`（ADR-0004 已删），按 TypeScript 栈的数据形状重写而不是逐行翻译。
 * 两边的形状差异决定了「谁是声称、谁是事实」：
 *
 * - Python 的 `Reference` 是模型自己填的 `{arxiv_id, title, authors, year}`，
 *   事实来源是本 run `memory/papers/` 里 `arxiv_save` 落盘的卡片，所以 B1/B4 全离线。
 * - TS 栈的 `research-plan.references` 是**纯 URL 字符串**，论文元数据由代码在检索当时
 *   写定（roles.ts 的 canonicalizeResearch 整条覆写 citations），模型没有自填面。
 *   于是「声称」变成了本 run 冻结下来的那张卡片，「事实」只能来自 arXiv 独立反查。
 *
 * 结论：B1（归属冻结证据集）与 B3（计数）仍然离线；B2（标题）与 B4（作者/年份）改为
 * 拿冻结卡片去和独立反查比对，两者同属在线通路，一并受 infraError 保护。
 *
 * 提不出 arXiv id 的引用（Crossref/DOI/网页）只走 B1 —— 它们没有可独立反查的通路，
 * 报告里必须如实分层，不能把「在冻结证据集内」说成「经独立反查」。
 */

/** 标题重合度阈值。
 *
 * **未经校准的自由参数**：0.8 是从 Python 栈原样带过来的，没有做过标注集校准，
 * 也没有做过阈值敏感性分析。预注册协议的 declarations 里有这条声明，改动它等于改判据，
 * 必须同步改声明，不能在跑批中途悄悄调。 */
export const TITLE_OVERLAP_THRESHOLD = 0.8;

/** 参考文献条数下限。与 Python 栈的 `Reference` 列表 `min_length=5` 同源。
 *
 * 注意它**不在** zod 契约里（researchPlanSchema 只要求 ≥1）：这是终局验收门，
 * 不是解析门。两者口径不同是有意的 —— 契约管「这份 Artifact 能不能被读懂」，
 * 验收管「这份成果能不能被接受」。 */
const MIN_REFERENCES = 5;

/** 一项引用验收规则的可展示结果。字段名与 Python 的 ReferenceCheck 对齐。 */
export type ReferenceCheck = { id: string; pass: boolean; detail: string };

/** 冻结证据里的一条来源卡片，即本 run 在检索当时登记下来的论文元数据。 */
export type FrozenCitation = {
  source_type: string;
  title: string;
  locator: string;
  url: string | null;
  authors?: string[] | undefined;
  year?: number | null | undefined;
};

/** 独立反查回来的权威记录。形状取 ArxivRecord 的子集，便于测试注入替身。 */
export type ResolvedRecord = {
  arxivId: string;
  title: string;
  authors: string[];
  year: number | null;
};

/** 一条引用连同它在本 run 里的归属与可反查性。 */
export type ReferenceTarget = {
  /** 计划里原样写下的引用字符串。 */
  reference: string;
  /** 归一化后的 URL；不是合法 http(s) 地址时为 null。 */
  normalizedUrl: string | null;
  /** 冻结证据里对应的卡片；不在冻结集内时为 null。 */
  card: FrozenCitation | null;
  /** 反查用的原始 arXiv id（保留版本号）。 */
  rawArxivId: string | null;
  /** 比对用的归一化 arXiv id（去掉版本号、小写）。 */
  arxivId: string | null;
};

const TITLE_NOISE = /[^a-z0-9一-鿿]+/g;
const AUTHOR_NOISE = /[^a-z0-9一-鿿'-]+/g;
const WORD_CHAR = /[a-z0-9一-鿿]/;
// 新式 `2301.12345v2` 与旧式 `hep-th/9901001v1` 两种写法，和 arXiv 官方 id 规范一致。
const ARXIV_ID = /^(?:\d{4}\.\d{4,5}(?:v\d+)?|[a-z-]+(?:\.[a-z]{2})?\/\d{7}(?:v\d+)?)$/i;

/** 把 URL 归一化成可比较的形式；不是绝对 http(s) 地址就返回 null。
 *
 * 规则（小写 scheme/host、去掉末尾斜杠、丢掉 fragment）与 src/eval/scoring.ts 的同名函数
 * 一致，但**故意各写一份**：评分口径必须比被评的生产代码更稳定，让离线评估反向依赖
 * 生产模块，改一次 agent 就可能改掉历史跑批的分数。规则一共几行，重复的代价小于这个耦合。
 */
function normalizeUrl(value: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (!parsed.host) return null;
  return `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/+$/, "")}${parsed.search}`;
}

/** 去掉版本后缀并折叠大小写。`2301.12345v2` 与 `2301.12345` 是同一篇论文。 */
export function normalizeArxivId(value: string): string {
  return value.trim().toLowerCase().replace(/v\d+$/, "");
}

/** 从一条引用里提取 arXiv id；提不出来就返回 null（该引用只走 B1）。
 *
 * 认三种写法：`arxiv.org/abs/<id>`、`arxiv.org/pdf/<id>[.pdf]`（含 export./www. 前缀），
 * 以及检索台账里的 `arxiv:<id>` locator。旧式 id 带一个斜杠（`hep-th/9901001`），
 * 所以路径要按前缀切而不是按最后一段取。
 */
export function extractArxivId(value: string): string | null {
  const raw = value.trim();
  const locator = /^arxiv:\s*(.+)$/i.exec(raw);
  if (locator) return ARXIV_ID.test(locator[1]!.trim()) ? locator[1]!.trim() : null;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (!/(^|\.)arxiv\.org$/i.test(parsed.hostname)) return null;
  const match = /^\/(?:abs|pdf|html)\/(.+)$/i.exec(parsed.pathname);
  if (!match) return null;
  const candidate = match[1]!.replace(/\.pdf$/i, "").replace(/\/+$/, "");
  return ARXIV_ID.test(candidate) ? candidate : null;
}

/** 把标题折叠为只含可比较词元的形式，消除大小写和标点差异。 */
function normalizeTitle(value: string): string {
  return value.toLowerCase().replace(TITLE_NOISE, " ").trim();
}

/** 较长标题被共同词元覆盖的比例；任一标题无有效词元时返回 0。 */
export function titleOverlap(left: string, right: string): number {
  const leftTokens = new Set(normalizeTitle(left).split(" ").filter(Boolean));
  const rightTokens = new Set(normalizeTitle(right).split(" ").filter(Boolean));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let shared = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) shared += 1;
  return shared / Math.max(leftTokens.size, rightTokens.size);
}

/** 从常见作者写法中提取归一化姓氏，供元数据一致性比较。
 *
 * `Yann LeCun` / `LeCun, Yann` / `Lécun` 都要折叠到同一个 `lecun`：变音符号靠 NFD 拆开后
 * 丢掉组合记号，姓在前的写法靠逗号切断，其余一律取最后一个词元。
 */
export function surnameOf(author: string): string {
  const raw = String(author ?? "").trim();
  if (!raw) return "";
  const comma = raw.indexOf(",");
  const head = comma > 0 ? raw.slice(0, comma) : raw;
  const folded = head.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const tokens = folded.replace(AUTHOR_NOISE, " ").split(" ").filter((token) => WORD_CHAR.test(token));
  return tokens.at(-1) ?? "";
}

/** 本 run 冻结下来的全部来源卡片，按归一化 URL 索引。
 *
 * 取的是 **Research Artifact 的 citations**，不是检索台账全集 —— 与 plan-quality.ts 的
 * upstreamTraceabilityIssues 同源：台账里可能有检索到却从未写进任何冻结 Artifact 的条目，
 * 让引用去核验那种条目，追溯链就断在 Artifact 之外了。
 */
export function collectFrozenCards(
  citations: readonly FrozenCitation[],
): Map<string, FrozenCitation> {
  const cards = new Map<string, FrozenCitation>();
  for (const citation of citations) {
    if (typeof citation.url !== "string") continue;
    const normalized = normalizeUrl(citation.url);
    // 先登记者优先：同一个 URL 在补证轮被重复冻结时，留下第一次的那张卡。
    if (normalized !== null && !cards.has(normalized)) cards.set(normalized, citation);
  }
  return cards;
}

/** 把每条引用与它的冻结卡片、可反查的 arXiv id 对上。 */
export function resolveTargets(
  references: readonly string[],
  cards: ReadonlyMap<string, FrozenCitation>,
): ReferenceTarget[] {
  return references.map((reference) => {
    const normalizedUrl = normalizeUrl(reference);
    const card = normalizedUrl === null ? null : cards.get(normalizedUrl) ?? null;
    // id 优先从引用本身提取；引用是 DOI 之类时退回卡片的 locator（`arxiv:<id>`）。
    const rawArxivId = extractArxivId(reference) ?? (card ? extractArxivId(card.locator) : null);
    return {
      reference,
      normalizedUrl,
      card,
      rawArxivId,
      arxivId: rawArxivId === null ? null : normalizeArxivId(rawArxivId),
    };
  });
}

/** B3：参考文献条数下限。 */
export function checkReferenceCount(references: readonly string[]): ReferenceCheck {
  return {
    id: "B3.count",
    pass: references.length >= MIN_REFERENCES,
    detail: `references = ${references.length}（要求 ≥${MIN_REFERENCES}）`,
  };
}

/** B1：每条引用都必须落在本 run 冻结证据的 URL 集合里。 */
export function checkFrozenMembership(
  targets: readonly ReferenceTarget[],
  cardCount: number,
): ReferenceCheck[] {
  return targets.map((target) => ({
    id: `B1.${target.reference}`,
    pass: target.card !== null,
    detail: target.card !== null
      ? `在本次运行的冻结证据里（${target.card.source_type} 来源）`
      : target.normalizedUrl === null
        ? "不是合法的 http(s) 引用地址，无法归属到任何冻结证据"
        : `未在本次运行的冻结证据里命中（冻结来源共 ${cardCount} 条）——必须先检索并冻结`,
  }));
}

/** B2：冻结卡片的标题与 arXiv 独立反查结果的重合度。
 *
 * 只对提得出 arXiv id 且有冻结卡片的引用执行；提不出 id 的（Crossref/网页）没有反查通路，
 * 没有卡片的已由 B1 报告，此处不再伪造一条判定。
 */
export function checkResolvedTitles(
  targets: readonly ReferenceTarget[],
  resolved: ReadonlyMap<string, ResolvedRecord>,
): ReferenceCheck[] {
  const checks: ReferenceCheck[] = [];
  for (const target of targets) {
    if (target.arxivId === null || target.card === null) continue;
    const remote = resolved.get(target.arxivId);
    if (remote === undefined) {
      checks.push({
        id: `B2.${target.arxivId}`,
        pass: false,
        detail: "arXiv 独立反查无结果（该 id 不存在）",
      });
      continue;
    }
    const score = titleOverlap(target.card.title, remote.title);
    checks.push({
      id: `B2.${target.arxivId}`,
      pass: score >= TITLE_OVERLAP_THRESHOLD,
      detail: `标题重合度 ${score.toFixed(2)}（阈值 ${TITLE_OVERLAP_THRESHOLD}）`
        + `｜冻结证据「${target.card.title}」｜arXiv「${remote.title}」`,
    });
  }
  return checks;
}

/** B4：冻结卡片的作者与发表年是否仍与 arXiv 一致。
 *
 * 对应 Python 的 B4（年份 + 作者姓氏 + 第一作者），比对对象换成了「冻结卡片 vs 独立反查」：
 * TS 栈的引用元数据由代码写定，模型没有凭记忆填写的机会，剩下要防的是这条冻结记录
 * 本身与真实论文对不上（撤稿、id 张冠李戴、解析残缺、事后被改）。
 */
export function checkResolvedMetadata(
  targets: readonly ReferenceTarget[],
  resolved: ReadonlyMap<string, ResolvedRecord>,
): ReferenceCheck[] {
  const checks: ReferenceCheck[] = [];
  for (const target of targets) {
    if (target.arxivId === null || target.card === null) continue;
    const remote = resolved.get(target.arxivId);
    // 反查不到已由 B2 报告；没有事实来源时不伪造一条 B4 判定。
    if (remote === undefined) continue;

    const claimedAuthors = target.card.authors ?? [];
    const problems: string[] = [];
    if (claimedAuthors.length === 0) problems.push("冻结证据未登记作者，无法执行 B4");
    if (target.card.year != null && remote.year !== null && target.card.year !== remote.year) {
      problems.push(`年份不符（冻结证据 ${target.card.year}，arXiv ${remote.year}）`);
    }
    const truth = new Set(remote.authors.map(surnameOf).filter(Boolean));
    if (remote.authors.length > 0 && truth.size === 0) {
      problems.push("arXiv 返回的作者无法解析，无法执行 B4");
    }
    const claimed = claimedAuthors.map(surnameOf).filter(Boolean);
    const bogus = claimed.filter((name) => !truth.has(name));
    if (truth.size > 0 && bogus.length > 0) {
      problems.push(`作者不符：${bogus.join(", ")} 不在该文献作者中（arXiv: ${remote.authors.join(", ")}）`);
    }
    const firstTruth = surnameOf(remote.authors[0] ?? "");
    const firstClaimed = surnameOf(claimedAuthors[0] ?? "");
    if (firstTruth && firstClaimed !== firstTruth) {
      problems.push(`第一作者不符（冻结证据「${claimedAuthors[0] ?? ""}」，arXiv「${remote.authors[0]}」）`);
    }
    checks.push({
      id: `B4.${target.arxivId}`,
      pass: problems.length === 0,
      detail: problems.length === 0
        ? "作者与年份与 arXiv 独立反查一致，第一作者一致"
        : `${problems.join("；")} —— 冻结证据与 arXiv 事实不符，该引用不可接受`,
    });
  }
  return checks;
}

