/**
 * M10 judge 判别力校准（criteria H）。**要花钱：1 次基线 + 每个变异体 1 次 ≈ 6 次调用。**
 *
 *   pnpm calibrate runs/<ts>        # 取一个 ALL PASS 的 run 作原版
 *
 * 做法：对一份已经通过验收的 proposal 施加若干种**确定性劣化**（`lib/mutate.ts`），
 * 每一种的正确排序先验已知（劣化版必须严格低于原版；插了无出处数值的必须触发 veto），
 * 然后每个变异体过一次 M9 judge，算**检出率**。零人工标注 —— 这是「human over the loop」
 * 约束下唯一可自动复算的 judge 灵敏度证据。
 *
 * ## 怎么读这张表
 *
 * - **检出率低 → 改 rubric，不是改 agent。** 这是 ch6「性能下降先查评估系统，再查 agent」
 *   的落点：judge 抓不住已知劣化时，M9 的分就只是「另一个模型的意见」，必须降权。
 * - **逆序（劣化反而加分）是长度偏置的直接证据**（`verbose-noinfo` 一字未增只是变长）。
 * - 一次校准是一次采样。judge 有随机性，单次结果不足以给 M9 定权重；结论要连同
 *   「这是 n=1 的一次采样」一起写。
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { ProposalSchema } from "#lib/contracts.ts";
import { escapeCell } from "../lib/mdTable.ts";
import { MUTATIONS, type MutantOutcome, detectionTable } from "../lib/mutate.ts";
import { REPO_ROOT } from "../lib/paths.ts";
import { isAllPass } from "../lib/runOutcome.ts";
import { RUBRIC_VERSION, buildJudgeRequest, parseScore, totalScore } from "../lib/scoring.ts";
import { JUDGE_MODEL_ID, JUDGE_THINKING, askJudge } from "./judgeClient.ts";

const arg = process.argv[2];
if (!arg) {
  console.error("usage: node scripts/calibrate-judge.ts runs/<ts>");
  process.exit(2);
}
const runDir = resolve(REPO_ROOT, arg);
const runId = basename(runDir);

const proposalPath = join(runDir, "proposal.json");
if (!existsSync(proposalPath)) {
  console.error(`[luup] ${proposalPath} 不存在。`);
  process.exit(2);
}
const parsedProposal = ProposalSchema.safeParse(JSON.parse(readFileSync(proposalPath, "utf8")));
if (!parsedProposal.success) {
  console.error("[luup] 原版 proposal 不合契约，不能当校准基线：");
  for (const i of parsedProposal.error.issues) console.error(`  - ${i.path.join(".")}: ${i.message}`);
  process.exit(2);
}
const baselineProposal = parsedProposal.data;

const reportPath = join(runDir, "verification-report.md");
const passed = existsSync(reportPath) && isAllPass(readFileSync(reportPath, "utf8"));
if (!passed) {
  // 不硬拦：负样本也可以当基线，但结论的含义变了 —— 必须在报告里写清楚
  console.warn(`[luup] 警告：${runId} 的独立验收不是 ALL PASS，用它当「原版」时检出率的先验不再成立。`);
}

const evidencePath = join(runDir, "evidence.md");
const evidenceMd = existsSync(evidencePath) ? readFileSync(evidencePath, "utf8") : "";

/** 跑一次 judge，返回加权分与 veto 位。解析失败即中止 —— 半张检出率表没有意义。 */
async function judge(label: string, proposalJson: string): Promise<{ weighted: number; veto: boolean; raw: string }> {
  const reply = await askJudge(buildJudgeRequest({ proposalJson, evidenceMd }), label);
  const parsed = parseScore(reply.text);
  if (!parsed.ok) {
    console.error(`[luup] ${label} 的 judge 输出无法解析：${parsed.error}`);
    console.error(reply.text.slice(0, 800));
    process.exit(1);
  }
  return { weighted: totalScore(parsed.score).weighted, veto: parsed.score.veto.triggered, raw: reply.text };
}

const baseline = await judge(`baseline ${runId}`, JSON.stringify(baselineProposal, null, 2));
console.log(`[M10] 原版：加权分 ${baseline.weighted}，veto ${baseline.veto ? "触发" : "未触发"}`);
if (baseline.veto) {
  console.warn("[luup] 警告：原版自己就触发了 veto —— veto 类变异体的检出率将无法区分「抓住了劣化」与「本来就在报警」。");
}

