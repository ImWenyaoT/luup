/** Science-125 题库的只读边界。
 *
 * 题库是冻结事实：`data/science125.json` 由抓取脚本一次性产出，代码只读不写。
 * 解析对坏行是宽容的（跳过而不是整份作废）——一条格式不对的记录不该让 125 题全跑不了。
 *
 * cutover 之前这份文件与 `backend/app/data/science125.json` 逐字节相同：
 * 两个栈跑同一批题、报同一个题号，不允许各读各的。
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type Science125Question = {
  id: number;
  domain: string;
  question: string;
};

export type Science125Domain = {
  domain: string;
  count: number;
  questions: Science125Question[];
};

export type Science125 = {
  source: string;
  retrievedAt: string;
  total: number;
  domains: Science125Domain[];
};

const UNCLASSIFIED = "(未分类)";

/** 相对模块自身定位，不看 cwd：批跑既可能从仓根起，也可能从别处起。 */
export function defaultScience125Path(): string {
  return fileURLToPath(new URL("../../data/science125.json", import.meta.url));
}

function readRaw(path: string): Record<string, unknown> | null {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
  return typeof raw === "object" && raw !== null && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : null;
}

function toQuestion(item: unknown): Science125Question | null {
  if (typeof item !== "object" || item === null || Array.isArray(item)) return null;
  const { id, question, domain } = item as Record<string, unknown>;
  if (!Number.isInteger(id) || typeof question !== "string") return null;
  return {
    id: id as number,
    domain: typeof domain === "string" && domain ? domain : UNCLASSIFIED,
    question,
  };
}

function questionList(raw: Record<string, unknown> | null): unknown[] {
  const questions = raw?.questions;
  return Array.isArray(questions) ? questions : [];
}

/** 整份题库，按 domain 分组（12 组），组内保持文件里的顺序。 */
export function readScience125(path: string = defaultScience125Path()): Science125 | null {
  const raw = readRaw(path);
  const questions = questionList(raw);
  if (questions.length === 0) return null;

  const grouped = new Map<string, Science125Question[]>();
  for (const item of questions) {
    const question = toQuestion(item);
    if (question === null) continue;
    const bucket = grouped.get(question.domain);
    if (bucket) bucket.push(question);
    else grouped.set(question.domain, [question]);
  }
  return {
    source: typeof raw?.source === "string" ? raw.source : "",
    retrievedAt: typeof raw?.retrievedAt === "string" ? raw.retrievedAt : "",
    total: questions.length,
    domains: [...grouped].map(([domain, items]) => ({ domain, count: items.length, questions: items })),
  };
}

export function findQuestion(
  identifier: number,
  path: string = defaultScience125Path(),
): Science125Question | null {
  for (const item of questionList(readRaw(path))) {
    const question = toQuestion(item);
    if (question !== null && question.id === identifier) return question;
  }
  return null;
}

/** 题号变成 Run 的 question 文本。
 *
 * 只放问题与它的出处，不放操作指令：检索该怎么做是角色 instructions 的事，
 * 混进 question 会让模型只把问题那段填回 Artifact，撞上「不得改写冻结问题」那道门。
 */
export function science125Text(question: Science125Question): string {
  return `来源：《Science》125 前沿科学问题（Science-125 题库）第 ${question.id} 题，${question.domain}。\n\n`
    + `问题：${question.question}`;
}
