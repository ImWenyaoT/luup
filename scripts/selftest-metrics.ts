/**
 * 评估体系自测（criteria H，零 API 调用）。
 *
 *   node scripts/selftest-metrics.ts
 *
 * 三段：
 *  1. **Tier1 对现有 runs/ 的可复算断言** —— 期望值是手算钉死的（见每条注释里的算式），
 *     不是「跑一遍把输出抄回来」。指标改了、口径漂了，这里必须先红。
 *  2. **M9 / M10 的纯函数部分** —— rubric 常量的形状、judge 输出解析、总分、
 *     题页事实行的防泄漏（H 节「只回传事实不回传分数」），以及变异体的确定性。
 *     judge 调用本身要花钱，不在这里跑（真跑见 scripts/score-run.ts）。
 *  3. **择优纯函数全分支** —— 字典序的每一级都要有一条断言分出胜负。
 *
 * 断言口径与其余五个 selftest 同一份（scripts/selftestHarness.ts）。
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Proposal } from "#lib/contracts.ts";
import {
  DEFAULT_PRICE_TABLE,
  aggregateUsage,
  costOf,
  deliveryRate,
  emptyTotals,
  groupByQuestion,
  libraryReuse,
  literatureMetrics,
  mcnemar,
  pairedComparison,
  parseUsageLines,
  passSquared,
  priceTableFromEnv,
  readAllRunMetrics,
  readRunMetrics,
  reworkMetrics,
} from "../lib/metrics.ts";
import { REPO_ROOT, RUNS_DIR } from "../lib/paths.ts";
import { readVerdictEvidence } from "../lib/rework.ts";
import {
  RUBRIC_VERSION,
  SCORE_DIMENSIONS,
  VETO_RULE,
  factNote,
  levelLabel,
  maxWeightedScore,
  parseScore,
  totalScore,
} from "../lib/scoring.ts";
import { MUTATIONS, detectionTable } from "../lib/mutate.ts";
import { VETO_ADVISORY, selectVersion } from "../lib/versionSelect.ts";
import { check, eq, report } from "./selftestHarness.ts";

/* ================================================================== */
/* 1. Tier1：对仓库现有 runs/ 的可复算断言                               */
/* ================================================================== */

console.log("\n[M4/M5] 交付率与 Pass^2（数据源：仓库现有 runs/）");

const all = readAllRunMetrics();
// 仓库现有 11 个 run 目录（20260808-054611 … 20260810-032527）；batch-*.md 与 index.json 不是 run
eq("扫到 11 个 run", all.length, 11);
check("run id 全部合法且倒序无关（升序排列）", all.every((r, i) => i === 0 || all[i - 1].id < r.id));

const byId = new Map(all.map((r) => [r.id, r]));
const m = (id: string) => byId.get(id)!;

// 终态判定不重写，直接复用 lib/runOutcome.ts —— 这里断言的是「指标层没有偷换判据」
eq("054611 未终结（只有 question.md + papers/）", m("20260808-054611").phase, "unsettled");
eq("055459 已渲染但验收未过", m("20260808-055459").phase, "rendered");
eq("093646 如实报失败", m("20260808-093646").phase, "failed");
// 100004 有 ALL PASS 报告却没有 proposal.md —— runOutcome 判 unsettled，交付率不许把它算进去
eq("100004 报告 ALL PASS 但无 proposal.md → unsettled", m("20260808-100004").phase, "unsettled");
check("100004 不可交付", !m("20260808-100004").deliverable);

// M4：deliverable 的是 062829 / 065103 / 071315 / 134046 / 20260810-032527 → 5/11
const dr = deliveryRate(all);
eq("M4 分子 = 5", dr.delivered, 5);
eq("M4 分母 = 11", dr.total, 11);
eq("M4 交付率 = 5/11", Number(dr.rate!.toFixed(4)), 0.4545);

// 耗时可信度：meta.json 两端都有才算实测；mtime 兜底会被一次 git checkout 刷成假数
check("134046 有 meta 起止时间", m("20260808-134046").metaTimed);
eq("134046 实测耗时 1135 秒（13:40:46 → 13:59:41）", m("20260808-134046").durationSec, 1135);
check("055459 没有 meta.json → 耗时不可信", !m("20260808-055459").metaTimed);
check("062829 是回填的 meta（起止同值 → 0 秒，不是真实墙钟）", m("20260808-062829").metaTimed);
eq("062829 回填耗时为 0", m("20260808-062829").durationSec, 0);

// M5：题号来自 meta.json（054611/055459/093646/100004/20260810-014001 无题号，不进配对）
const groups = groupByQuestion(all);
eq("有题号的题数 = 3（q54 / q61 / q125）", groups.size, 3);
eq("q61 有 4 个 run", groups.get(61)!.length, 4);
eq("q61 按时间序：062829 在前", groups.get(61)![0].id, "20260808-062829");
eq("q61 按时间序：20260810-032527 在后", groups.get(61)![3].id, "20260810-032527");

