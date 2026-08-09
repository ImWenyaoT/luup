import bank from "./science125.json" with { type: "json" };
import type { Science125 } from "./types.ts";

type Raw = {
  source?: string;
  retrievedAt?: string;
  questions?: { id: number; domain: string; question: string }[];
};

/**
 * 题库数据（lib/science125.json）住在本模块旁边，构建期静态打包，无运行时 fs 读。
 * 按 domain 分组保持文件里的首次出现顺序（题号本身就是按学科聚簇的）。
 */
export function readScience125(): Science125 | null {
  const raw = bank as Raw;
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
    const raw = bank as Raw;
    return raw.questions?.find((q) => q.id === id) ?? null;
  } catch {
    return null;
  }
}
