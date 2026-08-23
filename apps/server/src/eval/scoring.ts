/** 结构化评分：给一个已跑完的 Run 打分，纯代码判定。
 *
 * 六分制评分器参考《深入理解 AI Agent》第 6 章，改成科研版。和那份参考实现一样，
 * **不需要金标答案、不调用任何模型**：每一项都是从 SQLite 里读事实再做集合判断，
 * 同一个库跑一百次结果完全一样。这是「过程指标为主」的主体 —— 它回答的不是
 * 「研究计划写得好不好」（那要 LLM-judge 加人工校准），而是「这个 Harness 有没有
 * 按设计动作执行」：有没有用该用的工具、参数是不是改写过、写出来的东西能不能追回冻结证据。
 *
 * 满分 5 分，外加一条一票否决：
 *
 * | 项 | 分 | 判定 |
 * | --- | --- | --- |
 * | 工具选择 | 1 | researcher 是否同时用过 arXiv 与另一个来源（crossref/web） |
 * | 参数质量 | 1 | arXiv query 经过改写（≠ 研究问题原文）且轮次 ≥ 2 |
 * | 证据可追溯 | 2 | references ⊆ 冻结 URL（1 分）+ 实验项出处全部指向冻结证据（1 分） |
 * | 流程完整性 | 1 | 五阶段 artifact 齐全且 review accepted |
 * | **Grounding** | **veto** | 计划里出现任何不在冻结证据白名单内的 URL / evidence_id → 总分归零 |
 *
 *     bun src/eval/scoring.ts \
 *       --db outputs/science-125-06-q96/attempt-5-passed.db --out outputs/scoring.md
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";

import { resolveManifestRunScope, type ManifestRunScope } from "../batch/manifest-scope.ts";

export const MAX_SCORE = 5;

/** 一个 Run 走完全程应当留下的五种 Artifact。 */
export const PIPELINE_ARTIFACT_TYPES = [
  "research",
  "hypothesis",
  "evidence-review",
  "research-plan",
  "review",
] as const;

/** 「多轮检索」的门槛：至少两次 arXiv 检索。低于这个数说明 researcher 只查了一次就收工。 */
export const MIN_ARXIV_ROUNDS = 2;

/** 非 arXiv 的那一路来源。
 *
 * 判据本身没变 ——「工具权限给了两路来源，模型是不是真的都用上了」；变的只是这一路叫什么：
 * Python 版跑批时它是 Qwen Responses 的 `web_search`，现在是 Crossref。那个名字已经
 * 读不到了 —— 本函数只读 TS 期的 SQLite 库，Python 期的目录制证据不在这条路径上。
 */
const SECONDARY_SOURCE_TOOLS = new Set(["crossref_search"]);

const ARXIV_TOOL = "arxiv_search";

type JsonObject = Record<string, unknown>;
type Row = Record<string, unknown>;

/** 把 URL 归一化成可比较的形式；不是绝对 HTTP(S) 地址就返回 null。
 *
 * 规则（小写 scheme/host、去掉末尾斜杠、丢掉 fragment）与 agent 侧生产路径用的那一份
 * 保持一致。这里**故意重写一遍而不是 import**：评估模块是离线只读的分析工具，让它反向
 * 依赖生产 Agent 代码，会导致改 agent 就可能改掉历史跑批的评分口径 —— 评分口径必须比
 * 被评的代码更稳定。规则一共几行，重复的代价远小于这个耦合。
 */
export function normalizeUrl(value: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (!parsed.host) return null;
  return `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/+$/, "")}${parsed.search}`;
}

/** 折叠空白并转小写，用来判断两段文本是不是「同一句话」。
 *
 * 按任意空白切分再丢掉空串，等价于 Python 的无参 `str.split()`；`split(" ")` 不等价。
 */
export function normalizeText(value: string): string {
  return value.split(/\s+/).filter(Boolean).join(" ").toLowerCase();
}