const p2 = passSquared(all);
// q61 四个 run → 3 个相邻对：(062829,134046)=✓✓、(134046,013424)=✓✗、(013424,032527)=✗✓
eq("M5 相邻对总数 = 3（q61 有 4 个 run）", p2.total, 3);
eq("M5 通过的相邻对 = 1", p2.passed, 1);
eq("M5 Pass^2 = 1/3", Number(p2.rate!.toFixed(4)), 0.3333);
eq("M5 那一对是 q61", p2.pairs[0].questionId, 61);

// 单 run 的题不产生相邻对（Pass^2 的分母是「对」不是「题」）
eq("q54 不产生相邻对", p2.pairs.filter((x) => x.questionId === 54).length, 0);

console.log("\n[M6] 成本会计（usage.jsonl）");

// 仓库里只有 20260808-134046 落了 usage.jsonl（124 行；其余 run 早于 teeUsage 修复）
const u = m("20260808-134046").usage;
eq("134046 调用数 = 124", u.all.calls, 124);
eq("134046 input tokens = 2253346", u.all.input, 2_253_346);
eq("134046 output tokens = 107045", u.all.output, 107_045);
eq("134046 total tokens = 2360391", u.all.total, 2_360_391);
eq("134046 reasoning tokens = 19371", u.all.reasoning, 19_371);
eq("134046 cached input = 1995648", u.all.cached, 1_995_648);
// 按 thinking 档分解：76 次开思考 / 48 次关思考（enable_thinking 由 model.ts 逐调用记录）
eq("thinking 档调用数 = 76", u.byTier.thinking.calls, 76);
eq("plain 档调用数 = 48", u.byTier.plain.calls, 48);
eq("thinking 档 total = 1823775", u.byTier.thinking.total, 1_823_775);
eq("plain 档 total = 536616", u.byTier.plain.total, 536_616);
eq("plain 档 reasoning = 0（关思考就该是 0）", u.byTier.plain.reasoning, 0);
eq("两档 total 相加 = 全量 total", u.byTier.thinking.total + u.byTier.plain.total, u.all.total);
check("没有 unknown 档", u.byTier.unknown.calls === 0);
check("没落 usage.jsonl 的 run 被标记出来", m("20260808-062829").usageMissing);
eq("没落 usage 的 run 计数为 0", m("20260808-062829").usage.all.calls, 0);

// 解析器：坏行跳过，不炸
const parsed = parseUsageLines(
  [
    '{"at":"2026-08-08T13:40:51.663Z","thinking":true,"usage":{"input_tokens":10,"output_tokens":4,"total_tokens":14,"output_tokens_details":{"reasoning_tokens":3},"input_tokens_details":{"cached_tokens":2}}}',
    "{ 这不是 JSON",
    '{"thinking":false,"usage":{"input_tokens":1,"output_tokens":1}}',
    "",
  ].join("\n"),
);
eq("坏行被跳过，剩 2 条", parsed.length, 2);
const agg = aggregateUsage(parsed);
eq("聚合 total 缺省时按 input+output 兜底", agg.all.total, 16);
eq("thinking 缺省不冒充 false", agg.byTier.plain.calls, 1);
eq("空聚合是零", aggregateUsage([]).all.total, emptyTotals().total);

// 单价表：默认未配置 → 成本为 null（不许拿编造的价格冒充 ¥/题）
eq("默认单价未配置", DEFAULT_PRICE_TABLE.inputPerMTok, null);
eq("未配置时成本为 null", costOf(u.all, DEFAULT_PRICE_TABLE), null);
const priced = priceTableFromEnv({
  LUUP_PRICE_INPUT_PER_MTOK: "2",
  LUUP_PRICE_OUTPUT_PER_MTOK: "20",
  LUUP_PRICE_CURRENCY: "CNY",
});
eq("env 配置 input 单价", priced.inputPerMTok, 2);
// 2253346/1e6*2 + 107045/1e6*20 = 4.506692 + 2.1409 = 6.647592
eq("成本按百万 token 计价", Number(costOf(u.all, priced)!.toFixed(6)), 6.647592);
eq("单价非法（负数）视为未配置", priceTableFromEnv({ LUUP_PRICE_INPUT_PER_MTOK: "-1" }).inputPerMTok, null);

console.log("\n[M7] 返工强度（verdicts/）");

// 134046：四节点各 1 轮全 pass；literature 有 1 份 schema 打回草稿
const r134 = m("20260808-134046").rework;
eq("134046 语义轮总数 = 4", r134.totalRounds, 4);
eq("134046 reject 数 = 0", r134.totalRejects, 0);
eq("134046 literature 格式重试 = 1", r134.formatRetries.literature, 1);
eq("134046 熔断节点 = 0 个", r134.circuitBroken.length, 0);
eq("134046 顶层工件打回 = 0（proposal.json.rejected.json 不存在）", m("20260808-134046").artifactDrafts, 0);

// 093646：proposal 连拒 2 轮后写 FAILED.md（熔断线是 3，所以没熔断 —— 这条是负样本对照）
const r093 = m("20260808-093646").rework;
eq("093646 proposal 轮数 = 2", r093.rounds.proposal, 2);
eq("093646 proposal reject 数 = 2", r093.rejects.proposal, 2);
eq("093646 连续 reject 未达熔断线", r093.circuitBroken.length, 0);
eq("093646 语义轮总数 = 5", r093.totalRounds, 5);
eq("093646 顶层工件打回 = 1（proposal.json.rejected.json）", m("20260808-093646").artifactDrafts, 1);

