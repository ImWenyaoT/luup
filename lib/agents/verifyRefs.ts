/**
 * 引用真实性核验（criteria B1–B4）—— 确定性，不调用任何 LLM。
 *
 * 本文件是**判据的单一事实源**：阈值、标题归一、词集合重合度、姓氏取法都定义在这里，
 * 环内的 `verify_references` 工具与环外的 `scripts/verify-proposal.ts` 共用同一份。
 *
 * 需要保持独立的是**数据通路**，不是字符串判据：
 *  - 环内：本 run 已实检命中的 id ← `paperStore.listPapers()`；反查 ← `arxiv.getArxiv()`
 *    （带礼貌节流/重试/id 规范化，一次批量请求取回全部标题）。
 *  - 环外：`scripts/verify-proposal.ts` 直接 readdir + 自己逐条 fetch arXiv。
 * 两条通路各自独立地拿到事实，再用同一把尺子量 —— 尺子有两把才是问题：上一版两份
 * 姓氏实现给同一个作者算出不同的姓（"Jason T. L. Wang" → "jason" vs "wang"），
 * 交叉验证于是验的不是同一件事。
 */
import { type Reference, ProposalSchema } from "#lib/agents/contracts.ts";
import { getArxiv } from "./arxiv.ts";
import { listPapers, readCard } from "./paperStore.ts";
import { resolveRunDir } from "./runContext.ts";
import { readArtifact } from "./artifacts.ts";

/** 标题反查的通过线（与 verify-proposal.ts 一致）。 */
export const TITLE_OVERLAP_THRESHOLD = 0.8;

/** 大小写/标点无关的标题归一（criteria B2 允许大小写与标点差异）。 */
export function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/g, " ")
    .trim();
}