function asDict(value: unknown): JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonObject) : {};
}

function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** 取一个必然存在的文本列。
 *
 * Python 里 `row["question"]` 取不到列会当场抛；JS 的 `row.question` 只会得到 undefined
 * 然后一路静默传进报告里，所以缺列必须在这里显式炸掉。
 */
function textColumn(row: Row, column: string): string {
  const value = row[column];
  if (typeof value !== "string") {
    throw new Error(`列 ${column} 不是文本：${String(value)}`);
  }
  return value;
}

/** 一个 Run 里所有打分需要的原始事实，先一次性读出来再打分。
 *
 * 先收集事实、再判分，是为了让每条评分规则都变成一个只读结构的纯函数：
 * 规则能单独测，测试只要手工造一个 RunFacts，不必造一整个数据库。
 */
export type RunFacts = {
  readonly runId: string;
  readonly question: string;
  readonly status: string;
  readonly toolNames: ReadonlySet<string>;
  readonly arxivQueries: readonly string[];
  readonly evidenceIds: ReadonlySet<string>;
  readonly evidenceUrls: ReadonlySet<string>;
  readonly artifactTypes: ReadonlySet<string>;
  readonly plan: JsonObject;
  readonly review: JsonObject;
};

/** 一个 Run 的评分结果。`total()` 已经把一票否决算进去了。 */
export type RunScore = {
  readonly runId: string;
  readonly question: string;
  readonly status: string;
  readonly toolSelection: number;
  readonly parameterQuality: number;
  readonly evidenceTraceable: number;
  readonly processComplete: number;
  readonly vetoed: boolean;
  readonly vetoReasons: readonly string[];
};

/** 未被否决时的得分。留着它是为了能看出「扣的是分还是被一票否决」。 */
export function rawTotal(score: RunScore): number {
  return score.toolSelection + score.parameterQuality + score.evidenceTraceable + score.processComplete;
}

export function total(score: RunScore): number {
  return score.vetoed ? 0 : rawTotal(score);
}

// --- 从 SQLite 读事实 ---------------------------------------------------

/** 计划里所有「带出处的实验项」，即 baselines 与 metrics 的并集。
 *
 * 旧契约是 `baselines: string[]` 外加一张独立的 `experiment_grounding` 对照表，靠逐字
 * 匹配把名字和证据接起来；新契约把 evidence_id 绑进了每一项自身（见 contracts.ts 的
 * groundedItemSchema），所以这里直接读每项自带的 evidence_id，对照表连同它的匹配逻辑一起没了。
 */
function groundedItems(plan: JsonObject): { field: string; evidenceId: unknown }[] {
  const experiments = asDict(plan.experiments);
  const items: { field: string; evidenceId: unknown }[] = [];
  for (const field of ["baselines", "metrics"]) {
    for (const item of asList(experiments[field])) {
      items.push({ field, evidenceId: asDict(item).evidence_id });
    }
  }
  return items;
}

