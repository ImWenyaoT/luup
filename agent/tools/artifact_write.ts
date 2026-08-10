/**
 * 写本次 run 的 handoff 工件（architecture.md「显式 handoff」）。
 * 路径 jail、保护区、契约校验、返工预算全在 agent/lib/artifacts.ts，本文件只做工具面。
 *
 * replay: "never" —— 覆盖写单个文件本身是幂等的，但 `verdicts/` 目录**就是**返工预算的
 * 计数器（lib/rework.ts）：重放一次被中断的 verdict 写入会多记一轮，或多留一份
 * `.rejected.json` 草稿，直接改变熔断判定。要重放先确认该轮次文件尚未落盘。
 */
import { defineTool } from "eve/tools";
import { z } from "zod";
import { REWORK_CAPS } from "../../lib/rework.ts";
import { type ArtifactWriteResult, ArtifactPathError, writeArtifact } from "../lib/artifacts.ts";
import { resolveRunDir } from "../lib/runContext.ts";

/** 三种结局各说各的下一步：落盘 / 契约打回 / 预算拒写。 */
function hintFor(r: ArtifactWriteResult): string {
  const balance = r.budget
    ? `本节点返工预算：已用 ${r.budget.semanticRounds}/${REWORK_CAPS.maxRounds} 轮，remaining=${r.budget.remaining}，格式重试 ${r.budget.formatRetries} 次。`
    : "";
  if (r.deniedBy) {
    return `未写入（返工预算拒写，governingCap=${r.deniedBy}）。${balance}这就是熔断：不要再重试该节点，按 instructions 写 FAILED.md。`;
  }
  if (!r.ok) {
    return `未写入：${r.validatedAs} 校验失败。逐条修正 issues 后重写；草稿已留在 ${r.draftPath ?? "(未留存)"}。`;
  }
  return `已落盘。${balance}`;
}

export default defineTool({
  description:
    "Write one artifact into this run's directory. Paths are ALWAYS relative to the run directory; " +
    "absolute paths and `..` are rejected. Canonical artifacts: `evidence.md`, `proposal.json`, " +
    "`review.json`, `FAILED.md`. `proposal.json` and `review.json` are schema-validated: an invalid document is NOT " +
    "written — you get the exact field errors back and the draft is kept as `<path>.rejected.json`. " +
    "`memory/papers/**` and `memory/index.md` are owned by `arxiv_save` and cannot be written here. " +
    "The result carries `runDir`, the absolute path of this run's directory — report it in your final summary.",
  inputSchema: z.object({
    path: z
      .string()
      .min(1)
      .describe('Run-relative path, e.g. "evidence.md", "proposal.json" or "review.json".'),
    content: z.string().describe("Full file content. Writing replaces the file."),
  }),
  async execute({ path, content }) {
    try {
      const result = writeArtifact(path, content);
      return {
        ...result,
        /** run 目录的绝对路径：master 的收尾报告要报它，外层（驱动 / eval）据此定位本次产物 */
        runDir: resolveRunDir(),
        hint: hintFor(result),
      };
    } catch (e) {
      if (e instanceof ArtifactPathError) {
        return { path, ok: false, bytes: 0, created: false, validatedAs: null, issues: [e.message], hint: "路径被拒绝，改用 run 目录内的相对路径。" };
      }
      throw e;
    }
  },
});
