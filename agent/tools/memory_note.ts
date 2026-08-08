/**
 * 往跨 run 长期记忆里追加一条记录（master 专属；docs/design/memory.md「写入纪律」）。
 *
 * 两条硬约束在代码层，不在提示词里：
 *
 *  1. **可写面是闭集**：只有 `questions/q<id>.md` 与 `lessons.md`。`library/**` 与两个
 *     index.md 是代码派生物，模型没有任何通道写它们 —— 与 run 层 `memory/papers/**`
 *     的保护区同一条纪律。
 *  2. **落盘校验**（hermes 血教训：模型批量写文件半数失败却声称全写）：每条写入都
 *     写后读回，返回结构化 `{written[], failed[]}`。`failed` 非空时不得声称写入成功。
 *
 * memory/ 不存在时静默 no-op（可删除性红线）：返回 skipped，不建目录、不报错。
 */
import { defineTool } from "eve/tools";
import { z } from "zod";
import { writeNote } from "../lib/campaignMemory.ts";

export default defineTool({
  description:
    "Append one record to the campaign-scoped long-term memory that survives across runs. " +
    "target='question' writes to this Science-125 question's campaign page (requires questionId): run outcome, " +
    "pointer to the run directory, hypotheses rejected and why, search terms that worked, literature coverage. " +
    "target='lessons' writes a cross-question operational lesson (e.g. a field with poor arXiv coverage). " +
    "Pages are append-only: never rewrite or delete earlier records. " +
    "The paper library and the indexes are code-generated and cannot be written here. " +
    "The result is verified by reading each file back: report `failed` honestly — a non-empty `failed` means " +
    "those files were NOT written, whatever your summary says.",
  inputSchema: z.object({
    target: z.enum(["question", "lessons"]).describe("'question' = this question's campaign page; 'lessons' = cross-question lessons."),
    questionId: z
      .number()
      .int()
      .min(1)
      .max(125)
      .nullable()
      .default(null)
      .describe("Science-125 question number. Required when target='question'; null otherwise."),
    note: z.string().min(1).describe("The record itself, Markdown. Be concrete: what was tried, what the verdict was, why."),
  }),
  async execute({ target, questionId, note }) {
    const result = writeNote({ target, questionId, note });
    if (result.skipped) {
      return {
        written: [],
        failed: [],
        skipped: true,
        hint: `长期记忆未启用（${result.reason ?? "memory/ 不存在"}），本次未写入。这不是错误，继续收尾即可。`,
      };
    }
    return {
      written: result.written,
      failed: result.failed,
      skipped: false,
      hint:
        result.failed.length === 0
          ? `已写入并读回验证：${result.written.map((w) => w.path).join(", ")}。`
          : `部分未写入：${result.failed.map((f) => `${f.path}（${f.reason}）`).join("；")}。收尾报告里必须如实说明这几条没写成，不要声称已归档。`,
    };
  },
});