// 100004：proposal 跑了 2 轮但两轮都 pass —— 轮数多不等于被拒
const r100 = m("20260808-100004").rework;
eq("100004 proposal 轮数 = 2", r100.rounds.proposal, 2);
eq("100004 reject 数 = 0", r100.totalRejects, 0);

// 熔断判定不重写，走 lib/rework.ts 的 reworkBudget（同一份口径）
const broken = reworkMetrics({
  verdicts: [
    { file: "proposal-r1.json", node: "proposal", round: 1, verdict: "reject" },
    { file: "proposal-r2.json", node: "proposal", round: 2, verdict: "reject" },
    { file: "proposal-r3.json", node: "proposal", round: 3, verdict: "reject" },
  ],
  drafts: [],
});
eq("连拒 3 次判熔断", broken.circuitBroken.join(","), "proposal");
eq("熔断同时也耗尽轮数", broken.exhausted.join(","), "proposal");
eq("空证据 = 零返工", reworkMetrics({ verdicts: [], drafts: [] }).totalRounds, 0);

console.log("\n[M8] 文献健康度");

const l134 = m("20260808-134046").literature;
eq("134046 papers = 11", l134.papers, 11);
eq("134046 refs = 7", l134.refs, 7);
eq("134046 refs 全部在本 run papers/ 中（B1 的确定性口径）", l134.refsInPapers, 7);
eq("054611 无 proposal → refs = null", m("20260808-054611").literature.refs, null);
eq("054611 papers = 19", m("20260808-054611").literature.papers, 19);

// refs ⊄ papers 的负样本（虚构引用会在这里露头）
const lit = literatureMetrics({ paperIds: ["2401.00001", "2401.00002"], refIds: ["2401.00001", "9999.99999"] });
eq("命中 1 条", lit.refsInPapers, 1);
eq("命中率 0.5", lit.hitRate, 0.5);
eq("没有 refs 时命中率为 null", literatureMetrics({ paperIds: ["a"], refIds: null }).hitRate, null);

// 跨 run 复用：按 run id 升序，只数「更早的 run 里出现过」的
const reuse = libraryReuse(all);
eq("累计保存 133 次", reuse.totalSaves, 133);
eq("去重后 96 篇", reuse.distinct, 96);
eq("055459 复用 10 篇", reuse.perRun.find((x) => x.id === "20260808-055459")!.reusedFromEarlier, 10);
eq("093646 复用 8 篇", reuse.perRun.find((x) => x.id === "20260808-093646")!.reusedFromEarlier, 8);
eq("首个 run 复用 0 篇", reuse.perRun[0].reusedFromEarlier, 0);
// (133-96)/133 = 0.27819…
eq("复用率 = 37/133", Number(reuse.reuseRate!.toFixed(4)), 0.2782);

console.log("\n[M11] 配对比较（McNemar 精确二项）");

// 判读表的四行（来自 ch6 §3.2 M11）：全胜要 8 对不一致，出一个反例要涨到 ~10
eq("8:0 → p ≈ 0.0078", Number(mcnemar(8, 0).p.toFixed(4)), 0.0078);
eq("8:0 显著", mcnemar(8, 0).significant, true);
eq("7:1 → p ≈ 0.0703", Number(mcnemar(7, 1).p.toFixed(4)), 0.0703);
eq("7:1 不显著（别改）", mcnemar(7, 1).significant, false);
eq("9:1 → p ≈ 0.0215", Number(mcnemar(9, 1).p.toFixed(4)), 0.0215);
eq("10:2 → p ≈ 0.0386", Number(mcnemar(10, 2).p.toFixed(4)), 0.0386);
eq("0:0 无 discordant → p = 1", mcnemar(0, 0).p, 1);
check("0:0 不可判", !mcnemar(0, 0).significant);

// 仓库现状：只有 q61 有两版，且两版同为交付 → concordant，没有可判的 discordant
const paired = pairedComparison(all);
eq("可配对的题 = 1（q61）", paired.questions.length, 1);
eq("b（先失后过）= 0", paired.b, 0);
eq("c（先过后失）= 0", paired.c, 0);
eq("两版同为交付", paired.concordantPass, 1);
check("配对数据不足以判读", !paired.significant);

console.log("\n[Tier1] 临时 run 目录：指标不读 runs/ 之外的第二事实源");

