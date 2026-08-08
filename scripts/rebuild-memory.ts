/**
 * 从 runs/ 重建 campaign memory 的 library 与战役页（memory 是 runs 的派生物这一
 * 事实的可执行证明）。幂等：upsertLibraryPaper 保 fetchedAt 首值、合并 questionIds；
 * 题页只补"回填"条目（同一 run 已登记过则跳过）。
 *
 *   node scripts/rebuild-memory.ts
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { listPapers, readCard, paperPath } from "#lib/paperStore.ts";
import {
  memoryEnabled,
  upsertLibraryPaper,
  archiveRunOutcome,
  questionPath,
} from "#lib/campaignMemory.ts";

const repoRoot = resolve(import.meta.dirname, "..");
const runsRoot = join(repoRoot, "runs");

if (!memoryEnabled()) {
  console.error("memory/ 不存在——先建脚手架再回填。");
  process.exit(2);
}
if (!existsSync(runsRoot)) {
  console.log("runs/ 不存在，无可回填。");
  process.exit(0);
}

let papers = 0;
let outcomes = 0;
for (const ent of readdirSync(runsRoot, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
  if (!ent.isDirectory()) continue;
  const runDir = join(runsRoot, ent.name);

  let questionId: number | null = null;
  try {
    const meta = JSON.parse(readFileSync(join(runDir, "meta.json"), "utf8")) as { questionId?: unknown };
    if (typeof meta.questionId === "number") questionId = meta.questionId;
  } catch {
    /* 老 run 或 eval run 无 meta —— 文献仍值得进 library，questionId 记 null */
  }

  for (const id of listPapers(runDir)) {
    const card = readCard(runDir, id);
    if (!card) continue;
    const markdown = readFileSync(paperPath(runDir, id), "utf8");
    const r = upsertLibraryPaper({ card, markdown, questionId });
    if (!("skipped" in r && r.skipped)) papers++;
  }

  // 题页回填：verification-report 的头部结果行 + FAILED 与否；同一 run 已登记过则跳过
  if (questionId !== null) {
    const qp = questionPath(questionId);
    const already = existsSync(qp) && readFileSync(qp, "utf8").includes(runDir);
    if (!already) {
      const reportPath = join(runDir, "verification-report.md");
      const failed = existsSync(join(runDir, "FAILED.md"));
      const verdict = failed
        ? "FAILED"
        : existsSync(reportPath) && /结果:\s*ALL PASS/.test(readFileSync(reportPath, "utf8"))
          ? "ALL PASS"
          : "UNVERIFIED";
      const r = archiveRunOutcome({
        questionId,
        verdict,
        summary: `回填自历史 run（rebuild-memory.ts）；工件与 verdicts 见 run 目录。`,
        runDir,
      });
      if (!r.skipped && r.failed.length === 0) outcomes++;
    }
  }
}
console.log(`回填完成：library upsert ${papers} 次，战役记录 ${outcomes} 条。`);
