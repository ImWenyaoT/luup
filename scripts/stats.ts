/**
 * Tier1 指标报告（criteria H）。**零 LLM 调用、零网络**。
 *
 *   pnpm stats                 # 扫全量 runs/，写 runs/stats.md 并打印到 stdout
 *   pnpm stats --json          # 同时把结构化结果打到 stdout（喂给别的脚本）
 *
 * 用在两个时刻：**战役批间**（每 10–20 题跑一次，决定下一轮改哪一个变量）与
 * **提交前**（连同 mvp-audit 的诚实披露体例一起进技术报告）。
 *
 * ## 报告纪律
 *
 * - 分母永远写清。「4/8」不许写成「50%」就完事，更不许拿 125 当分母 ——
 *   「还没跑」与「跑了没交付」是两件事（ch6 L90 要求报告写明 k 的语义）。
 * - 没有数据就写「—」，不用 0 冒充。usage.jsonl 缺失的 run 在成本表里是「未记录」，
 *   不是「0 token」。
 * - **M9 分只搬运，不产生。** 本脚本一次模型调用都不发：分数是从各 run 的 `score.json`
 *   读进来的（`pnpm score` 落盘）。没跑过评分的题，择优就落在 refs / token 层，理由原样打出来。
 *   M10 校准另有脚本（`pnpm calibrate`）。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { escapeCell } from "../lib/mdTable.ts";
import {
  DEFAULT_PRICE_TABLE,
  NODE_LABEL,
  type RunMetrics,
  aggregateUsage,
  costOf,
  deliveryRate,
  groupByQuestion,
  libraryReuse,
  pairedComparison,
  parseUsageLines,
  passSquared,
  priceTableFromEnv,
  readAllRunMetrics,
} from "../lib/metrics.ts";
import { EVAL_DIR, RUNS_STATS_FILE } from "../lib/paths.ts";
import { REWORK_CAPS, REWORK_NODES } from "../lib/rework.ts";
import { selectVersion } from "../lib/versionSelect.ts";

const DASH = "—";

/**
 * M9 在本报告里的**统一称谓**（master 裁决 2026-08-09）。分数与 veto 一律以「诊断」出现，
 * 不以「成绩」「不合格」出现 —— 措辞就是权限声明，一处写成「未通过」，读的人就会拿它当 gate 用。
 * 校准数字硬编在这里而不是现算：它来自一次真实的 M10 跑（见各 run 的 calibration.md），
 * 重跑校准后要顺手改这两个常量，别让报告替一个没做过的实验背书。
 */
const CALIBRATION_DETECTED = 0;
const CALIBRATION_JUDGEABLE = 4;
const M9_CAPTION = `诊断分（同族 judge，M10 校准检出 ${CALIBRATION_DETECTED}/${CALIBRATION_JUDGEABLE}，结构性降权；不进 gate）`;

const readTextOrNull = (path: string): string | null => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
};
const num = (n: number | null | undefined): string => (n === null || n === undefined ? DASH : n.toLocaleString("en-US"));
const pct = (r: number | null): string => (r === null ? DASH : `${(r * 100).toFixed(1)}%`);
const money = (v: number | null, currency: string): string => (v === null ? DASH : `${currency} ${v.toFixed(2)}`);

const table = (header: string[], rows: string[][]): string[] => [
  `| ${header.join(" | ")} |`,
  `| ${header.map(() => "---").join(" | ")} |`,
  ...rows.map((r) => `| ${r.map(escapeCell).join(" | ")} |`),
];

const runs = readAllRunMetrics();
const price = priceTableFromEnv();
const out: string[] = [];

out.push("# luup Tier1 指标报告");
out.push("");
out.push(`生成时间：${new Date().toISOString()}`);
out.push("");
out.push(
  "数据源只有既有工件（runOutcome / verdicts / usage.jsonl / meta.json / memory/papers / score.json），" +
    "**本脚本零新增采集、零 LLM 调用**。M9 分是从 `score.json` 搬进来的（`pnpm score` 产生），" +
    "M10 判别力校准另见各 run 的 `calibration.md`（`pnpm calibrate` 产生）。",
);
out.push("");