const tmp = mkdtempSync(join(tmpdir(), "luup-metrics-"));
try {
  const dir = join(tmp, "20260101-000000");
  mkdirSync(join(dir, "verdicts"), { recursive: true });
  mkdirSync(join(dir, "memory", "papers"), { recursive: true });
  writeFileSync(join(dir, "question.md"), "来源：《Science》125 前沿科学问题 第 7 题，Biology。\n\n问题：X\n");
  writeFileSync(join(dir, "proposal.md"), "# t\n");
  writeFileSync(join(dir, "verification-report.md"), "# 验收报告\n\n结果: ALL PASS\n");
  writeFileSync(
    join(dir, "proposal.json"),
    JSON.stringify({ references: [{ arxivId: "2401.00001" }, { arxivId: "2401.00009" }] }),
  );
  writeFileSync(join(dir, "memory", "papers", "2401.00001.md"), "x");
  writeFileSync(join(dir, "verdicts", "literature-r1.json"), JSON.stringify({ node: "literature", round: 1, verdict: "pass" }));
  writeFileSync(join(dir, "verdicts", "hypothesis-r1.json.rejected.json"), "{}");
  const one = readRunMetrics(dir);
  eq("题号可从 question.md 兜底（meta.json 缺失）", one.questionId, 7);
  check("ALL PASS + proposal.md → 可交付", one.deliverable);
  eq("refs = 2", one.literature.refs, 2);
  eq("refs 只有 1 条落在 papers/", one.literature.refsInPapers, 1);
  eq("格式重试算在 hypothesis 头上", one.rework.formatRetries.hypothesis, 1);
  eq("verdict 证据与 readVerdictEvidence 同源", readVerdictEvidence(join(dir, "verdicts")).verdicts.length, 1);
  eq("没有 score.json → 未评分（不是 0 分）", one.score, null);

  // score.json 是 Tier2 落盘的诊断分，Tier1 只搬运不判定
  writeFileSync(
    join(dir, "score.json"),
    JSON.stringify({ weighted: 19, max: 24, percent: 79.2, rubricVersion: "1.0.0", veto: { triggered: true } }),
  );
  const scored = readRunMetrics(dir);
  eq("搬运加权分", scored.score!.weighted, 19);
  eq("搬运 veto 位", scored.score!.veto, true);
  eq("搬运 rubric 版本", scored.score!.rubricVersion, "1.0.0");
  check("M9 分不改变交付判定（分数不进 gate）", scored.deliverable === one.deliverable);

  writeFileSync(join(dir, "score.json"), "{ 写坏了");
  eq("score.json 写坏 = 未评分，不是 0 分", readRunMetrics(dir).score, null);
  writeFileSync(join(dir, "score.json"), JSON.stringify({ weighted: 19 }));
  eq("缺 veto 位 = 未评分（不许半信半疑）", readRunMetrics(dir).score, null);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

/* ================================================================== */
/* 2. M9 / M10：schema、解析、防泄漏、变异体                             */
/* ================================================================== */

console.log("\n[M9] 红线：rubric 文本不得出现在 agent 可见面（防 Goodhart）");

/**
 * criteria H 的硬约束：judge 的评分标准一旦被被测系统看见，它优化的就是标准而不是质量。
 * 这条红线靠人自觉守不住 —— 有人往 instructions 里贴一句「注意假设要可证伪、要写清阈值」
 * 就破了，而且不会有任何报错。所以在这里逐字扫 agent/ 全树。
 */
const agentFiles: string[] = [];
const walkAgent = (dir: string) => {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) walkAgent(p);
    else if (ent.isFile() && /\.(ts|md|json)$/.test(ent.name)) agentFiles.push(p);
  }
};
walkAgent(join(REPO_ROOT, "agent"));
check(`扫到 agent/ 下 ${agentFiles.length} 个文件`, agentFiles.length > 0);

const agentText = agentFiles.map((f) => readFileSync(f, "utf8")).join("\n");
const leaked = (needle: string) => agentFiles.filter((f) => readFileSync(f, "utf8").includes(needle));

for (const d of SCORE_DIMENSIONS) {
  check(`维度名「${d.label}」没进 agent/`, !agentText.includes(d.label), leaked(d.label).join(", "));
  for (const [i, anchor] of d.levels.entries()) {
    // 锚点整句太长不易撞车，取前 16 字做指纹：贴一半进 prompt 也算泄漏
    const fingerprint = anchor.slice(0, 16);
    check(`${d.id} 第 ${i + 1} 级锚点没进 agent/`, !agentText.includes(fingerprint), leaked(fingerprint).join(", "));
  }
}
check("veto 条款没进 agent/", !agentText.includes(VETO_RULE.description.slice(0, 20)));
check("agent/ 不 import 打分模块", !/lib\/(scoring|mutate)\.ts/.test(agentText));
check(
  "rubric 只被评估脚本 import（score-run / calibrate-judge / selftest-metrics）",
  ["score-run.ts", "calibrate-judge.ts", "selftest-metrics.ts", "stats.ts"].some((f) =>
    readFileSync(join(REPO_ROOT, "scripts", f), "utf8").includes("scoring.ts"),
  ),
);

console.log("\n[M9] rubric 常量与 judge 输出解析");

eq("四个维度", SCORE_DIMENSIONS.length, 4);
eq(
  "维度 id 固定（score.json 的键，改了就与历史分不可比）",
  SCORE_DIMENSIONS.map((d) => d.id).join(","),
  "falsifiability,coherence,actionability,evidence",
);
check("每个维度四级锚点", SCORE_DIMENSIONS.every((d) => d.levels.length === 4));
check("每个锚点都是可验证行为（不含「体现了深刻理解」这类抽象话）", SCORE_DIMENSIONS.every((d) => d.levels.every((l) => l.length >= 10)));
check("rubric 版本号非空", RUBRIC_VERSION.length > 0);
// essential 2 分 × 2 + important 1 分 × 2，满级 4 → 24
eq("加权满分 = 24", maxWeightedScore(), 24);
eq("4 级标签", levelLabel(4), "Excellent");

