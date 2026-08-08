/**
 * 读本次 run 的文献索引 index.md（architecture.md「memory 布局」L0/L1 层）。
 * 这是无向量库的「模糊检索」入口：agent 先读索引挑候选，再按需读整卡。
 */
import { defineTool } from "eve/tools";
import { z } from "zod";
import { listPapers, readIndex } from "../paperStore.ts";
import { resolveRunDir } from "../runContext.ts";

export default defineTool({
  description:
    "Read this run's literature index (one line per saved paper: arXiv id, year, title, one-sentence abstract). " +
    "Use it to see what has already been collected before searching again, and to pick which ids to cite. " +
    "Only ids listed here are citable.",
  inputSchema: z.object({}),
  async execute() {
    const runDir = resolveRunDir();
    const ids = listPapers(runDir);
    return {
      count: ids.length,
      arxivIds: ids,
      index: readIndex(runDir),
    };
  },
});
