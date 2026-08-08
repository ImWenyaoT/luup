/**
 * question.md 的**唯一**模板，以及它的解析端。
 *
 * 三个入口会写 question.md：web 的 /api/runs（Science-125 选题与自由输入）、
 * CLI 的 scripts/run-batch.ts。三份逐字相同的模板意味着改一个字就产出不可比的 run，
 * 而「不可比」不会报错，只会在半年后的对照表里变成一条读不懂的数据。
 * 解析端（SOURCE_LINE / parseQuestion）钉在同一个文件里：模板改了，编译期就能看到
 * 解析式也在旁边，而不是散在 lib/phase.ts 里等着漂。
 */

const TASK_LINE =
  "任务：围绕该问题识别当前研究的具体知识缺口，生成可验证的科学假设，并给出完整研究计划（10 标准字段）。";

/** Science-125 选题：来源行带题号与学科，SOURCE_LINE 从这一行反解。 */
export function science125Text(q: { id: number; domain: string; question: string }): string {
  return [
    `来源：《Science》125 前沿科学问题（fixtures/science125.json）第 ${q.id} 题，${q.domain}。`,
    "",
    `问题：${q.question}`,
    "",
    TASK_LINE,
  ].join("\n");
}

/**
 * 自由输入也必须走模板。这不是排版洁癖：run.ts 的 readQuestion 会把
 * 「不含空白且存在的字符串」当文件路径读，裸传 `package.json` 就是任意文件读取。
 * 模板保证至少含换行；路由层另外拒绝 /^\S+$/。
 */
export function freeformText(question: string): string {
  return ["来源：luup 交付面自由输入。", "", `问题：${question.trim()}`, "", TASK_LINE].join("\n");
}

/** science125Text 来源行的反解式。与上面的模板同生共死。 */
const SOURCE_LINE = /第\s*(\d+)\s*题[，,]\s*([^。\n]+)。/;

export type ParsedQuestion = {
  full: string;
  short: string;
  domain: string | null;
  science125Id: number | null;
};

/** question.md → 题号 / 学科 / 一行摘要。非本模板写出的文本退化成「首个正文行」。 */
export function parseQuestion(text: string | null): ParsedQuestion {
  const full = (text ?? "").trim();
  const m = SOURCE_LINE.exec(full);
  const asked = /问题[:：]\s*(.+)/.exec(full)?.[1]?.trim();
  const firstBody = full
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0 && !l.startsWith("#") && !l.startsWith("来源"));
  const short = (asked ?? firstBody ?? "(无问题原文)").slice(0, 160);
  return {
    full,
    short,
    domain: m?.[2]?.trim() ?? null,
    science125Id: m ? Number(m[1]) : null,
  };
}
