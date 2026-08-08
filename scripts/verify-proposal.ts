/**
 * 确定性验收器（criteria A/B/E3）。不调用任何 LLM。
 * 用法：node scripts/verify-proposal.ts runs/<ts>
 *
 * 检查：
 *  A  proposal.json 通过 ProposalSchema（10 字段全量）
 *  B1 每条 reference 的 arxivId 存在于 runs/<ts>/memory/papers/（本次运行实检命中）
 *  B2 每条 arxivId 重新请求 arXiv API，标题归一化后须一致（token overlap ≥ 0.8）
 *  B3 references ≥ 5
 *  B4 作者核验：本地作者姓氏 ⊆ arXiv 真实作者姓氏，且第一作者姓氏一致
 * 结果写 runs/<ts>/verification-report.md，任一失败 exit 1。
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { ProposalSchema, ReferenceSchema, type Reference } from "#lib/contracts.ts";

const runDir = process.argv[2];
if (!runDir || !existsSync(runDir)) {
  console.error("usage: node scripts/verify-proposal.ts runs/<ts>");
  process.exit(2);
}

type Check = { id: string; pass: boolean; detail: string };
const checks: Check[] = [];
const push = (id: string, pass: boolean, detail: string) => {
  checks.push({ id, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} ${id}: ${detail}`);
};

const normalize = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9一-鿿]+/g, " ").trim();

const overlap = (a: string, b: string) => {
  const ta = new Set(normalize(a).split(" "));
  const tb = new Set(normalize(b).split(" "));
  if (ta.size === 0 || tb.size === 0) return 0;
  let hit = 0;
  for (const t of ta) if (tb.has(t)) hit++;
  return hit / Math.max(ta.size, tb.size);
};

// A: schema
let refs: Reference[] = [];
const proposalPath = join(runDir, "proposal.json");
try {
  const raw = JSON.parse(readFileSync(proposalPath, "utf8"));
  const parsed = ProposalSchema.safeParse(raw);
  if (parsed.success) {
    refs = parsed.data.references;
    push("A.schema", true, "proposal.json 通过 10 字段契约");
  } else {
    push("A.schema", false, parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    // schema 失败仍尽量解析 references，让 B 检查照跑，便于定向打回
    const fallback = z.array(ReferenceSchema).safeParse(raw?.references);
    if (fallback.success) refs = fallback.data;
  }
} catch (e) {
  push("A.schema", false, `无法读取/解析 ${proposalPath}: ${e}`);
}

// B1: 引用必须来自本次运行的 papers/
const papersDir = join(runDir, "memory", "papers");
const known = new Set(
  existsSync(papersDir)
    ? readdirSync(papersDir).map((f) => f.replace(/\.md$/, "").replace(/__/g, "/"))
    : [],
);
for (const r of refs) {
  push(`B1.${r.arxivId}`, known.has(r.arxivId), known.has(r.arxivId) ? "在本次运行 memory/papers/ 中" : `未在本次运行实检命中（papers/ 共 ${known.size} 篇）`);
}

// B3
push("B3.count", refs.length >= 5, `references = ${refs.length}（要求 ≥5）`);

// B2+B4: 逐条反查 arXiv（标题 + 真实作者列表）
const fetchEntry = async (
  id: string,
): Promise<{ title: string; authors: string[] } | null> => {
  const url = `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}&max_results=1`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`http ${res.status}`);
      const xml = await res.text();
      const entry = xml.split("<entry>")[1];
      if (!entry) return null;
      const m = entry.match(/<title>([\s\S]*?)<\/title>/);
      if (!m) return null;
      const authors = [...entry.matchAll(/<name>([\s\S]*?)<\/name>/g)].map((a) =>
        a[1].replace(/\s+/g, " ").trim(),
      );
      return { title: m[1].replace(/\s+/g, " ").trim(), authors };
    } catch {
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
  return null;
};

/** "A. B. Vaswani" / "Vaswani, A." → "vaswani"（取最长词元当姓氏，容忍缩写与逗号序） */
const surname = (name: string): string => {
  const tokens = normalize(name).split(" ").filter((t) => t.length > 1);
  if (tokens.length === 0) return normalize(name).trim();
  return tokens.reduce((a, b) => (b.length >= a.length ? b : a));
};

for (const r of refs) {
  const remote = await fetchEntry(r.arxivId);
  if (remote === null) {
    push(`B2.${r.arxivId}`, false, "arXiv 反查无结果（id 不存在或网络失败）");
    continue;
  }
  const score = overlap(r.title, remote.title);
  push(`B2.${r.arxivId}`, score >= 0.8, `标题重合度 ${score.toFixed(2)}｜本地「${r.title}」｜arXiv「${remote.title}」`);

  const remoteSurnames = new Set(remote.authors.map(surname));
  const localSurnames = r.authors.map(surname);
  const missing = localSurnames.filter((s) => !remoteSurnames.has(s));
  const firstOk =
    remote.authors.length > 0 && localSurnames[0] === surname(remote.authors[0]);
  push(
    `B4.${r.arxivId}`,
    missing.length === 0 && firstOk,
    missing.length === 0 && firstOk
      ? `作者姓氏全部命中，第一作者一致（${remote.authors[0]}）`
      : `虚构作者嫌疑：未命中姓氏 [${missing.join(", ")}]${firstOk ? "" : `；第一作者不符（本地「${r.authors[0] ?? ""}」vs arXiv「${remote.authors[0] ?? ""}」）`}`,
  );
  await new Promise((r) => setTimeout(r, 1000)); // arXiv API 礼貌间隔
}

const failed = checks.filter((c) => !c.pass);
const report = [
  `# 验收报告（确定性检查）`,
  ``,
  `run: ${runDir}`,
  `时间: ${new Date().toISOString()}`,
  `结果: ${failed.length === 0 ? "ALL PASS" : `${failed.length}/${checks.length} FAILED`}`,
  ``,
  `| 检查项 | 结果 | 说明 |`,
  `|--------|------|------|`,
  ...checks.map((c) => `| ${c.id} | ${c.pass ? "✅" : "❌"} | ${c.detail.replace(/\|/g, "\\|")} |`),
  ``,
].join("\n");
writeFileSync(join(runDir, "verification-report.md"), report);
console.log(`\n${failed.length === 0 ? "ALL PASS" : `${failed.length} FAILED`} → ${join(runDir, "verification-report.md")}`);
process.exit(failed.length === 0 ? 0 : 1);