/** 词集合重合度 = |A∩B| / max(|A|,|B|)，取值 [0,1]。 */
export function titleOverlap(a: string, b: string): number {
  const ta = new Set(normalizeTitle(a).split(" ").filter(Boolean));
  const tb = new Set(normalizeTitle(b).split(" ").filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let hit = 0;
  for (const t of ta) if (tb.has(t)) hit++;
  return hit / Math.max(ta.size, tb.size);
}

/**
 * 折叠变音符号。arXiv 与模型给的作者名会在 "García" / "Garcia" 之间摇摆，
 * 而一个重音符不该让一条真引用被判成虚构。
 */
const foldDiacritics = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * 取姓氏用于比对。两种书写序都要认：
 *  - `"Vaswani, A."`（姓, 名）—— 逗号前整段是姓；
 *  - `"Jason T. L. Wang"` / `"J. Wang"`（名 姓）—— 末词元是姓。
 *
 * 上一版的两份实现都不对：一份无条件取末词元（"Vaswani, A." → "a"），另一份取
 * 「最长词元」（"Jason T. L. Wang" → "jason"，把名当成了姓）。后者只因为比对两侧
 * 用的是同一个错函数才一直没暴露 —— 一旦产物与 arXiv 的书写风格不同（缩写 vs 全名、
 * 逗号序 vs 自然序），它就会把真作者判成虚构，或者放过一个假作者。
 */
export function surnameOf(author: string): string {
  const raw = String(author ?? "").trim();
  if (!raw) return "";
  const comma = raw.indexOf(",");
  const head = comma > 0 ? raw.slice(0, comma) : raw;
  const parts = foldDiacritics(head)
    .replace(/[^a-z0-9一-鿿'\-]+/g, " ")
    .split(/\s+/)
    .filter((t) => /[a-z0-9一-鿿]/.test(t));
  return parts[parts.length - 1] ?? "";
}

export type RefCheck = { id: string; pass: boolean; detail: string };

export type VerifyReferencesResult = {
  ok: boolean;
  referenceCount: number;
  papersInRun: number;
  checks: RefCheck[];
  /** 未通过的检查项 id，供 master 直接定向打回 */
  failed: string[];
};

/** 对一组 reference 跑 B1/B2/B3。 */
export async function verifyReferences(
  refs: Reference[],
  runDir = resolveRunDir(),
): Promise<VerifyReferencesResult> {
  const checks: RefCheck[] = [];
  const known = new Set(listPapers(runDir));

  // B3
  checks.push({
    id: "B3.count",
    pass: refs.length >= 5,
    detail: `references = ${refs.length}（要求 ≥5）`,
  });

  // B1：只认本次运行 arxiv_save 落盘过的 id
  for (const r of refs) {
    const hit = known.has(r.arxivId);
    checks.push({
      id: `B1.${r.arxivId}`,
      pass: hit,
      detail: hit
        ? "在本次运行 memory/papers/ 中"
        : `未在本次运行实检命中（papers/ 共 ${known.size} 篇）——必须先 arxiv_save`,
    });
  }

  // B2：批量反查 arXiv，标题重合度 ≥ 阈值
  const ids = [...new Set(refs.map((r) => r.arxivId))];
  const remote = new Map<string, string>();
  if (ids.length > 0) {
    try {
      for (const p of await getArxiv(ids)) remote.set(p.arxivId, p.title);
    } catch (e) {
      checks.push({ id: "B2.fetch", pass: false, detail: `arXiv 反查请求失败: ${String(e)}` });
    }
  }
  for (const r of refs) {
    const title = remote.get(r.arxivId);
    if (title === undefined) {
      checks.push({
        id: `B2.${r.arxivId}`,
        pass: false,
        detail: "arXiv 反查无结果（id 不存在或网络失败）",
      });
      continue;
    }
    const score = titleOverlap(r.title, title);
    checks.push({
      id: `B2.${r.arxivId}`,
      pass: score >= TITLE_OVERLAP_THRESHOLD,
      detail: `标题重合度 ${score.toFixed(2)}（阈值 ${TITLE_OVERLAP_THRESHOLD}）｜产物「${r.title}」｜arXiv「${title}」`,
    });
  }

  // B4：作者与年份必须与本 run 落盘卡片一致。
  //
  // 为什么单独一条：B2 只比对标题，而标题最容易被模型照抄对、作者最容易被编造
  // （实测：某次运行 5 条引用标题重合度全部 1.00，作者列表却整组是虚构的）。
  // 卡片里的作者是 arxiv_save 从 arXiv 取回的权威值，比对是纯本地、零网络开销的，
  // 没有理由不查。姓氏比对容忍 "Jason T. L. Wang" → "J. Wang" 这类缩写。
  //
  // 三项子判据与 scripts/verify-proposal.ts 逐条对齐：年份、姓氏子集、**第一作者**。
  // 第一作者单列，是因为子集判据挡不住「作者顺序被打乱」——把二作提到一作，
  // 每个姓氏都还在集合里，但引用指的已经不是同一篇文献的署名事实了。
  for (const r of refs) {
    const card = readCard(runDir, r.arxivId);
    if (!card) continue; // 已由 B1 判负，不重复报

    const problems: string[] = [];

    if (card.year && r.year !== card.year) {
      problems.push(`年份不符（产物 ${r.year}，arXiv ${card.year}）`);
    }

    const truth = new Set(card.authors.map(surnameOf).filter(Boolean));
    const claimed = r.authors.map(surnameOf).filter(Boolean);
    const bogus = claimed.filter((s) => !truth.has(s));
    if (truth.size > 0 && bogus.length > 0) {
      problems.push(
        `作者不符：${bogus.join(", ")} 不在该文献作者中（arXiv: ${card.authors.join(", ")}）`,
      );
    }

    const firstTruth = surnameOf(card.authors[0] ?? "");
    const firstClaimed = surnameOf(r.authors[0] ?? "");
    if (firstTruth && firstClaimed !== firstTruth) {
      problems.push(
        `第一作者不符（产物「${r.authors[0] ?? ""}」，arXiv「${card.authors[0] ?? ""}」）`,
      );
    }

    checks.push({
      id: `B4.${r.arxivId}`,
      pass: problems.length === 0,
      detail:
        problems.length === 0
          ? "作者与年份与本 run 落盘卡片一致，第一作者一致"
          : `${problems.join("；")} —— 必须照抄 memory/papers/ 中的元数据，不得凭记忆填写`,
    });
  }

  const failed = checks.filter((c) => !c.pass).map((c) => c.id);
  return {
    ok: failed.length === 0,
    referenceCount: refs.length,
    papersInRun: known.size,
    checks,
    failed,
  };
}

export type VerifyProposalFileResult = VerifyReferencesResult & {
  artifact: string;
  schemaOk: boolean;
  /** schema 未过时的逐条错误（`字段: 说明`） */
  schemaIssues: string[];
};

/**
 * 读 run 目录内的 proposal 工件，跑 A（10 字段契约）+ B（引用真实性）。
 * schema 不过也照跑 B —— 便于 master 一次拿到全部返工点，而不是来回试。
 */
export async function verifyProposalFile(
  relPath = "proposal.json",
  runDir = resolveRunDir(),
): Promise<VerifyProposalFileResult> {
  const read = readArtifact(relPath, runDir);
  if (read.kind !== "file") {
    return {
      artifact: relPath,
      schemaOk: false,
      schemaIssues: [
        read.kind === "missing"
          ? `工件不存在；run 目录现有：${read.available.join(", ") || "(空)"}`
          : "路径是目录，不是 proposal 工件",
      ],
      ok: false,
      referenceCount: 0,
      papersInRun: listPapers(runDir).length,
      checks: [{ id: "A.schema", pass: false, detail: `无法读取 ${relPath}` }],
      failed: ["A.schema"],
    };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(read.content);
  } catch (e) {
    return {
      artifact: relPath,
      schemaOk: false,
      schemaIssues: [`JSON 解析失败: ${String(e)}`],
      ok: false,
      referenceCount: 0,
      papersInRun: listPapers(runDir).length,
      checks: [{ id: "A.schema", pass: false, detail: `JSON 解析失败: ${String(e)}` }],
      failed: ["A.schema"],
    };
  }

  const parsed = ProposalSchema.safeParse(raw);
  const schemaIssues = parsed.success
    ? []
    : parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);

  // schema 失败也尽量取出 references，让 B 照跑
  const refs: Reference[] = parsed.success
    ? parsed.data.references
    : ProposalSchema.shape.references.safeParse((raw as { references?: unknown })?.references)
          .success
      ? (ProposalSchema.shape.references.parse((raw as { references: unknown }).references) as Reference[])
      : [];

  const b = await verifyReferences(refs, runDir);
  const checks: RefCheck[] = [
    {
      id: "A.schema",
      pass: parsed.success,
      detail: parsed.success ? "proposal 通过 10 字段契约" : schemaIssues.join("; "),
    },
    ...b.checks,
  ];
  const failed = checks.filter((c) => !c.pass).map((c) => c.id);
  return {
    artifact: relPath,
    schemaOk: parsed.success,
    schemaIssues,
    ok: failed.length === 0,
    referenceCount: refs.length,
    papersInRun: b.papersInRun,
    checks,
    failed,
  };
}