const good = parseScore(`一些前言，模型爱写。
\`\`\`json
{
  "dimensions": {
    "falsifiability": { "level": 4, "claims": [{ "quote": "若 X > 3σ 则否证", "attribution": "supported", "note": "可判定阈值" }] },
    "coherence": { "level": 3, "claims": [] },
    "actionability": { "level": 3, "claims": [] },
    "evidence": { "level": 2, "claims": [{ "quote": "效率提升 40%", "attribution": "unsourced", "note": "无出处" }] }
  },
  "veto": { "triggered": false, "claims": [] }
}
\`\`\`
后记`);
check("从围栏代码块里取出 JSON", good.ok);
if (good.ok) {
  eq("四维分被解析", good.score.dimensions.falsifiability.level, 4);
  eq("断言归因被保留", good.score.dimensions.evidence.claims[0].attribution, "unsourced");
  // (4+3)*2 + (3+2)*1 = 14+5 = 19 → 19/24 = 79.17
  eq("加权总分", totalScore(good.score).weighted, 19);
  eq("百分制", totalScore(good.score).percent, 79.2);
  check("未触发 veto", !good.score.veto.triggered);
}

const bad = parseScore("{ 我就是不给 JSON }");
check("解析失败要显式返回错误，不许静默给 0 分", !bad.ok);
const missing = parseScore('{"dimensions":{"falsifiability":{"level":4,"claims":[]}},"veto":{"triggered":false,"claims":[]}}');
check("缺维度 = 解析失败（不许补默认分）", !missing.ok);
const outOfRange = parseScore(
  '{"dimensions":{"falsifiability":{"level":9,"claims":[]},"coherence":{"level":1,"claims":[]},"actionability":{"level":1,"claims":[]},"evidence":{"level":1,"claims":[]}},"veto":{"triggered":false,"claims":[]}}',
);
check("越界档位 = 解析失败", !outOfRange.ok);

const vetoed = parseScore(
  '{"dimensions":{"falsifiability":{"level":4,"claims":[]},"coherence":{"level":4,"claims":[]},"actionability":{"level":4,"claims":[]},"evidence":{"level":4,"claims":[]}},"veto":{"triggered":true,"claims":[{"quote":"该方法准确率达 97.3%","attribution":"unsourced","note":"正文无出处"}]}}',
);
check("veto 位可被解析", vetoed.ok && vetoed.score.veto.triggered);
if (vetoed.ok) eq("满级也照样能 veto（veto 与质量正交）", totalScore(vetoed.score).weighted, 24);

console.log("\n[M9] 题页事实行：只回传事实，不回传分数（H 节防 Goodhart）");

const note = factNote({
  runId: "20260808-134046",
  winningTitle: "Constraining Pulsar Formation Channels",
  claims: [{ quote: "双通道诞生率之比可由 SNR 计数否证", attribution: "supported", note: "" }],
  veto: { triggered: false, claims: [] },
});
check("事实行含胜出假设", note.includes("Constraining Pulsar Formation Channels"));
check("事实行含关键断言原文", note.includes("双通道诞生率之比可由 SNR 计数否证"));
check("事实行不含分数/档位字样", !/(总分|percent|level|档|\bscore\b)/i.test(note));
check("事实行不含任何 rubric 维度名", SCORE_DIMENSIONS.every((d) => !note.includes(d.label)));
const vetoNote = factNote({
  runId: "r",
  winningTitle: "T",
  claims: [],
  veto: { triggered: true, claims: [{ quote: "准确率 97.3%", attribution: "unsourced", note: "" }] },
});
check("veto 作为事实回传（无出处断言原文）", vetoNote.includes("准确率 97.3%"));
check("veto 事实行仍不含分数", !/(总分|\bscore\b)/i.test(vetoNote));

console.log("\n[M10] 变异体：确定性、可复算、先验标签已知");

const base: Proposal = {
  problemStatement: "A".repeat(60),
  rationale: "由于恒星塌缩率与观测计数不符，因此推断存在第二通道。该推断依赖诞生率守恒。" + "B".repeat(40),
  technicalDetails: "使用 X 望远镜与 Y 流水线。" + "C".repeat(40),
  datasets: { source: "ATNF 脉冲星星表全量历史记录", target: "SKA 未来三年新增脉冲星计时数据" },
  paperTitle: "A Falsifiable Two-Channel Test",
  paperAbstract: "D".repeat(160),
  methods: "E".repeat(120),
  experiments: {
    baselines: ["Faucher-Giguère & Kaspi (2006) 群体合成", "Gullón et al. (2014)"],
    metrics: ["KS 检验 p 值", "诞生率之比的 68% 置信区间宽度"],
    design: "F".repeat(60),
  },
  results: "G".repeat(120),
  references: [
    { arxivId: "2401.00001", title: "T1", authors: ["A B"], year: 2024, relevance: "支撑诞生率守恒的观测约束" },
    { arxivId: "2401.00002", title: "T2", authors: ["C D"], year: 2024, relevance: "给出第二通道的理论上界" },
    { arxivId: "2401.00003", title: "T3", authors: ["E F"], year: 2024, relevance: "提供基线群体合成实现" },
    { arxivId: "2401.00004", title: "T4", authors: ["G H"], year: 2024, relevance: "提供 SKA 计时灵敏度估计" },
    { arxivId: "2401.00005", title: "T5", authors: ["I J"], year: 2024, relevance: "提供 KS 检验在该场景的先例" },
  ],
};

