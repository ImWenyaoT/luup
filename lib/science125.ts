import { readFileSync } from "node:fs";
import { SCIENCE125_FILE } from "./paths";
import type { Science125 } from "./types";

type Raw = {
  source?: string;
  retrievedAt?: string;
  questions?: { id: number; domain: string; question: string }[];
};

/**
 * fixtures/science125.json 是 runs/ 之外唯一的读点，路径硬编码、不接受参数。
 * 按 domain 分组保持文件里的首次出现顺序（题号本身就是按学科聚簇的）。
 */
export function readScience125(): Science125 | null {
  let raw: Raw;
  try {
    raw = JSON.parse(readFileSync(SCIENCE125_FILE, "utf8")) as Raw;
  } catch {
    return null;
  }
  const questions = raw.questions;
  if (!Array.isArray(questions) || questions.length === 0) return null;

  const order: string[] = [];
  const buckets = new Map<string, { id: number; question: string }[]>();
  for (const q of questions) {
    if (typeof q?.id !== "number" || typeof q.question !== "string") continue;
    const domain = typeof q.domain === "string" && q.domain ? q.domain : "(未分类)";
    if (!buckets.has(domain)) {
      buckets.set(domain, []);
      order.push(domain);
    }
    buckets.get(domain)!.push({ id: q.id, question: q.question });
  }
  return {
    source: raw.source ?? "",
    retrievedAt: raw.retrievedAt ?? "",
    total: questions.length,
    domains: order.map((domain) => ({
      domain,
      count: buckets.get(domain)!.length,
      questions: buckets.get(domain)!,
    })),
  };
}

export function findQuestion(id: number): { id: number; domain: string; question: string } | null {
  try {
    const raw = JSON.parse(readFileSync(SCIENCE125_FILE, "utf8")) as Raw;
    return raw.questions?.find((q) => q.id === id) ?? null;
  } catch {
    return null;
  }
}
