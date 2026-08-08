/**
 * 写本次 run 的 handoff 工件（architecture.md「显式 handoff」）。
 * 路径 jail、保护区、契约校验全在 agent/lib/artifacts.ts，本文件只做工具面。
 */
import { defineTool } from "eve/tools";
import { z } from "zod";
import { ArtifactPathError, writeArtifact } from "../lib/artifacts.ts";
import { resolveRunDir } from "../lib/runContext.ts";

export default defineTool({
  description:
    "Write one artifact into this run's directory. Paths are ALWAYS relative to the run directory; " +
    "absolute paths and `..` are rejected. Canonical artifacts: `evidence.md`, `hypotheses.md`, " +
    "`critique.json`, `proposal.json`, `verdicts/<node>-r<round>.json`, `memory/rejected.md`, `FAILED.md`. " +
    "`proposal.json` is validated against the 10-field proposal contract, `critique.json` against the " +
    "critique contract and `verdicts/*.json` against the verdict contract: an invalid document is NOT " +
    "written — you get the exact field errors back and the draft is kept as `<path>.rejected.json`. " +
    "`memory/papers/**` and `memory/index.md` are owned by `arxiv_save` and cannot be written here. " +
    "The result carries `runDir`, the absolute path of this run's directory — report it in your final summary.",
  inputSchema: z.object({
    path: z
      .string()
      .min(1)
      .describe('Run-relative path, e.g. "evidence.md" or "verdicts/literature-r1.json".'),
    content: z.string().describe("Full file content. Writing replaces the file."),
  }),
  async execute({ path, content }) {
    try {
      const result = writeArtifact(path, content);
      return {
        ...result,
        /** run 目录的绝对路径：master 的收尾报告要报它，外层（驱动 / eval）据此定位本次产物 */
        runDir: resolveRunDir(),
        hint: result.ok
          ? "已落盘。"
          : `未写入：${result.validatedAs} 校验失败。逐条修正 issues 后重写；草稿已留在 ${result.draftPath ?? "(未留存)"}。`,
      };
    } catch (e) {
      if (e instanceof ArtifactPathError) {
        return { path, ok: false, bytes: 0, created: false, validatedAs: null, issues: [e.message], hint: "路径被拒绝，改用 run 目录内的相对路径。" };
      }
      throw e;
    }
  },
});