/** 把一个 Run 的打分素材从 5 张表里捞出来，组装成一个 RunFacts。 */
export function collectRunFacts(db: DatabaseSync, runId: string): RunFacts {
  const runRow = db.prepare("SELECT id, question, status FROM runs WHERE id = ?").get(runId) as Row | undefined;
  if (runRow === undefined) throw new Error(`run not found: ${runId}`);

  // tool_evidence 只挂 attempt，所以这一层 JOIN 还得留着；attempt 自己带 run_id，
  // 原来那道 `JOIN tasks` 随 tasks 表一起没了。
  const evidenceRows = db
    .prepare(
      `SELECT te.id, te.tool_name, te.query, te.output_json
     FROM tool_evidence AS te
     JOIN attempts AS a ON a.id = te.attempt_id
     WHERE a.run_id = ?`,
    )
    .all(runId) as Row[];

  const toolNames = new Set<string>();
  const arxivQueries: string[] = [];
  const evidenceIds = new Set<string>();
  const evidenceUrls = new Set<string>();
  for (const row of evidenceRows) {
    evidenceIds.add(textColumn(row, "id"));
    const toolName = textColumn(row, "tool_name");
    toolNames.add(toolName);
    if (toolName === ARXIV_TOOL) arxivQueries.push(textColumn(row, "query"));
    const payload = asDict(JSON.parse(textColumn(row, "output_json")));
    // 白名单要覆盖「模型可能照抄的每一个 URL」，少收一个会把合法引用误判成幻觉。
    // recordEvidence 只写 {source_type, result_summary, citations}，所以收 citations 就够。
    for (const item of asList(payload.citations)) {
      const rawUrl = asDict(item).url;
      if (typeof rawUrl !== "string") continue;
      const normalized = normalizeUrl(rawUrl);
      if (normalized !== null) evidenceUrls.add(normalized);
    }
  }

  // artifacts 直接带 run_id，JOIN 去掉。时间戳只有毫秒精度，同毫秒的多条会并列，
  // 所以补一个 rowid 兜底，保证「后写的覆盖先写的」这条依赖顺序的规则是确定的。
  const artifactRows = db
    .prepare("SELECT type, content_json FROM artifacts WHERE run_id = ? ORDER BY created_at, rowid")
    .all(runId) as Row[];

  const artifactTypes = new Set<string>();
  let plan: JsonObject = {};
  let review: JsonObject = {};
  for (const row of artifactRows) {
    const artifactType = textColumn(row, "type");
    artifactTypes.add(artifactType);
    // 一个 Run 可能有两份 research-plan（被 Reviewer 打回后的修订版）。
    // 按 created_at 升序遍历、后写覆盖前写，留下的就是最终那一份。
    if (artifactType === "research-plan") {
      plan = asDict(JSON.parse(textColumn(row, "content_json")));
    } else if (artifactType === "review") {
      review = asDict(JSON.parse(textColumn(row, "content_json")));
    }
  }

  return {
    runId: textColumn(runRow, "id"),
    question: textColumn(runRow, "question"),
    status: textColumn(runRow, "status"),
    toolNames,
    arxivQueries,
    evidenceIds,
    evidenceUrls,
    artifactTypes,
    plan,
    review,
  };
}

// --- 五条评分规则 -------------------------------------------------------

/** 1 分：researcher 是否同时用过两路检索来源。
 *
 * 只用其中一个也能产出看起来完整的计划，但证据来源就单一了。这条测的是
 * 「工具权限给了两个，模型是不是真的都用上了」。
 */
export function scoreToolSelection(facts: RunFacts): number {
  if (!facts.toolNames.has(ARXIV_TOOL)) return 0;
  for (const tool of facts.toolNames) {
    if (SECONDARY_SOURCE_TOOLS.has(tool)) return 1;
  }
  return 0;
}

/** 1 分：arXiv query 经过改写，且检索轮次 ≥ 2。
 *
 * 把研究问题原文（"What Is the Universe Made Of?"）直接拼成 `all:{question}` 丢给
 * arXiv，是检索质量最差的一种写法 —— 它等于没做查询规划。两个条件必须同时满足：
 * 改写了但只查一次，说明没有按缺口迭代；查了多次但每次都用原题，说明只是重复同一个错误。
 */
export function scoreParameterQuality(facts: RunFacts): number {
  if (facts.arxivQueries.length < MIN_ARXIV_ROUNDS) return 0;
  const question = normalizeText(facts.question);
  for (const query of facts.arxivQueries) {
    if (normalizeText(query) === question) return 0;
  }
  return 1;
}

/** 2 分：参考文献可追溯（1 分）+ 实验出处可追溯（1 分）。
 *
 * 第一分看 `references` 是不是全都落在冻结证据的 URL 白名单里。
 * 第二分看每个比较基线与测量指标是不是都绑着一条冻结证据。计划里一条实验项都没写，
 * 这一分就拿不到，这是有意的：没有出处保证的计划不该看起来和有保证的一样好。
 */
