/**
 * 往跨 run 长期记忆里追加一条记录（master 专属；docs/design/memory.md「写入纪律」）。
 *
 * 三条硬约束在代码层，不在提示词里：
 *
 *  1. **可写面是闭集**：只有 `questions/q<id>.md` 与 `lessons.md`。`library/**` 与两个
 *     index.md 是代码派生物，模型没有任何通道写它们 —— 与 run 层 `memory/papers/**`
 *     的保护区同一条纪律。
 *  2. **落盘校验**（hermes 血教训：模型批量写文件半数失败却声称全写）：每条写入都
 *     写后读回，返回结构化 `{written[], failed[]}`。`failed` 非空时不得声称写入成功。
 *  3. **题号不是入参**：写哪一题的战役页由 `runContext.resolveQuestionId()` 决定
 *     （与 runDir 同源同理由）。模型填题号就意味着它能把本题的记录写进别的题页 ——
 *     那是 schema 层能直接关掉的可控面，不该留给提示词纪律。
 *
 * memory/ 不存在时静默 no-op（可删除性红线）：返回 skipped，不建目录、不报错。
 *
 * replay: "never" —— 题页与 lessons.md 是 append-only 且没有幂等键，log.md 同步再追一条：
 * 重放必然写出重复条目（append-only 语义禁止事后删除，只能留着）。
 */
import { defineTool } from "eve/tools";
import { z } from "zod";
import { writeNote } from "../lib/campaignMemory.ts";

export default defineTool({
  description:
    "Append one record to the campaign-scoped long-term memory that survives across runs. " +
    "target='question' writes to THIS run's Science-125 question page: run outcome, pointer to the run " +
    "directory, hypotheses rejected and why, search terms that worked, literature coverage. " +
    "The question number is taken from the run environment — you do NOT pass it and cannot choose it. " +
    "If this run has no question number, target='question' fails with that reason and you should use " +
    "target='lessons' instead, which records a cross-question operational lesson (e.g. a field with poor " +
    "arXiv coverage). " +
    "Pages are append-only: never rewrite or delete earlier records. " +
    "The paper library and the indexes are code-generated and cannot be written here. " +
    "The result is verified by reading each file back: report `failed` honestly — a non-empty `failed` means " +
    "those files were NOT written, whatever your summary says.",
  inputSchema: z.object({
    target: z.enum(["question", "lessons"]).describe("'question' = this run's question page; 'lessons' = cross-question lessons."),
    note: z.string().min(1).describe("The record itself, Markdown. Be concrete: what was tried, what the verdict was, why."),
  }),
  async execute({ target, note }) {
    const result = writeNote({ target, note });
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
