/** Science-125 题库的只读边界。
 *
 * 题库是冻结事实：`data/science125.json` 由抓取脚本一次性产出，代码只读不写。
 * 解析对坏行是宽容的（跳过而不是整份作废）——一条格式不对的记录不该让 125 题全跑不了。
 *
 * 内容与 Python 期 `app/data/science125.json`（ADR-0004 已删）逐字节相同：换栈没有换题库，
 * 题号在两栈之间可比，Python 期跑出的 `runs/` 归档因此仍能按题号对上。
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type Science125Question = {
  id: number;
  domain: string;
  question: string;
};

type Science125Domain = {
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
function defaultScience125Path(): string {
  return fileURLToPath(new URL("../../../../data/science125.json", import.meta.url));
}

function readRaw(path: string): Record<string, unknown> | null {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
  return typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
}

function toQuestion(item: unknown): Science125Question | null {
  if (typeof item !== "object" || item === null || Array.isArray(item)) return null;
  const { id, question, domain } = item as Record<string, unknown>;
  if (!Number.isSafeInteger(id) || (id as number) < 1 || typeof question !== "string" || question.trim().length === 0)
    return null;
  return {
    id: id as number,
    domain: typeof domain === "string" && domain ? domain : UNCLASSIFIED,
    question,
  };
}

export type Science125Integrity = {
  ok: boolean;
  rawCount: number;
  validCount: number;
  duplicateIds: number[];
  missingIds: number[];
  unexpectedIds: number[];
};

/** 正式批跑的冻结题库门：恰好 125 条、题号 1..125 各一次、每条均可解析。 */
export function science125Integrity(path: string = defaultScience125Path()): Science125Integrity {
  const raw = readRaw(path);
  const items = questionList(raw);
  const questions = items.map(toQuestion).filter((item): item is Science125Question => item !== null);
  const counts = new Map<number, number>();
  for (const question of questions) counts.set(question.id, (counts.get(question.id) ?? 0) + 1);
  const duplicateIds = [...counts]
    .filter(([, count]) => count > 1)
    .map(([id]) => id)
    .sort((left, right) => left - right);
  const missingIds = Array.from({ length: 125 }, (_, index) => index + 1).filter((id) => !counts.has(id));
  const unexpectedIds = [...counts.keys()].filter((id) => id > 125).sort((left, right) => left - right);
  return {
    ok:
      items.length === 125 &&
      questions.length === 125 &&
      duplicateIds.length === 0 &&
      missingIds.length === 0 &&
      unexpectedIds.length === 0,
    rawCount: items.length,
    validCount: questions.length,
    duplicateIds,
    missingIds,
    unexpectedIds,
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

export function findQuestion(identifier: number, path: string = defaultScience125Path()): Science125Question | null {
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
  return (
    `来源：《Science》125 前沿科学问题（Science-125 题库）第 ${question.id} 题，${question.domain}。\n\n` +
    `问题：${question.question}`
  );
}
