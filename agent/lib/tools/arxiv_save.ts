/**
 * 文献落盘工具（architecture.md「引用真实性防线」第 1–2 条）。
 *
 * 防虚构关键：**入参只有 arXiv id**。标题/作者/摘要一律由本工具自己调 getArxiv
 * 从 arXiv API 取回，绝不接受调用方传入 —— 模型没有任何通道把编造的元数据写进
 * memory/papers/，因此 verify-proposal.ts 的 B1（引用必须在 papers/ 中）+ B2
 * （标题反查一致）才有意义。
 *
 * runDir 取自环境变量 LUUP_RUN_DIR，不暴露给模型（理由见 agent/lib/paperStore.ts）。
 *
 * 并发注意：本工具 upsert 跨 run 的 `memory/library/`，那是一段**无锁的读-改-写**
 * （campaignMemory 约束 4：单写者假设）——单并发锁（lib/lock.ts）是它成立的前提。
 */
import { tool } from "@openai/agents";
import { z } from "zod";
import { getArxiv, normalizeArxivId } from "../arxiv.ts";
import { listPapers, savePaper } from "../paperStore.ts";
import { resolveRunDir } from "../runContext.ts";

const parameters = z.object({
  arxivIds: z
    .array(z.string().min(4))
    .min(1)
    .max(20)
    .describe('arXiv ids, e.g. ["2401.12345", "astro-ph/0601001"]. Version suffixes are stripped.'),
});

/** 裸执行函数：selftest 直调它，不经 SDK 的 RunContext。 */
export async function executeArxivSave({ arxivIds }: z.infer<typeof parameters>) {
  const runDir = resolveRunDir();

  const normalized: string[] = [];
  const rejected: string[] = [];
  for (const raw of arxivIds) {
    const id = normalizeArxivId(raw);
    if (id) {
      if (!normalized.includes(id)) normalized.push(id);
    } else {
      rejected.push(raw);
    }
  }

  const papers = normalized.length > 0 ? await getArxiv(normalized) : [];
  const saved = papers.map((p) => {
    const r = savePaper(runDir, p);
    return {
      arxivId: p.arxivId,
      title: p.title,
      year: p.year,
      authors: p.authors,
      created: r.created,
    };
  });

  const foundIds = new Set(papers.map((p) => p.arxivId));
  const notFound = normalized.filter((id) => !foundIds.has(id));

  return {
    saved,
    savedCount: saved.length,
    /** id 格式非法，未发给 arXiv */
    rejectedIds: rejected,
    /** 格式合法但 arXiv 查无此文 —— 这类 id 绝不可用于引用 */
    notFoundIds: notFound,
    totalPapersInRun: listPapers(runDir).length,
    hint:
      notFound.length > 0 || rejected.length > 0
        ? "Ids listed in notFoundIds/rejectedIds do not exist on arXiv. Do not cite them; search again."
        : "Saved. Cite only these ids, using exactly the titles returned here.",
  };
}

export default tool({
  name: "arxiv_save",
  description:
    "Fetch the authoritative arXiv metadata for the given arXiv ids and write each one to this run's " +
    "literature memory (memory/papers/<id>.md), refreshing memory/index.md. " +
    "You supply ONLY ids — title, authors, abstract and date are fetched from arXiv, never taken from you. " +
    "Only ids saved here may appear in the final proposal's references; unsaved or invented ids are rejected by verification.",
  parameters,
  execute: executeArxivSave,
});