export function scoreEvidenceTraceable(facts: RunFacts): number {
  let score = 0;

  const normalizedReferences: string[] = [];
  for (const reference of asList(facts.plan.references)) {
    if (typeof reference !== "string") continue;
    const normalized = normalizeUrl(reference);
    if (normalized !== null) normalizedReferences.push(normalized);
  }
  if (normalizedReferences.length > 0 && normalizedReferences.every((item) => facts.evidenceUrls.has(item))) {
    score += 1;
  }

  const grounding = groundedItems(facts.plan);
  if (grounding.length > 0) {
    const allBound = grounding.every(
      (item) => typeof item.evidenceId === "string" && facts.evidenceIds.has(item.evidenceId),
    );
    if (allBound) score += 1;
  }

  return score;
}

/** 1 分：五阶段 artifact 齐全，且 review 的结论是 accepted。
 *
 * 只有在 reviewer 没有硬编码后门时这一分才有意义 —— 若 accepted 是代码强制写上去的，
 * 这条规则测的会是「代码有没有执行那行赋值」，而不是「计划有没有过审」。
 */
export function scoreProcessComplete(facts: RunFacts): number {
  for (const artifactType of PIPELINE_ARTIFACT_TYPES) {
    if (!facts.artifactTypes.has(artifactType)) return 0;
  }
  if (facts.review.accepted !== true) return 0;
  return 1;
}

/** 一票否决：计划里引用了任何不在冻结证据白名单内的 URL 或 evidence_id。
 *
 * 这是整个评分里唯一一条「触发即总分归零」的规则，因为它对应的失败模式是幻觉引用：
 * 一个引了不存在文献的计划，工具用得再全、流程走得再完整也是废的，按比例扣分会让
 * 它在均分上仍然显得体面。返回原因列表而不是布尔值，是为了让报告能直接指出问题在哪。
 */
export function findVetoReasons(facts: RunFacts): string[] {
  const reasons: string[] = [];

  for (const reference of asList(facts.plan.references)) {
    if (typeof reference !== "string") {
      reasons.push("references 里有非字符串条目");
      continue;
    }
    const normalized = normalizeUrl(reference);
    if (normalized === null) {
      reasons.push(`references 里有非法 URL：${reference}`);
    } else if (!facts.evidenceUrls.has(normalized)) {
      reasons.push(`references 引用了未冻结的 URL：${normalized}`);
    }
  }

  for (const item of groundedItems(facts.plan)) {
    if (typeof item.evidenceId !== "string" || !facts.evidenceIds.has(item.evidenceId)) {
      reasons.push(`experiments.${item.field} 引用了未冻结的证据：${String(item.evidenceId)}`);
    }
  }

  for (const evidenceId of asList(facts.plan.verification_evidence_ids)) {
    if (typeof evidenceId !== "string" || !facts.evidenceIds.has(evidenceId)) {
      reasons.push(`verification_evidence_ids 引用了未冻结的证据：${String(evidenceId)}`);
    }
  }

  return reasons;
}

/** 把五条规则跑一遍，组装成一条评分记录。 */
export function scoreRun(facts: RunFacts): RunScore {
  const vetoReasons = findVetoReasons(facts);
  return {
    runId: facts.runId,
    question: facts.question,
    status: facts.status,
    toolSelection: scoreToolSelection(facts),
    parameterQuality: scoreParameterQuality(facts),
    evidenceTraceable: scoreEvidenceTraceable(facts),
    processComplete: scoreProcessComplete(facts),
    vetoed: vetoReasons.length > 0,
    vetoReasons,
  };
}

export type ScoringManifestScope = {
  manifest_id: string;
  included_run_count: number;
  excluded_db_run_count: number;
  excluded_db_run_ids: string[];
};