eq("变异体 ≥5 种", MUTATIONS.length >= 5, true);
check("变异体 id 唯一", new Set(MUTATIONS.map((x) => x.id)).size === MUTATIONS.length);
check("每个变异体都带先验期望（lower / veto）", MUTATIONS.every((x) => x.expect === "lower" || x.expect === "veto"));
for (const mut of MUTATIONS) {
  const a = JSON.stringify(mut.apply(base));
  const b = JSON.stringify(mut.apply(base));
  eq(`变异体 ${mut.id} 确定性（两次施加同结果）`, a, b);
  check(`变异体 ${mut.id} 确实改动了 proposal`, a !== JSON.stringify(base));
}
eq("原 proposal 未被就地改写", base.rationale.includes("由于恒星塌缩率"), true);

const padded = MUTATIONS.find((x) => x.id === "verbose-noinfo")!.apply(base);
check("加长零信息：正文更长", padded.rationale.length > base.rationale.length);
const stripped = MUTATIONS.find((x) => x.id === "strip-derivation")!.apply(base);
check("删推导链：连接词句被删", !stripped.rationale.includes("因此"));
const numbered = MUTATIONS.find((x) => x.id === "unsourced-number")!.apply(base);
check("插无出处数值：正文出现具体数值", /\d+(\.\d+)?%/.test(numbered.results));
const swapped = MUTATIONS.find((x) => x.id === "swap-fields")!.apply(base);
eq("字段互换：methods 变成原 technicalDetails", swapped.methods, base.technicalDetails);
eq("字段互换：technicalDetails 变成原 methods", swapped.technicalDetails, base.methods);
const bland = MUTATIONS.find((x) => x.id === "bland-relevance")!.apply(base);
check("引用 relevance 置空话", bland.references.every((r) => r.relevance === bland.references[0].relevance));
check("空话 relevance 与原文不同", bland.references[0].relevance !== base.references[0].relevance);

console.log("\n[M9] score-run 只接受确定性可交付 run");

const scoreTmp = mkdtempSync(join(tmpdir(), "luup-score-run-"));
try {
  const scoreRunDir = join(scoreTmp, "20260101-000001");
  mkdirSync(scoreRunDir, { recursive: true });
  writeFileSync(join(scoreRunDir, "proposal.json"), `${JSON.stringify(base)}\n`);
  writeFileSync(join(scoreRunDir, "proposal.md"), "# 尚未通过独立验收\n");
  writeFileSync(
    join(scoreRunDir, "meta.json"),
    `${JSON.stringify({ questionId: 61, startedAt: "2026-01-01T00:00:01.000Z", finishedAt: "2026-01-01T00:00:02.000Z", exitCode: 0 })}\n`,
  );
  const childEnv = { ...process.env };
  delete childEnv.QWEN_API_KEY;
  delete childEnv.QWEN_BASE_URL;
  const scoredBeforeGate = spawnSync("node", ["scripts/score-run.ts", scoreRunDir], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: childEnv,
  });
  eq("未通过 ALL PASS 的 run 被 score-run 拒绝", scoredBeforeGate.status, 2);
  check("拒绝原因指向确定性交付 gate", scoredBeforeGate.stderr.includes("不可交付"), scoredBeforeGate.stderr);
  check("拒绝发生在 judge 调用前", !scoredBeforeGate.stderr.includes("缺 QWEN_API_KEY"), scoredBeforeGate.stderr);
  check("拒绝后不落 score.json", !readdirSync(scoreRunDir).includes("score.json"));
} finally {
  rmSync(scoreTmp, { recursive: true, force: true });
}

// 检出率表：lower 看是否低于 baseline，veto 看是否触发
const table = detectionTable(
  { weighted: 20, veto: false },
  [
    { id: "verbose-noinfo", expect: "lower", weighted: 22, veto: false }, // 逆序：加长反而更高
    { id: "strip-derivation", expect: "lower", weighted: 14, veto: false }, // 检出
    { id: "unsourced-number", expect: "veto", weighted: 18, veto: true }, // 检出
    { id: "swap-fields", expect: "lower", weighted: 20, veto: false }, // 平手，未检出
    { id: "bland-relevance", expect: "lower", weighted: 11, veto: false }, // 检出
  ],
);
eq("检出 3 个", table.detected, 3);
eq("总数 5", table.total, 5);
eq("可判 5 个（原版未 veto）", table.judgeable, 5);
eq("检出率 0.6", table.detectionRate, 0.6);
eq("逆序 1 个（加长反而加分 = 长度偏置）", table.inverted, 1);
eq("veto 命中 1/1", `${table.vetoHit}/${table.vetoExpected}`, "1/1");
check("逐条结论可读", table.rows.find((r) => r.id === "swap-fields")!.detected === false);

