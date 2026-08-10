/**
 * 读本次 run 的文献索引 index.md（architecture.md「memory 布局」L0/L1 层）。
 * 这是无向量库的「模糊检索」入口：agent 先读索引挑候选，再按需读整卡。
 */
import { tool } from "@openai/agents";
import { z } from "zod";
import { listPapers, readIndex } from "../paperStore.ts";
import { resolveRunDir } from "../runContext.ts";

const parameters = z.object({});

/** 裸执行函数：selftest 直调它，不经 SDK 的 RunContext。 */
export async function executePaperIndexRead() {
  const runDir = resolveRunDir();
  const ids = listPapers(runDir);
  return {
    count: ids.length,
    arxivIds: ids,
    index: readIndex(runDir),
  };
}

export default tool({
  name: "paper_index_read",
  description:
    "Read this run's literature index (one line per saved paper: arXiv id, year, title, one-sentence abstract). " +
    "Use it to see what has already been collected before searching again, and to pick which ids to cite. " +
    "Only ids listed here are citable.",
  parameters,
  execute: executePaperIndexRead,
});