function manifestScopeReport(scope: ManifestRunScope): ScoringManifestScope {
  return {
    manifest_id: scope.manifestId,
    included_run_count: scope.includedRunIds.length,
    excluded_db_run_count: scope.excludedDbRunIds.length,
    excluded_db_run_ids: [...scope.excludedDbRunIds],
  };
}

/** 给库里每一个 Run 打分。只读打开，绝不会写到被评的库。 */
export function loadRunScoresWithScope(
  dbPath: string,
  manifestId?: string,
): { scores: RunScore[]; scope?: ScoringManifestScope } {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const scope = manifestId === undefined ? undefined : resolveManifestRunScope(db, manifestId);
    const runIds = (db.prepare("SELECT id FROM runs ORDER BY created_at, rowid").all() as Row[]).map((row) =>
      textColumn(row, "id"),
    );
    const scopedRunIds = scope === undefined ? runIds : runIds.filter((runId) => scope.includedRunIds.includes(runId));
    return {
      scores: scopedRunIds.map((runId) => scoreRun(collectRunFacts(db, runId))),
      ...(scope === undefined ? {} : { scope: manifestScopeReport(scope) }),
    };
  } finally {
    db.close();
  }
}

export function loadRunScores(dbPath: string, manifestId?: string): RunScore[] {
  return loadRunScoresWithScope(dbPath, manifestId).scores;
}

// --- Markdown 报告 ------------------------------------------------------

/** 一组 Run 的汇总。分母是 `count`，不是全库 Run 数。 */
export type ScoreSummary = {
  readonly label: string;
  readonly count: number;
  readonly meanScore: number | null;
  readonly vetoed: number;
  readonly toolSelection: number;
  readonly parameterQuality: number;
  readonly evidenceTraceable: number;
  readonly processComplete: number;
};

function sumBy(scores: readonly RunScore[], pick: (score: RunScore) => number): number {
  return scores.reduce((acc, item) => acc + pick(item), 0);
}

export function summarize(scores: readonly RunScore[], label: string): ScoreSummary {
  const count = scores.length;
  const totalScore = sumBy(scores, total);
  return {
    label,
    count,
    meanScore: count ? totalScore / count : null,
    vetoed: scores.filter((item) => item.vetoed).length,
    toolSelection: sumBy(scores, (item) => item.toolSelection),
    parameterQuality: sumBy(scores, (item) => item.parameterQuality),
    evidenceTraceable: sumBy(scores, (item) => item.evidenceTraceable),
    processComplete: sumBy(scores, (item) => item.processComplete),
  };
}

function summaryRows(summary: ScoreSummary): string[] {
  const count = summary.count;
  const pct = (value: number, full: number) => (full === 0 ? "N/A" : `${((value / full) * 100).toFixed(1)}%`);
  return [
    `| 工具选择 | 1 | ${summary.toolSelection} | ${pct(summary.toolSelection, count)} |`,
    `| 参数质量 | 1 | ${summary.parameterQuality} | ${pct(summary.parameterQuality, count)} |`,
    `| 证据可追溯 | 2 | ${summary.evidenceTraceable} | ${pct(summary.evidenceTraceable, count * 2)} |`,
    `| 流程完整性 | 1 | ${summary.processComplete} | ${pct(summary.processComplete, count)} |`,
    `| Grounding 否决 | veto | ${summary.vetoed} | ${pct(summary.vetoed, count)} |`,
  ];
}

