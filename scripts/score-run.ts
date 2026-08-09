/**
 * M9 质量评分（criteria H，Tier2 诊断分）。**要花钱：一次 run 一次 judge 调用。**
 *
 *   pnpm score runs/<ts>
 *
 * 产出两样：
 *  - `runs/<ts>/score.json` —— 逐维档位 + 断言归因 + veto 位 + 出处身份（rubric 版本、
 *    judge 模型、时间）。**分数只落在这里**，不进验收报告、不进批次报告的「成绩」栏。
 *  - 题页 `memory/questions/q<id>.md` 的**事实行** —— 胜出方案 + 关键断言原文 + 无出处断言。
 *    **不写分数、不写维度名、不写 judge 评语**（criteria H：回传给 agent 的只有事实）。
 *
 * ## 三条边界
 *
 * - **不进 gate。** 本脚本的退出码只表示「评分这件事本身成没成」，与「这一题算不算交付」
 *   无关 —— 后者由 `scripts/verify-proposal.ts` 与 `lib/runOutcome.ts` 确定性地判。
 * - **不改 proposal。** 评分是只读的旁路，跑几次都不会动交付物。
 * - **解析失败就失败。** 不补默认分、不隐式重试：一个静默的默认分会让「judge 没在判事」
 *   长得和「judge 判它是中等」一模一样，而 M10 校准的全部意义正是把两者分开。
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { writeNote } from "#lib/campaignMemory.ts";
import { REPO_ROOT } from "../lib/paths.ts";
import { readJsonFile } from "../lib/runOutcome.ts";
import {
  RUBRIC_VERSION,
  SCORE_DIMENSIONS,
  type ScoreFile,
  buildJudgeRequest,
  factNote,
  levelLabel,
  parseScore,
  totalScore,
} from "../lib/scoring.ts";
import { JUDGE_MODEL_ID, JUDGE_THINKING, askJudge } from "./judgeClient.ts";

const arg = process.argv[2];
if (!arg) {
  console.error("usage: node scripts/score-run.ts runs/<ts>");
  process.exit(2);
}
const runDir = resolve(REPO_ROOT, arg);
const runId = basename(runDir);
const proposalPath = join(runDir, "proposal.json");
if (!existsSync(proposalPath)) {
  console.error(`[luup] ${proposalPath} 不存在：这个 run 没有可评分的交付物。`);
  process.exit(2);
}

const proposalJson = readFileSync(proposalPath, "utf8");
const evidencePath = join(runDir, "evidence.md");
const evidenceMd = existsSync(evidencePath) ? readFileSync(evidencePath, "utf8") : "";

const reply = await askJudge(buildJudgeRequest({ proposalJson, evidenceMd }), `M9 ${runId}`);
const parsed = parseScore(reply.text);
if (!parsed.ok) {
  // 原文留档，便于判断是 rubric 说不清楚还是端点抽风 —— 但绝不据此补一个分数
  const rawPath = join(runDir, "score.raw.txt");
  writeFileSync(rawPath, reply.text, "utf8");
  console.error(`[luup] judge 输出无法解析：${parsed.error}`);
  console.error(`[luup] 原文已留档 ${rawPath}`);
  process.exit(1);
}

const score = parsed.score;
const totals = totalScore(score);
const scoreFile: ScoreFile = {
  ...score,
  runId,
  rubricVersion: RUBRIC_VERSION,
  judgeModel: JUDGE_MODEL_ID,
  thinking: JUDGE_THINKING,
  scoredAt: new Date().toISOString(),
  ...totals,
};
const scorePath = join(runDir, "score.json");
writeFileSync(scorePath, `${JSON.stringify(scoreFile, null, 2)}\n`, "utf8");

console.log(`\n[M9] ${runId}｜rubric v${RUBRIC_VERSION}｜judge ${JUDGE_MODEL_ID}(thinking=${JUDGE_THINKING})`);
for (const d of SCORE_DIMENSIONS) {
  const s = score.dimensions[d.id];
  console.log(`  ${d.label.padEnd(8, "　")} ${s.level} ${levelLabel(s.level)}｜断言 ${s.claims.length} 条`);
}
console.log(`  加权总分 ${totals.weighted}/${totals.max}（${totals.percent}%）`);
console.log(`  veto ${score.veto.triggered ? `⛔ 触发（${score.veto.claims.length} 条无出处断言）` : "✅ 未触发"}`);
for (const c of score.veto.claims) console.log(`    - 「${c.quote.replace(/\s+/g, " ").slice(0, 120)}」`);
console.log(`  → ${scorePath}`);

/* ------------------------------------------------------------------ */
/* 题页事实行（只写事实，不写分数）                                        */
/* ------------------------------------------------------------------ */

const questionId = (readJsonFile<{ questionId?: unknown }>(join(runDir, "meta.json"))?.questionId ?? null) as
  | number
  | null;
const paperTitle = (readJsonFile<{ paperTitle?: unknown }>(proposalPath)?.paperTitle ?? "") as string;

// 关键断言取「有出处」与「明确标注为待验证」的那些：它们是可复用的事实。
// judge 的自由评语（Claim.note）一律不回传 —— 那是 rubric 措辞最容易泄漏的地方。
const claims = SCORE_DIMENSIONS.flatMap((d) => score.dimensions[d.id].claims)
  .filter((c) => c.attribution !== "unsourced")
  .slice(0, 5);

if (questionId === null) {
  console.log("[luup] 本 run 没有 Science-125 题号（meta.json 缺 questionId），跳过题页写入。");
} else {
  const result = writeNote({
    target: "question",
    questionId,
    note: factNote({ runId, winningTitle: paperTitle, claims, veto: score.veto }),
    source: "score-run",
  });
  if (result.skipped) console.log(`[luup] campaign memory 未启用（${result.reason ?? "memory/ 不存在"}），跳过题页写入。`);
  for (const w of result.written) console.log(`[luup] 题页事实行 ✔ ${w.path}`);
  for (const f of result.failed) console.error(`[luup] 题页事实行 ✘ ${f.path} — ${f.reason}`);
}