if (runs.length === 0) {
  out.push("> runs/ 下没有任何 run 目录，无可计算。");
} else {
  /* ---------------- M4 ---------------- */
  const dr = deliveryRate(runs);
  out.push("## M4 交付率");
  out.push("");
  out.push(`**${dr.delivered} / ${dr.total} = ${pct(dr.rate)}**（分母是已跑的 run 数，不是 125 题）`);
  out.push("");
  out.push(
    ...table(
      ["run", "题号", "终态", "可交付", "耗时", "refs"],
      runs.map((r) => [
        r.id,
        r.questionId === null ? DASH : `Q${r.questionId}`,
        r.phase,
        r.deliverable ? "✅" : "❌",
        // 只采信 meta.json 两端都有的耗时：mtime 兜底会被一次 git checkout 刷成假数
        !r.metaTimed || r.durationSec === null ? DASH : `${Math.round(r.durationSec / 60)} min`,
        num(r.literature.refs),
      ]),
    ),
  );
  out.push("");
  const untimed = runs.filter((r) => !r.metaTimed);
  if (untimed.length > 0) {
    out.push(
      `> 披露：${untimed.length} 个 run 的耗时显示「—」—— meta.json 缺起止时间，只能靠文件 mtime 兜底，` +
        "而一次 git checkout 就会把 mtime 刷成「现在」。宁可不出数，也不出一个看起来像实测的假数。",
    );
    out.push("");
  }
  const backfilled = runs.filter((r) => r.metaTimed && r.durationSec === 0);
  if (backfilled.length > 0) {
    out.push(
      `> 披露：${backfilled.map((r) => r.id).join(", ")} 的耗时为 0 —— 它们的 meta.json 是 ` +
        "`scripts/rebuild-memory.ts` 事后回填的（`backfilled: true`），起止时间同值，不是真实墙钟。",
    );
    out.push("");
  }
  const noQuestionId = runs.filter((r) => r.questionId === null);
  if (noQuestionId.length > 0) {
    out.push(
      `> 披露：${noQuestionId.length} 个 run 没有题号（meta.json 与 question.md 都认不出 Science-125 题号），` +
        `不参与 M5 / 择优 / 配对比较：${noQuestionId.map((r) => r.id).join(", ")}。`,
    );
    out.push("");
  }

  /* ---------------- M5 ---------------- */
  const p2 = passSquared(runs);
  out.push("## M5 Pass^2（同题相邻两次是否都交付）");
  out.push("");
  out.push(
    p2.total === 0
      ? "**没有可判的相邻对** —— 每题都只跑过一次。Pass^2 的分母是「同题相邻对」，不是「题」。"
      : `**${p2.passed} / ${p2.total} = ${pct(p2.rate)}**（分母是同题相邻对数：跑 1 次的题贡献 0 对，跑 3 次的题贡献 2 对）`,
  );
  out.push("");
  if (p2.total > 0) {
    out.push(
      ...table(
        ["题号", "较早 run", "较晚 run", "两次均交付"],
        p2.pairs.map((p) => [`Q${p.questionId}`, p.earlier, p.later, p.pass ? "✅" : "❌"]),
      ),
    );
    out.push("");
  }
  out.push("> M4 是覆盖（多少题交出来了），M5 是稳定（同一题再跑一次还成不成）。两者正交，不可混报。");
  out.push("");

  /* ---------------- M6 ---------------- */
  const withUsage = runs.filter((r) => !r.usageMissing);
  out.push("## M6 成本会计");
  out.push("");
  out.push(`单价表：${price.source}${price.inputPerMTok === null ? "（因此 ¥ 列为 —）" : ""}`);
  out.push("");
  out.push(
    ...table(
      ["run", "题号", "调用", "input", "output", "reasoning", "cached", "total", `成本（${price.currency}）`],
      runs.map((r) =>
        r.usageMissing
          ? [r.id, r.questionId === null ? DASH : `Q${r.questionId}`, "未记录", DASH, DASH, DASH, DASH, DASH, DASH]
          : [
              r.id,
              r.questionId === null ? DASH : `Q${r.questionId}`,
              num(r.usage.all.calls),
              num(r.usage.all.input),
              num(r.usage.all.output),
              num(r.usage.all.reasoning),
              num(r.usage.all.cached),
              num(r.usage.all.total),
              money(costOf(r.usage.all, price), price.currency),
            ],
      ),
    ),
  );
  out.push("");
  if (withUsage.length > 0) {
    out.push("按 thinking 档分解（`enable_thinking` 是唯一能真正关掉推理的开关，token 放大约 7×）：");
    out.push("");
    out.push(
      ...table(
        ["run", "档", "调用", "input", "output", "reasoning", "reasoning/output"],
        withUsage.flatMap((r) =>
          (["thinking", "plain", "unknown"] as const)
            .filter((tier) => r.usage.byTier[tier].calls > 0)
            .map((tier) => {
              const t = r.usage.byTier[tier];
              return [
                r.id,
                tier,
                num(t.calls),
                num(t.input),
                num(t.output),
                num(t.reasoning),
                t.output === 0 ? DASH : pct(t.reasoning / t.output),
              ];
            }),
        ),
      ),
    );
    out.push("");
    const totals = withUsage.reduce((a, r) => a + r.usage.all.total, 0);
    out.push(
      `已记录用量的 run：${withUsage.length} / ${runs.length}，合计 ${num(totals)} token，` +
        `均值 ${num(Math.round(totals / withUsage.length))} token/run。`,
    );
    out.push("");
  }
  if (withUsage.length < runs.length) {
    out.push(
      `> 披露：${runs.length - withUsage.length} 个 run 没有 usage.jsonl（teeUsage 的 run 目录解析修复之前跑的），` +
        "它们在成本表里是「未记录」而不是 0 —— 拿 0 参与均值会把 token/题算低。",
    );
    out.push("");
  }
  // 评估层自己的开销单独记账（judge 调用落在 runs/.eval/，不混进任何被评估 run）
  const evalUsage = aggregateUsage(parseUsageLines(readTextOrNull(join(EVAL_DIR, "usage.jsonl"))));
  if (evalUsage.all.calls > 0) {
    out.push(
      `评估层自身开销（M9/M10 的 judge 调用，落在 \`runs/.eval/usage.jsonl\`）：` +
        `${num(evalUsage.all.calls)} 次调用、${num(evalUsage.all.total)} token` +
        `（其中 reasoning ${num(evalUsage.all.reasoning)}），成本 ${money(costOf(evalUsage.all, price), price.currency)}。` +
        "它**不计入**上表任何一行 —— 评估开销与被评估开销混账，M6 立刻失真。",
    );
    out.push("");
  }
  if (price.inputPerMTok === null) {
    out.push(
      `> 披露：¥/题 未出数，因为仓库里没有可引用的百炼报价单。要出数请设 ` +
        "`LUUP_PRICE_INPUT_PER_MTOK` / `LUUP_PRICE_OUTPUT_PER_MTOK`，并在技术报告里写清出处与查询日期。" +
        "编一个单价填进去，会让「全量 125 题跑不跑得起」这个决定建立在假数上。",
    );
    out.push("");
  }

  /* ---------------- M7 ---------------- */
  out.push("## M7 返工强度");
  out.push("");
  out.push(
    `上限（判定在 \`lib/rework.ts\`，不在提示词）：每节点 ≤${REWORK_CAPS.maxRounds} 轮语义 verdict，` +
      `同节点连续 ${REWORK_CAPS.consecutiveRejects} 次 reject 熔断。`,
  );
  out.push("");
  out.push(
    ...table(
      ["run", ...REWORK_NODES.map((n) => NODE_LABEL[n]), "总轮数", "reject", "格式重试", "工件打回", "熔断"],
      runs.map((r) => [
        r.id,
        ...REWORK_NODES.map((n) => `${r.rework.rounds[n]}${r.rework.rejects[n] > 0 ? ` (拒${r.rework.rejects[n]})` : ""}`),
        String(r.rework.totalRounds),
        String(r.rework.totalRejects),
        String(r.rework.totalFormatRetries),
        String(r.artifactDrafts),
        r.rework.circuitBroken.length > 0 ? r.rework.circuitBroken.join(",") : "—",
      ]),
    ),
  );
  out.push("");
  const totalRounds = runs.reduce((a, r) => a + r.rework.totalRounds, 0);
  const totalRejects = runs.reduce((a, r) => a + r.rework.totalRejects, 0);
  const totalFormat = runs.reduce((a, r) => a + r.rework.totalFormatRetries, 0);
  const brokenRuns = runs.filter((r) => r.rework.circuitBroken.length > 0).length;
  out.push(
    `合计：${totalRounds} 轮语义 verdict，其中 reject ${totalRejects} 次（返工率 ` +
      `${pct(totalRounds === 0 ? null : totalRejects / totalRounds)}）；` +
      `格式重试 ${totalFormat} 次（${pct(totalRounds === 0 ? null : totalFormat / totalRounds)}）；` +
      `熔断 ${brokenRuns} / ${runs.length} 个 run（${pct(runs.length === 0 ? null : brokenRuns / runs.length)}）。`,
  );
  out.push("");
  out.push(
    "> 「一次过」与「靠反复打回硬凑出来的过」终态相同，只有这张表能分开。" +
      "基线不是人类专家步数，是本 harness 自己的历史分布。",
  );
  out.push("");

  /* ---------------- M8 ---------------- */
  const reuse = libraryReuse(runs);
  out.push("## M8 文献健康度");
  out.push("");
  out.push(
    ...table(
      ["run", "papers", "refs", "refs∈papers", "命中率", "复用自更早 run"],
      runs.map((r, i) => [
        r.id,
        String(r.literature.papers),
        num(r.literature.refs),
        num(r.literature.refsInPapers),
        pct(r.literature.hitRate),
        String(reuse.perRun[i].reusedFromEarlier),
      ]),
    ),
  );
  out.push("");
  out.push(
    `累计保存 ${reuse.totalSaves} 次 / 去重 ${reuse.distinct} 篇 → 跨 run 复用率 ${pct(reuse.reuseRate)}。`,
  );
  out.push("");
  const shortRefs = runs.filter((r) => r.literature.refs !== null && r.literature.refs < 5);
  const missRefs = runs.filter((r) => r.literature.hitRate !== null && r.literature.hitRate < 1);
  if (shortRefs.length > 0) {
    out.push(`> 告警：${shortRefs.map((r) => r.id).join(", ")} 的 refs < 5（criteria B3 下限）。`);
    out.push("");
  }
  if (missRefs.length > 0) {
    out.push(
      `> 告警：${missRefs.map((r) => r.id).join(", ")} 存在不在本 run papers/ 里的引用（criteria B1 的确定性口径）。`,
    );
    out.push("");
  }
  out.push("> 命中率与复用率是**先行**指标：学科覆盖差的题会先在这里露头，再在交付率上露头。");
  out.push("");

  /* ---------------- M9 搬运（诊断分，不是成绩栏） ---------------- */
  const scored = runs.filter((r) => r.score !== null);
  out.push(`## M9 ${M9_CAPTION}`);
  out.push("");
  if (scored.length === 0) {
    out.push("还没有任何 run 跑过 `pnpm score`。择优因此只能落到 refs / token 层。");
    out.push("");
  } else {
    out.push(
      ...table(
        ["run", "题号", "加权分", "百分制", "⚠ M9 诊断", "rubric"],
        scored.map((r) => [
          r.id,
          r.questionId === null ? DASH : `Q${r.questionId}`,
          `${r.score!.weighted}/${r.score!.max}`,
          `${r.score!.percent}%`,
          r.score!.veto ? "⚠ 虚构类断言 veto" : DASH,
          `v${r.score!.rubricVersion}`,
        ]),
      ),
    );
    out.push("");
    const versions = new Set(scored.map((r) => r.score!.rubricVersion));
    if (versions.size > 1) {
      out.push(`> 告警：混用了 ${versions.size} 个 rubric 版本（${[...versions].join(", ")}），跨版本的分不可比，请重跑评分。`);
      out.push("");
    }
    out.push(
      "> **这一栏永远不进 gate、不进技术报告的「成绩」栏，veto 也不例外。** judge 与被测 agent 同族" +
        "（criteria D1 锁死百炼 Qwen），同族自评偏置无法用换族 judge 消解；" +
        `本仓库的 M10 实测更直接：**检出 ${CALIBRATION_DETECTED}/${CALIBRATION_JUDGEABLE}**，` +
        "同一份 proposal 三次采样得分 20/21/22，而变异体效应量落在 −2…+1 —— judge 的自噪声带比它要测的差异还宽。" +
        "据此 master 于 2026-08-09 裁决：M9 总分只做 tie-break，**veto 从 gate 降为 advisory**（只记录不出局）。",
    );
    out.push("");
    out.push("> ⚠ 列是**诊断线索**，不是不合格判定：它指出正文里哪些具体断言挂不到出处，供重跑时消费（题页 memory 已带原文）。");
    out.push("");
  }

  /* ---------------- 版本择优 ---------------- */
  const groups = groupByQuestion(runs);
  const multi = [...groups.entries()].filter(([, list]) => list.length > 1);
  out.push("## 版本择优（同题多版本）");
  out.push("");
  if (multi.length === 0) {
    out.push("没有跑过两次以上的题，无可择优。");
    out.push("");
  } else {
    const rows: string[][] = [];
    for (const [questionId, list] of multi) {
      const choice = selectVersion(
        list.map((r) => ({
          runId: r.id,
          deliverable: r.deliverable,
          // 分数从 score.json 搬进来（没跑过 pnpm score 就是 null，择优落到 refs / token 层）
          veto: r.score?.veto ?? false,
          score: r.score?.weighted ?? null,
          refs: r.literature.refs,
          tokens: r.usageMissing ? null : r.usage.all.total,
        })),
      );
      rows.push([
        `Q${questionId}`,
        list.map((r) => r.id).join(" → "),
        choice.winner?.runId ?? DASH,
        choice.reason,
        choice.advisories.length === 0 ? DASH : choice.advisories.map((a) => a.runId).join("、"),
        choice.eliminated.length === 0 ? DASH : choice.eliminated.map((e) => `${e.runId}：${e.reason}`).join("；"),
      ]);
    }
    out.push(...table(["题号", "候选（时间序）", "胜出", "理由", "⚠ M9 诊断", "出局"], rows));
    out.push("");
    const noWinner = rows.filter((r) => r[2] === DASH).map((r) => r[0]);
    if (noWinner.length > 0) {
      out.push(
        `> ${noWinner.join(", ")} **没有任何版本通过交付 gate** —— 不是脚本坏了，也与 M9 无关：` +
          "这几题当前没有一版被确定性验收器（A/B1–B4 + 终态判定）判为可交付。处置是重跑。",
      );
      out.push("");
    }
    const advised = rows.filter((r) => r[4] !== DASH);
    if (advised.length > 0) {
      out.push(
        "> ⚠ 列里的版本（含胜者）被 M9 报了虚构类断言 veto。**这不改变胜负** —— veto 是 advisory，" +
          "gate 只认确定性判据。它的用处是告诉你正文里哪些具体断言挂不到出处：" +
          "B1–B4 验的是「引用条目本身真不真」，veto 看的是「正文断言挂不挂得到出处」，两者可以一个过一个不过。" +
          "题页 memory 已带着无出处断言的原文，下一次重跑能直接消费。",
      );
      out.push("");
    }
    const mixed = multi.filter(([, list]) => list.some((r) => r.score !== null) && list.some((r) => r.score === null));
    if (mixed.length > 0) {
      out.push(
        `> 告警：${mixed.map(([q]) => `Q${q}`).join(", ")} 的候选里既有评过分的也有没评过的。` +
          "未评分的版本 score 为 null，在 tie-break 里一律排到已评分版本之后 —— " +
          "于是「谁赢」有可能只是「谁被评过」。择优前请把同题的候选全部跑一遍 `pnpm score`。",
      );
      out.push("");
    }
    out.push(
      "> 择优是纯函数（`lib/versionSelect.ts`），字典序：**交付 gate（只认确定性判据）** → M9 总分（tie-break）" +
        " → refs 数 → token 成本升序 → run id。没跑过 `pnpm score` 的版本 score 为 null，" +
        "排在所有已评分版本之后 ——「没测过」不是「测过且很好」。",
    );
    out.push("");
    out.push("> 落败版本不删：负结果是记忆的一部分，下次重跑要知道哪一版为什么没被选。");
    out.push("");
  }

  /* ---------------- M11 ---------------- */
  const paired = pairedComparison(runs);
  if (paired.questions.length > 0) {
    out.push("## M11 配对比较（McNemar 精确二项，双侧 α=0.05）");
    out.push("");
    out.push(
      ...table(
        ["题号", "较早 run", "较晚 run", "较早交付", "较晚交付"],
        paired.questions.map((q) => [
          `Q${q.questionId}`,
          q.earlier,
          q.later,
          q.earlierPass ? "✅" : "❌",
          q.laterPass ? "✅" : "❌",
        ]),
      ),
    );
    out.push("");
    out.push(
      `配对题数 ${paired.questions.length}；一致（都过）${paired.concordantPass}、一致（都不过）${paired.concordantFail}；` +
        `不一致 b=${paired.b}（先失后过）、c=${paired.c}（先过后失）→ p = ${paired.p.toFixed(4)}，` +
        `**${paired.significant ? "显著" : "不显著/不可判"}**。`,
    );
    out.push("");
    out.push("判读刻度（精确二项，双侧 α=0.05）：");
    out.push("");
    out.push(
      ...table(
        ["不一致对 b:c", "p", "结论"],
        [
          ["8:0", "0.0078", "显著"],
          ["7:1", "0.0703", "不显著（别改）"],
          ["9:1", "0.0215", "显著"],
          ["10:2", "0.0386", "显著"],
        ],
      ),
    );
    out.push("");
    out.push(
      "> 直觉：全胜时约需 8 对不一致才显著；出现 1 个反例就要涨到约 10 对。" +
        "只看不一致的对 —— 两版都过/都不过不携带「改动有没有效」的信息。",
    );
    out.push("");
    out.push(
      "> **口径警告**：仓库里的多版本是迭代产物，不是随机分臂的 A/B。" +
        "严格的 M11 要求一次只改一个变量、两臂题号相同；本表只能当作方向性读数。",
    );
    out.push("");
  }
}

const report = `${out.join("\n")}\n`;
writeFileSync(RUNS_STATS_FILE, report, "utf8");
process.stdout.write(report);
console.error(`\n[luup] 已写 ${RUNS_STATS_FILE}（${runs.length} 个 run）`);

if (process.argv.includes("--json")) {
  console.error(
    JSON.stringify(
      {
        delivery: deliveryRate(runs),
        passSquared: passSquared(runs),
        priceConfigured: price.inputPerMTok !== null && price.outputPerMTok !== null,
        priceSource: price.source === DEFAULT_PRICE_TABLE.source ? null : price.source,
        runs: runs.map((r: RunMetrics) => ({
          id: r.id,
          questionId: r.questionId,
          phase: r.phase,
          deliverable: r.deliverable,
          tokens: r.usageMissing ? null : r.usage.all.total,
          rounds: r.rework.totalRounds,
          rejects: r.rework.totalRejects,
          refs: r.literature.refs,
          papers: r.literature.papers,
        })),
      },
      null,
      2,
    ),
  );
}