export function renderMarkdown(scores: readonly RunScore[], dbPath: string, scope?: ScoringManifestScope): string {
  const generatedAt = new Date().toISOString();
  const completed = scores.filter((item) => item.status === "completed");

  const lines = [
    "# 结构化评分报告",
    "",
    `- 生成时间（UTC）：${generatedAt}`,
    `- 数据源：单个跑批库 ${basename(dbPath)}`,
    `- 满分：${MAX_SCORE} 分/Run（Grounding 一票否决不占分，触发即归零）`,
    `- Run 总数：${scores.length}（其中 completed ${completed.length}）`,
    ...(scope === undefined
      ? []
      : [
          `- Manifest：\`${scope.manifest_id}\`；纳入 Run：${scope.included_run_count}；排除的 DB Run：${scope.excluded_db_run_count}`,
          scope.excluded_db_run_count === 0
            ? "- 排除的 DB Run IDs：无"
            : `- 排除的 DB Run IDs：${scope.excluded_db_run_ids.join("、")}`,
        ]),
    "",
    "全部判定由代码从 SQLite 读事实完成，不调用任何模型、不需要金标答案。",
    "",
    // 这条限制必须印在报告正文里，不能只留在代码注释中。交付文档会跨批次取每题最好的
    // 一次，那是为了让评委读到系统产出过的最好方案；评分不能这么干 —— 跨批次挑最好
    // 就是 best-of-N，会把过程指标抬到系统单次跑根本达不到的水平。
    "评分只读**一个**跑批库，不跨批次合并：跨批次取每题最好的一次是 best-of-N，" +
      "会让过程指标高于系统单次跑批的真实水平。下面的数字来自这一个库的一次跑批。",
    "",
  ];

  for (const group of [summarize(scores, "全部 Run"), summarize(completed, "仅 completed Run")]) {
    lines.push(
      `## ${group.label}`,
      "",
      `- 样本数：${group.count}`,
      `- 平均分：${group.meanScore === null ? "N/A" : group.meanScore.toFixed(2)} / ${MAX_SCORE}`,
      `- 被一票否决：${group.vetoed}`,
      "",
      "| 项 | 满分 | 得分合计 | 通过率 |",
      "| --- | ---: | ---: | ---: |",
      ...summaryRows(group),
      "",
    );
  }

  lines.push(
    "## 逐 Run 明细",
    "",
    "| Run | 状态 | 工具 | 参数 | 证据 | 流程 | 否决 | 总分 |",
    "| --- | --- | ---: | ---: | ---: | ---: | :---: | ---: |",
  );
  for (const item of scores) {
    lines.push(
      `| ${item.runId.slice(0, 8)} | ${item.status} | ${item.toolSelection} | ` +
        `${item.parameterQuality} | ${item.evidenceTraceable} | ` +
        `${item.processComplete} | ${item.vetoed ? "是" : "否"} | ${total(item)} |`,
    );
  }
  lines.push("");

  const vetoed = scores.filter((item) => item.vetoed);
  if (vetoed.length > 0) {
    lines.push("## 被否决的 Run 及原因", "");
    for (const item of vetoed) {
      lines.push(`- \`${item.runId}\` ${item.question}`);
      for (const reason of item.vetoReasons) lines.push(`  - ${reason}`);
    }
    lines.push("");
  }

  return `${lines.join("\n").replace(/\s+$/, "")}\n`;
}

export function exportScoringMarkdown(dbPath: string, outputPath: string, manifestId?: string): void {
  const loaded = loadRunScoresWithScope(dbPath, manifestId);
  const markdown = renderMarkdown(loaded.scores, dbPath, loaded.scope);
  mkdirSync(dirname(resolve(outputPath)), { recursive: true });
  writeFileSync(outputPath, markdown, "utf8");
}

function main(): void {
  const { values } = parseArgs({
    options: { db: { type: "string" }, out: { type: "string" }, "manifest-id": { type: "string" } },
  });
  // argparse 的 required=True 缺参数就退出；parseArgs 只会给出 undefined，所以自己挡。
  if (!values.db || !values.out) {
    console.error("用法：scoring.ts --db <runs.db> --out <report.md> [--manifest-id <id>]");
    process.exit(2);
  }
  exportScoringMarkdown(values.db, values.out, values["manifest-id"]);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === import.meta.filename) {
  main();
}