// 原版自己就 veto 时，veto 类变异体判不了 —— 退出分母，不冒充 100%
const confounded = detectionTable(
  { weighted: 20, veto: true },
  [
    { id: "strip-derivation", expect: "lower", weighted: 14, veto: true },
    { id: "unsourced-number", expect: "veto", weighted: 20, veto: true },
    { id: "swap-fields", expect: "lower", weighted: 20, veto: true },
  ],
);
eq("判不了 1 行", confounded.inconclusive, 1);
eq("分母退到 2", confounded.judgeable, 2);
eq("检出 1 个（只有 strip-derivation）", confounded.detected, 1);
eq("检出率 0.5，不是 2/3", confounded.detectionRate, 0.5);
check("判不了的行不算检出", !confounded.rows.find((r) => r.id === "unsourced-number")!.detected);
check("判不了的行被标出来", confounded.rows.find((r) => r.id === "unsourced-number")!.inconclusive);
eq("全部判不了时检出率为 null", detectionTable({ weighted: 1, veto: true }, [
  { id: "unsourced-number", expect: "veto", weighted: 1, veto: true },
]).detectionRate, null);

/* ================================================================== */
/* 3. 择优纯函数：字典序每一级都要有断言                                  */
/* ================================================================== */

console.log("\n[择优] 版本择优纯函数（gate → M9 → refs → token）");

const cand = (
  runId: string,
  o: Partial<{ deliverable: boolean; veto: boolean; score: number | null; refs: number | null; tokens: number | null }> = {},
) => ({
  runId,
  deliverable: o.deliverable ?? true,
  veto: o.veto ?? false,
  score: o.score ?? null,
  rubricVersion: "1.0.0",
  judgeModel: "qwen",
  refs: o.refs ?? null,
  tokens: o.tokens ?? null,
});

const trustedCalibration = [
  "rubric v1.0.0｜judge qwen（thinking=true）",
  "**检出 3 / 4 = 75.0%**｜逆序 0｜判不了 0（共 4 个变异体）",
].join("\n");

eq("空候选无胜者", selectVersion([]).winner, null);
eq("空候选的理由说清是空", selectVersion([]).reason, "没有候选版本");

const gate = selectVersion([cand("a", { deliverable: false, score: 99 }), cand("b", { score: 1 })]);
eq("gate 先过滤：不可交付的高分版出局", gate.winner!.runId, "b");
eq("出局理由写明", gate.eliminated[0].reason, "未通过交付 gate（runOutcome 判定不可交付）");
eq("gate 层分出胜负", gate.reason, "唯一通过 gate 的版本");

/* master 裁决 2026-08-09：M9 veto 降为 advisory —— 只记录不出局。
   依据是 criteria H 的预先原则（gate 全确定性）+ 本仓库 M10 实测（检出 0/4，
   judge 自噪声带 20/21/22 宽于变异体效应量 −2…+1）。 */
const vetoed2 = selectVersion([cand("a", { veto: true, score: 99 }), cand("b", { score: 1 })]);
eq("veto 不出局：高分 veto 版照样胜出", vetoed2.winner!.runId, "a");
eq("veto 版没有被算作出局", vetoed2.eliminated.length, 0);
eq("veto 记成 advisory", vetoed2.advisories[0].runId, "a");
eq("advisory 文案单点", vetoed2.advisories[0].note, VETO_ADVISORY);
check("advisory 不含「出局」「gate」字样", !/出局|gate/.test(vetoed2.advisories[0].note));

const bothVetoed = selectVersion(
  [cand("a", { veto: true, score: 10 }), cand("b", { veto: true, score: 20 })],
  { calibrationReports: [trustedCalibration] },
);
eq("两版都 veto 仍要选出胜者（不再退化成「无胜者」）", bothVetoed.winner!.runId, "b");
eq("两条 advisory 都记下来", bothVetoed.advisories.length, 2);
eq("胜者本身带 veto 也照样是胜者", bothVetoed.winner!.veto, true);

const vetoIrrelevant = selectVersion([cand("a", { veto: true, score: 10, refs: 7, tokens: 1 }), cand("b", { veto: false, score: 10, refs: 7, tokens: 1 })]);
eq("veto 不参与 tie-break（全平时仍按 run id）", vetoIrrelevant.winner!.runId, "a");

const allOut = selectVersion([cand("a", { deliverable: false }), cand("b", { deliverable: false, veto: true })]);
eq("只有确定性 gate 能让人全部出局", allOut.winner, null);
eq("全部出局的理由", allOut.reason, "没有版本通过交付 gate");
eq("出局的都是不可交付，与 veto 无关", allOut.eliminated.length, 2);
eq("出局者不进 advisories", allOut.advisories.length, 0);

const byScore = selectVersion([cand("a", { score: 12, refs: 99, tokens: 1 }), cand("b", { score: 18, refs: 5, tokens: 9 })]);
eq("校准策略缺省不信任 M9：refs 更多者胜", byScore.winner!.runId, "a");
eq("未达校准阈值时理由不提 M9", byScore.reason, "M9 未达校准阈值，refs 更多");