const outcomes: MutantOutcome[] = [];
for (const mut of MUTATIONS) {
  const mutated = mut.apply(baselineProposal);
  const r = await judge(`${mut.id}`, JSON.stringify(mutated, null, 2));
  outcomes.push({ id: mut.id, expect: mut.expect, weighted: r.weighted, veto: r.veto });
  console.log(
    `[M10] ${mut.id.padEnd(18)} 加权分 ${r.weighted}（Δ ${r.weighted - baseline.weighted}）` +
      `veto ${r.veto ? "触发" : "未触发"}`,
  );
}

const t = detectionTable({ weighted: baseline.weighted, veto: baseline.veto }, outcomes);
const labelOf = new Map(MUTATIONS.map((m) => [m.id, m]));

const table = (header: string[], rows: string[][]): string[] => [
  `| ${header.join(" | ")} |`,
  `| ${header.map(() => "---").join(" | ")} |`,
  ...rows.map((r) => `| ${r.map(escapeCell).join(" | ")} |`),
];

const md = [
  "# M10 judge 判别力校准（变异体检出率）",
  "",
  `原版 run：${runId}（独立验收 ${passed ? "ALL PASS" : "**未通过 —— 先验不成立，谨慎解读**"}）`,
  `rubric v${RUBRIC_VERSION}｜judge ${JUDGE_MODEL_ID}（thinking=${JUDGE_THINKING}）｜${new Date().toISOString()}`,
  "",
  `原版加权分 **${baseline.weighted}**，veto ${baseline.veto ? "⛔ 触发" : "未触发"}。`,
  "",
  "## 检出率",
  "",
  `**检出 ${t.detected} / ${t.judgeable} = ${t.detectionRate === null ? "—" : `${(t.detectionRate * 100).toFixed(1)}%`}**` +
    `｜逆序 ${t.inverted}｜判不了 ${t.inconclusive}（共 ${t.total} 个变异体）`,
  "",
  ...table(
    ["变异体", "劣化内容", "先验期望", "加权分", "Δ", "veto", "检出"],
    t.rows.map((r) => [
      r.id,
      labelOf.get(r.id)?.label ?? "",
      r.expect === "veto" ? "必须触发 veto" : "必须低于原版",
      String(r.weighted),
      r.delta > 0 ? `+${r.delta}` : String(r.delta),
      r.veto ? "⛔" : "—",
      r.inconclusive ? "⚪ 判不了" : r.detected ? "✅" : r.inverted ? "❌ 逆序" : "❌",
    ]),
  ),
  "",
  ...(t.inconclusive > 0
    ? [
        `> 判不了的 ${t.inconclusive} 行：**原版自己就触发了 veto**，于是「变异体也触发 veto」不携带信息。` +
          "它们退出检出率的分母 —— 算成检出是自欺，算成未检出是冤枉。" +
          "要让这一类重新可判，得先找一份 veto 未触发的原版，或者收紧 veto 锚点。",
        "",
      ]
    : []),
  "## 每个变异体在探测什么",
  "",
  ...MUTATIONS.map((m) => `- **${m.id}**（${m.label}）：${m.probes}`),
  "",
  "## 怎么读",
  "",
  "- 检出率低 → **改 rubric，不是改 agent**：judge 抓不住已知劣化时，M9 的分只是「另一个模型的意见」，必须降权。",
  "- 逆序（劣化反而加分）是长度偏置的直接证据。",
  "- 本表是 **n=1 的一次采样**：judge 有随机性，单次结果不足以给 M9 定权重。",
  "- judge 与被测 agent 同族（criteria D1 锁死百炼 Qwen），本校准**不能**消解同族自评偏置，",
  "  只能回答「judge 有没有在判事」。处置仍然是结构性降权：M9 永不进 gate。",
  "",
].join("\n");

const outPath = join(runDir, "calibration.md");
writeFileSync(outPath, `${md}\n`, "utf8");
console.log(
  `\n[M10] 检出 ${t.detected}/${t.judgeable}｜逆序 ${t.inverted}｜判不了 ${t.inconclusive}/${t.total} → ${outPath}`,
);