const calibratedByScore = selectVersion(
  [cand("a", { score: 12, refs: 99, tokens: 1 }), cand("b", { score: 18, refs: 5, tokens: 9 })],
  { calibrationReports: [trustedCalibration] },
);
eq("明确通过校准策略后 M9 才参与排序", calibratedByScore.winner!.runId, "b");
eq("通过校准策略后的理由", calibratedByScore.reason, "M9 总分更高");

const scoredBeatsUnscored = selectVersion([cand("a", { score: null, refs: 99 }), cand("b", { score: 1 })]);
eq("校准不合格时已评分版没有特权", scoredBeatsUnscored.winner!.runId, "a");

const byRefs = selectVersion(
  [cand("a", { score: 10, refs: 6, tokens: 1 }), cand("b", { score: 10, refs: 9, tokens: 9 })],
  { calibrationReports: [trustedCalibration] },
);
eq("第 3 级：分数平手比 refs", byRefs.winner!.runId, "b");
eq("第 3 级理由", byRefs.reason, "M9 总分持平，refs 更多");

const byTokens = selectVersion(
  [cand("a", { score: 10, refs: 7, tokens: 900 }), cand("b", { score: 10, refs: 7, tokens: 100 })],
  { calibrationReports: [trustedCalibration] },
);
eq("第 4 级：refs 也平手比 token（升序）", byTokens.winner!.runId, "b");
eq("第 4 级理由", byTokens.reason, "M9 总分与 refs 持平，token 成本更低");
const unknownTokens = selectVersion(
  [cand("a", { score: 10, refs: 7, tokens: null }), cand("b", { score: 10, refs: 7, tokens: 100 })],
  { calibrationReports: [trustedCalibration] },
);
eq("token 未知者不得靠「没数据」取胜", unknownTokens.winner!.runId, "b");

const tie = selectVersion([cand("z", { score: 10, refs: 7, tokens: 100 }), cand("a", { score: 10, refs: 7, tokens: 100 })]);
eq("全同 → 取 run id 更小者（确定性，不靠输入顺序）", tie.winner!.runId, "a");
eq("全同的理由", tie.reason, "各级全部持平，按 run id 取最早的一版");
eq("落败版本不删，全部进 ranked", tie.ranked.length, 2);

const stable = selectVersion([cand("a", { score: 10, refs: 7, tokens: 100 }), cand("z", { score: 10, refs: 7, tokens: 100 })]);
eq("输入顺序反过来结论不变", stable.winner!.runId, "a");

/* 与真实数据接：q61 四个 run —— 三个可交付版本（062829 / 134046 / 20260810-032527）
   都跑过 M9、**都报了 veto**；另有一个 FAILED run（20260810-013424，不可交付）。
   veto 降为 advisory 之后不出局；唯一的出局理由只能是 deliverable=false。 */
const q61 = groups.get(61)!;
const realCands = q61.map((r) => ({
  runId: r.id,
  deliverable: r.deliverable,
  veto: r.score?.veto ?? false,
  score: r.score?.weighted ?? null,
  rubricVersion: r.score?.rubricVersion ?? null,
  judgeModel: r.score?.judgeModel ?? null,
  refs: r.literature.refs,
  tokens: r.usageMissing ? null : r.usage.all.total,
}));
eq("q61 三个可交付版本都跑过 M9", realCands.filter((c) => c.score !== null).length, 3);
eq("q61 三个评过分的版本都报了 veto", realCands.filter((c) => c.veto).length, 3);
const actualCalibrations = q61
  .map((r) => {
    try {
      return readFileSync(join(RUNS_DIR, r.id, "calibration.md"), "utf8");
    } catch {
      return null;
    }
  })
  .filter((x): x is string => x !== null);
check("q61 有真实 calibration.md 证据", actualCalibrations.length > 0);
const realChoice = selectVersion(realCands, { calibrationReports: actualCalibrations });
eq("q61 的真实校准未授权 M9，胜者落到 token 层", realChoice.winner!.runId, "20260808-134046");
eq("q61 择优理由披露 M9 未达阈值", realChoice.reason, "M9 未达校准阈值，refs 持平，token 成本更低");
check("胜者自己带着 veto 标志，但那只是诊断", realChoice.winner!.veto);
eq("三版的 veto 都进 advisories", realChoice.advisories.length, 3);
eq("唯一出局者是 FAILED run（因不可交付，绝不因 veto）", realChoice.eliminated.length, 1);
eq("出局的是 20260810-013424", realChoice.eliminated[0]?.runId, "20260810-013424");

// 只看 Tier1（不接 M9）时胜者相同，但分出胜负的层次不同 —— 两条路都要留住
const tier1Only = selectVersion(realCands.map((c) => ({ ...c, score: null, veto: false })));
eq("只看 Tier1 时 q61 落到 token 层", tier1Only.reason, "M9 未达校准阈值，refs 持平，token 成本更低");
eq("只看 Tier1 时胜者仍是 134046", tier1Only.winner!.runId, "20260808-134046");

check("RUNS_DIR 指向本仓库 runs/", RUNS_DIR.endsWith("/runs"));

report("selftest-metrics");
