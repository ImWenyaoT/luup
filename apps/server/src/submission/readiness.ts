import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

import { DatabaseSync } from "node:sqlite";

import {
  buildBatchSubmissionIndexReadOnly,
  checkScience125BatchIndex,
  type BatchSubmissionIndex,
  type BatchSubmissionReadSource,
} from "../batch/submission-export.ts";
import { evaluateDatabase, renderMarkdown as renderMetricsMarkdown } from "../eval/metrics.ts";
import { loadRunScoresWithScope, renderMarkdown as renderScoringMarkdown, summarize } from "../eval/scoring.ts";
import {
  buildRepresentativeCase,
  checkRepresentativeCaseStrict,
  renderRepresentativeCaseMarkdown,
  type RepresentativeCaseExport,
  type RepresentativeCaseReadSource,
} from "./representative-case.ts";
import { buildUsageReport, renderUsageMarkdown, type UsagePricing, type UsageReport } from "./usage-export.ts";
import type { BatchRunFacts, StoredArtifact } from "../store/store.ts";
import type { BatchTerminalStatus, StoredBatchManifest } from "../batch/manifest.ts";
import type { DomainArtifact } from "../agent/contracts.ts";
import type { RunStatus } from "../store/schema.ts";
import { checkSubmissionFile } from "./checker.ts";

export const SUBMISSION_READINESS_FORMAT = "luup.submission-readiness" as const;
export const SUBMISSION_READINESS_VERSION = 1 as const;

export type ReadinessState = "pass" | "fail" | "unknown" | "manual";

export type ReadinessCheck = {
  name: string;
  state: ReadinessState;
  required: boolean;
  detail: string;
};

export type SubmissionReadinessReport = {
  format: typeof SUBMISSION_READINESS_FORMAT;
  version: typeof SUBMISSION_READINESS_VERSION;
  generated_at: string;
  status: "pass" | "fail";
  db_path: string;
  manifest_id: string;
  representative_run_id: string;
  checks: ReadinessCheck[];
  summary: Record<ReadinessState, number>;
  artifacts: Record<string, string>;
};

export type SubmissionReadinessOptions = {
  dbPath: string;
  manifestId: string;
  representativeRunId: string;
  outputDir: string;
  generatedAt?: string;
  pricing?: UsagePricing;
  submissionFile?: string;
  registrationEvidencePath?: string;
  qwenEvidencePath?: string;
  publicApi?: string;
  publicWebui?: string;
  projectInfoPath?: string;
  qwenDescriptionPath?: string;
};

type ReadinessDocuments = {
  report: SubmissionReadinessReport;
  files: Map<string, string>;
};

type RawRow = Record<string, unknown>;

/**
 * Offline, read-only control plane for the submission package.
 *
 * The normal SqliteStore is intentionally not used here: opening it may settle
 * an old running Run. Readiness must inspect the exact database that will be
 * submitted and must not repair it as a side effect.
 */
export function buildSubmissionReadiness(options: SubmissionReadinessOptions): SubmissionReadinessReport {
  return assemble(options).report;
}

/** Generate all derived reports in a new directory; an existing directory is never overwritten. */
export function writeSubmissionReadiness(options: SubmissionReadinessOptions): SubmissionReadinessReport {
  const assembled = assemble(options);
  const outputDir = resolve(options.outputDir);
  if (existsSync(outputDir)) throw new Error(`readiness output directory already exists: ${outputDir}`);

  const parent = dirname(outputDir);
  mkdirSync(parent, { recursive: true });
  const temporaryDir = join(parent, `.luup-submission-readiness-${process.pid}-${Date.now()}`);
  mkdirSync(temporaryDir);
  try {
    for (const [name, contents] of assembled.files) writeFileSync(join(temporaryDir, name), contents, "utf8");
    writeFileSync(join(temporaryDir, "readiness.json"), `${JSON.stringify(assembled.report, null, 2)}\n`, "utf8");
    writeFileSync(join(temporaryDir, "readiness.md"), renderReadinessMarkdown(assembled.report), "utf8");
    if (existsSync(outputDir)) throw new Error(`readiness output directory already exists: ${outputDir}`);
    renameSync(temporaryDir, outputDir);
  } catch (error) {
    rmSync(temporaryDir, { recursive: true, force: true });
    throw error;
  }
  return assembled.report;
}

function assemble(options: SubmissionReadinessOptions): ReadinessDocuments {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const checks: ReadinessCheck[] = [];
  const files = new Map<string, string>();
  const artifacts: Record<string, string> = {
    batch_index: "batch-index.json",
    metrics_json: "metrics.json",
    metrics_markdown: "metrics.md",
    scoring_json: "scoring.json",
    scoring_markdown: "scoring.md",
    usage_jsonl: "usage.jsonl",
    usage_markdown: "usage.md",
    representative_json: "representative-case.json",
    representative_markdown: "representative-case.md",
  };
  let database: ReadOnlySubmissionDatabase | null = null;
  try {
    database = new ReadOnlySubmissionDatabase(options.dbPath);
    checks.push({ name: "source_database", state: "pass", required: true, detail: "SQLite 以只读句柄打开。" });
    checks.push({
      name: "database_read_only",
      state: "pass",
      required: true,
      detail: "本次审计不创建 SqliteStore、不收尾 running Run，也不写入输入数据库。",
    });
  } catch (error) {
    checks.push({ name: "source_database", state: "fail", required: true, detail: describe(error) });
    checks.push({
      name: "database_read_only",
      state: "unknown",
      required: true,
      detail: "数据库无法打开，无法证明只读审计。",
    });
  }

  let index: BatchSubmissionIndex | null = null;
  if (database !== null) {
    try {
      index = buildBatchSubmissionIndexReadOnly(database, options.manifestId, generatedAt);
      const gate = checkScience125BatchIndex(index);
      checks.push({
        name: "science125_index",
        state: gate.passed ? "pass" : "fail",
        required: true,
        detail: gate.passed
          ? "正式题库 1–125 各有一条可与终态 Run 对账的记录，漏题、重复题和异常 Run 均为零。"
          : `Science-125 严格门未通过：${gate.reasons.join(", ")}`,
      });
      files.set("batch-index.json", `${JSON.stringify(index, null, 2)}\n`);
    } catch (error) {
      checks.push({ name: "science125_index", state: "unknown", required: true, detail: describe(error) });
      files.set("batch-index.json", `${JSON.stringify({ status: "unknown", error: describe(error) }, null, 2)}\n`);
    }
  } else {
    checks.push({ name: "science125_index", state: "unknown", required: true, detail: "数据库不可读。" });
    files.set("batch-index.json", `${JSON.stringify({ status: "unknown", error: "数据库不可读。" }, null, 2)}\n`);
  }

  const metrics = safeReport(() => evaluateDatabase(options.dbPath, options.manifestId));
  if (metrics.value !== null) {
    files.set("metrics.json", `${JSON.stringify(metrics.value, null, 2)}\n`);
    files.set("metrics.md", renderMetricsMarkdown(metrics.value));
    const scoped = metrics.value.manifest_scope;
    const passed =
      scoped?.manifest_id === options.manifestId && scoped.included_run_count === 125 && metrics.value.runs === 125;
    checks.push({
      name: "metrics_manifest_scope",
      state: passed ? "pass" : "fail",
      required: true,
      detail: passed
        ? "指标仅从正式 manifest 纳入的 125 个 Run 计算。"
        : `指标范围不满足正式批次：${scoped?.included_run_count ?? "unknown"} 个纳入 Run。`,
    });
  } else {
    checks.push({ name: "metrics_manifest_scope", state: "unknown", required: true, detail: metrics.error });
    files.set("metrics.json", `${JSON.stringify({ status: "unknown", error: metrics.error }, null, 2)}\n`);
    files.set("metrics.md", `# Science-125 离线指标\n\n状态：unknown\n\n原因：${metrics.error}\n`);
  }

  const scoring = safeReport(() => loadRunScoresWithScope(options.dbPath, options.manifestId));
  if (scoring.value !== null) {
    const scores = scoring.value.scores;
    const scoringJson = {
      format: "luup.scoring-report",
      version: 1,
      generated_at: generatedAt,
      db_path: basename(options.dbPath),
      manifest_id: options.manifestId,
      count: scores.length,
      summaries: [
        summarize(scores, "全部 Run"),
        summarize(
          scores.filter((item) => item.status === "completed"),
          "仅 completed Run",
        ),
      ],
      scores,
    };
    files.set("scoring.json", `${JSON.stringify(scoringJson, null, 2)}\n`);
    const scope = scoring.value.scope;
    files.set(
      "scoring.md",
      renderScoringMarkdown(
        scores,
        options.dbPath,
        scope === undefined
          ? undefined
          : {
              manifest_id: scope.manifest_id,
              included_run_count: scope.included_run_count,
              excluded_db_run_count: scope.excluded_db_run_count,
              excluded_db_run_ids: scope.excluded_db_run_ids,
            },
      ),
    );
    checks.push({
      name: "scoring_manifest_scope",
      state: scores.length === 125 ? "pass" : "fail",
      required: true,
      detail: scores.length === 125 ? "评分覆盖正式 manifest 的 125 个 Run。" : `评分只得到 ${scores.length} 个 Run。`,
    });
  } else {
    checks.push({ name: "scoring_manifest_scope", state: "unknown", required: true, detail: scoring.error });
    files.set("scoring.json", `${JSON.stringify({ status: "unknown", error: scoring.error }, null, 2)}\n`);
    files.set("scoring.md", `# 结构化评分报告\n\n状态：unknown\n\n原因：${scoring.error}\n`);
  }

  const usage = safeReport(() => buildUsageReport(options.dbPath, options.pricing, generatedAt, options.manifestId));
  if (usage.value !== null) {
    files.set("usage.jsonl", renderUsageJsonl(usage.value));
    files.set("usage.md", renderUsageMarkdown(usage.value));
    const scoped = usage.value.manifest_scope;
    const passed =
      scoped?.manifest_id === options.manifestId &&
      scoped.included_run_count === 125 &&
      usage.value.summary.run_count === 125 &&
      usage.value.questions.length === 125 &&
      usage.value.summary.unknown_attempts === 0;
    checks.push({
      name: "usage_manifest_scope",
      state: passed ? "pass" : "fail",
      required: true,
      detail: passed
        ? "usage JSONL/Markdown 覆盖正式 manifest 的 125 个 Run。"
        : `usage 范围或用量事实不完整：纳入 ${scoped?.included_run_count ?? "unknown"} 个 Run，` +
          `summary runs=${usage.value.summary.run_count}、题目=${usage.value.questions.length}、` +
          `unknown attempts=${usage.value.summary.unknown_attempts}。`,
    });
  } else {
    checks.push({ name: "usage_manifest_scope", state: "unknown", required: true, detail: usage.error });
    files.set("usage.jsonl", `${JSON.stringify({ record_type: "header", status: "unknown", error: usage.error })}\n`);
    files.set("usage.md", `# Luup usage / cost 报告\n\n状态：unknown\n\n原因：${usage.error}\n`);
  }

  checks.push({
    name: "pricing",
    state: options.pricing === undefined ? "unknown" : "pass",
    required: true,
    detail:
      options.pricing === undefined
        ? "未提供有来源的 input/output 单价；成本保持 unknown，不猜价格。"
        : `使用显式价格来源：${options.pricing.source}。`,
  });

  if (database !== null) {
    let representative: RepresentativeCaseExport | null = null;
    try {
      const base = buildRepresentativeCase(database, options.representativeRunId, generatedAt);
      const strict = checkRepresentativeCaseStrict(database, base);
      representative = { ...base, strict };
      files.set("representative-case.json", `${JSON.stringify(representative, null, 2)}\n`);
      files.set("representative-case.md", renderRepresentativeCaseMarkdown(representative));
      checks.push({
        name: "representative_case",
        state: strict.passed ? "pass" : "fail",
        required: true,
        detail: strict.passed
          ? "代表案例满足森林脊骨：多候选、硬闸晋升、单次 accept、证据与用量。"
          : `代表案例严格门未通过：${strict.reasons.join(", ")}`,
      });
    } catch (error) {
      checks.push({ name: "representative_case", state: "unknown", required: true, detail: describe(error) });
      files.set(
        "representative-case.json",
        `${JSON.stringify({ status: "unknown", error: describe(error) }, null, 2)}\n`,
      );
      files.set("representative-case.md", `# 代表案例\n\n状态：unknown\n\n原因：${describe(error)}\n`);
    }
  } else {
    checks.push({ name: "representative_case", state: "unknown", required: true, detail: "数据库不可读。" });
    files.set(
      "representative-case.json",
      `${JSON.stringify({ status: "unknown", error: "数据库不可读。" }, null, 2)}\n`,
    );
    files.set("representative-case.md", "# 代表案例\n\n状态：unknown\n\n原因：数据库不可读。\n");
  }
  database?.close();

  checks.push(...externalChecks(options));
  const summary = {
    pass: checks.filter((item) => item.state === "pass").length,
    fail: checks.filter((item) => item.state === "fail").length,
    unknown: checks.filter((item) => item.state === "unknown").length,
    manual: checks.filter((item) => item.state === "manual").length,
  } satisfies Record<ReadinessState, number>;
  const report: SubmissionReadinessReport = {
    format: SUBMISSION_READINESS_FORMAT,
    version: SUBMISSION_READINESS_VERSION,
    generated_at: generatedAt,
    status: checks.every((item) => !item.required || item.state === "pass") ? "pass" : "fail",
    db_path: basename(options.dbPath),
    manifest_id: options.manifestId,
    representative_run_id: options.representativeRunId,
    checks,
    summary,
    artifacts,
  };
  return { report, files };
}

function externalChecks(options: SubmissionReadinessOptions): ReadinessCheck[] {
  const finalPdf =
    options.submissionFile === undefined
      ? { state: "manual" as const, detail: "未提供最终 PDF；需要人工补齐并核验页数、文件名和身份水印。" }
      : checkFinalSubmission(options.submissionFile);
  return [
    {
      name: "registration_screenshots",
      state:
        options.registrationEvidencePath !== undefined && !existsSync(options.registrationEvidencePath)
          ? "fail"
          : "manual",
      required: true,
      detail:
        options.registrationEvidencePath === undefined
          ? "缺少两页盖章报名表截图。"
          : existsSync(options.registrationEvidencePath)
            ? `已提供 ${options.registrationEvidencePath}，仍需人工确认截图完整且对应本作品。`
            : `指定报名表截图路径不存在：${options.registrationEvidencePath}。`,
    },
    {
      name: "qwen_call_evidence",
      state: options.qwenEvidencePath !== undefined && !existsSync(options.qwenEvidencePath) ? "fail" : "manual",
      required: true,
      detail:
        options.qwenEvidencePath === undefined
          ? "缺少 Qwen 模型/百炼调用凭证或控制台截图。"
          : existsSync(options.qwenEvidencePath)
            ? `已提供 ${options.qwenEvidencePath}，仍需人工核验模型、调用和时间范围。`
            : `指定 Qwen 调用凭证路径不存在：${options.qwenEvidencePath}。`,
    },
    { name: "final_submission_pdf", state: finalPdf.state, required: true, detail: finalPdf.detail },
    {
      name: "identity_watermark",
      state: "manual",
      required: true,
      detail: "必须人工确认作品详情页、PDF 和视频没有姓名、学校等身份水印。",
    },
    {
      name: "public_api",
      state: "manual",
      required: true,
      detail:
        options.publicApi === undefined
          ? "缺少可调用的公开测试 API 地址。"
          : `已提供 ${options.publicApi}，仍需人工发送示例请求并留证。`,
    },
    {
      name: "public_webui",
      state: "manual",
      required: true,
      detail:
        options.publicWebui === undefined
          ? "缺少可交互的公开 WebUI 地址。"
          : `已提供 ${options.publicWebui}，仍需人工真实浏览器验收并留证。`,
    },
    ...textMaterialCheck("project_information", options.projectInfoPath, "作品简介", 300),
    ...textMaterialCheck("qwen_technical_description", options.qwenDescriptionPath, "Qwen/AI 技术说明", 300),
  ];
}

function checkFinalSubmission(path: string): { state: ReadinessState; detail: string } {
  try {
    const result = checkSubmissionFile(path);
    if (result.kind !== "pdf") {
      return { state: "fail", detail: `最终提交材料必须是 PDF，当前识别为 ${result.kind}。` };
    }
    const failed = result.checks.filter((item) => item.state === "fail");
    const unknown = result.checks.filter((item) => item.state === "unknown");
    if (failed.length > 0)
      return { state: "fail", detail: `提交文件自动检查失败：${failed.map((item) => item.name).join(", ")}` };
    if (unknown.length > 0)
      return { state: "unknown", detail: `提交文件仍需人工复核：${unknown.map((item) => item.name).join(", ")}` };
    return { state: "pass", detail: `提交文件自动检查通过：${result.filename}。身份水印仍由独立人工门检查。` };
  } catch (error) {
    return { state: "unknown", detail: describe(error) };
  }
}

function textMaterialCheck(name: string, path: string | undefined, label: string, maxLength: number): ReadinessCheck[] {
  if (path === undefined) return [{ name, state: "manual", required: true, detail: `缺少${label}文件。` }];
  try {
    const text = readFileSync(path, "utf8");
    return [
      {
        name,
        state: text.length <= maxLength ? "pass" : "fail",
        required: true,
        detail:
          text.length <= maxLength
            ? `${label}为 ${text.length} 字，未超过 ${maxLength} 字。`
            : `${label}为 ${text.length} 字，超过 ${maxLength} 字上限。`,
      },
    ];
  } catch (error) {
    return [{ name, state: "unknown", required: true, detail: `${label}无法读取：${describe(error)}` }];
  }
}

function renderUsageJsonl(report: UsageReport): string {
  const lines = [
    JSON.stringify({
      record_type: "header",
      format: report.format,
      version: report.version,
      generated_at: report.generated_at,
      db_path: report.db_path,
      pricing: report.pricing,
      ...(report.manifest_scope === undefined ? {} : { manifest_scope: report.manifest_scope }),
    }),
    ...report.attempts.map((record) => JSON.stringify(record)),
    ...report.roles.map((record) => JSON.stringify(record)),
    ...report.runs.map((record) => JSON.stringify(record)),
    ...report.questions.map((record) => JSON.stringify(record)),
    JSON.stringify(report.summary),
  ];
  return `${lines.join("\n")}\n`;
}

function renderReadinessMarkdown(report: SubmissionReadinessReport): string {
  const state = (value: ReadinessState): string => value.toUpperCase();
  return [
    "# Luup submission readiness",
    "",
    `- 总状态：**${report.status.toUpperCase()}**`,
    `- 生成时间（UTC）：${report.generated_at}`,
    `- 数据库：\`${report.db_path}\``,
    `- Manifest：\`${report.manifest_id}\``,
    `- 代表 Run：\`${report.representative_run_id}\``,
    "",
    "自动门和外部材料门均 fail-closed；unknown/manual 不会被当成通过。",
    "",
    "| 检查项 | 必需 | 状态 | 说明 |",
    "| --- | :---: | --- | --- |",
    ...report.checks.map(
      (item) =>
        `| ${item.name} | ${item.required ? "是" : "否"} | ${state(item.state)} | ${item.detail.replaceAll("|", "\\|")} |`,
    ),
    "",
    "## 派生文件",
    "",
    ...Object.entries(report.artifacts).map(([name, path]) => `- ${name}: \`${path}\``),
    "",
  ].join("\n");
}

function safeReport<T>(fn: () => T): { value: T | null; error: string } {
  try {
    return { value: fn(), error: "" };
  } catch (error) {
    return { value: null, error: describe(error) };
  }
}

class ReadOnlySubmissionDatabase implements BatchSubmissionReadSource, RepresentativeCaseReadSource {
  readonly #db: DatabaseSync;

  constructor(path: string) {
    this.#db = new DatabaseSync(path, { readOnly: true });
  }

  close(): void {
    this.#db.close();
  }

  readBatchManifest(manifestId: string): StoredBatchManifest | null {
    const manifest = this.#db
      .prepare("SELECT id, expected_ids_json FROM batch_manifests WHERE id = ?")
      .get(manifestId) as RawRow | undefined;
    if (manifest === undefined) return null;
    const expectedIds = JSON.parse(stringValue(manifest.expected_ids_json));
    if (
      !Array.isArray(expectedIds) ||
      expectedIds.some((id) => typeof id !== "number" || !Number.isSafeInteger(id) || id < 1)
    ) {
      throw new Error(`manifest ${manifestId} has malformed expected IDs`);
    }
    const records = (
      this.#db
        .prepare("SELECT question_id, status, run_id FROM batch_manifest_records WHERE manifest_id = ? ORDER BY id")
        .all(manifestId) as RawRow[]
    ).map((row) => ({
      questionId: numberValue(row.question_id),
      status: stringValue(row.status) as BatchTerminalStatus,
      runId: row.run_id === null ? null : stringValue(row.run_id),
    }));
    return { id: stringValue(manifest.id), expectedIds: expectedIds as number[], records };
  }

  batchRunFacts(runId: string): BatchRunFacts | null {
    const row = this.#db
      .prepare("SELECT id, science125_id, status, error_code, memory_arm FROM runs WHERE id = ?")
      .get(runId) as RawRow | undefined;
    if (row === undefined) return null;
    const status = stringValue(row.status) as RunStatus;
    return {
      runId: stringValue(row.id),
      science125Id: nullableInteger(row.science125_id),
      status,
      errorCode: row.error_code === null ? null : stringValue(row.error_code),
      sourceIdentity: null,
      memoryArm: row.memory_arm === "on" || row.memory_arm === "off" ? row.memory_arm : null,
    };
  }

  artifact(artifactId: string): StoredArtifact | null {
    const row = this.#db.prepare("SELECT id, type, content_json FROM artifacts WHERE id = ?").get(artifactId) as
      | RawRow
      | undefined;
    if (row === undefined) return null;
    return {
      id: stringValue(row.id),
      type: stringValue(row.type) as DomainArtifact["artifact_type"],
      content: JSON.parse(stringValue(row.content_json)) as DomainArtifact,
    };
  }

  snapshot(runId: string): Record<string, unknown> | null {
    const run = this.#db.prepare("SELECT * FROM runs WHERE id = ?").get(runId) as RawRow | undefined;
    if (run === undefined) return null;
    const attempts = this.#db
      .prepare("SELECT * FROM attempts WHERE run_id = ? ORDER BY started_at, rowid")
      .all(runId) as RawRow[];
    const attemptIds = attempts.map((attempt) => stringValue(attempt.id));
    const evidence =
      attemptIds.length === 0
        ? []
        : (
            this.#db
              .prepare(
                `SELECT * FROM tool_evidence WHERE attempt_id IN (${attemptIds.map(() => "?").join(",")}) ORDER BY created_at, rowid`,
              )
              .all(...attemptIds) as RawRow[]
          ).map((row) => ({
            ...row,
            output: JSON.parse(stringValue(row.output_json)),
          }));
    const artifacts = (
      this.#db.prepare("SELECT * FROM artifacts WHERE run_id = ? ORDER BY created_at, rowid").all(runId) as RawRow[]
    ).map((row) => ({
      ...row,
      content: JSON.parse(stringValue(row.content_json)),
      input_artifact_ids: JSON.parse(stringValue(row.input_artifact_ids_json)),
    }));
    const events = (
      this.#db
        .prepare("SELECT id, version, kind, payload_json, created_at FROM events WHERE run_id = ? ORDER BY version")
        .all(runId) as RawRow[]
    ).map((row) => ({
      id: row.id,
      version: row.version,
      kind: row.kind,
      payload: JSON.parse(stringValue(row.payload_json)),
      created_at: row.created_at,
    }));
    return { ...run, attempts, tool_evidence: evidence, artifacts, recent_events: events };
  }
}

function stringValue(value: unknown): string {
  if (typeof value !== "string") throw new Error(`expected text, got ${String(value)}`);
  return value;
}

function numberValue(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value))
    throw new Error(`expected safe integer, got ${String(value)}`);
  return value;
}

function nullableInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

export function main(argv: string[] = process.argv.slice(2)): number {
  let values: {
    db?: string;
    "manifest-id"?: string;
    "representative-run-id"?: string;
    out?: string;
    "input-price-per-million"?: string;
    "output-price-per-million"?: string;
    currency?: string;
    model?: string;
    "price-source"?: string;
    "submission-file"?: string;
    registration?: string;
    "qwen-evidence"?: string;
    "public-api"?: string;
    "public-webui"?: string;
    "project-info"?: string;
    "qwen-description"?: string;
  };
  try {
    values = parseArgs({
      args: argv,
      options: {
        db: { type: "string" },
        "manifest-id": { type: "string" },
        "representative-run-id": { type: "string" },
        out: { type: "string" },
        "input-price-per-million": { type: "string" },
        "output-price-per-million": { type: "string" },
        currency: { type: "string" },
        model: { type: "string" },
        "price-source": { type: "string" },
        "submission-file": { type: "string" },
        registration: { type: "string" },
        "qwen-evidence": { type: "string" },
        "public-api": { type: "string" },
        "public-webui": { type: "string" },
        "project-info": { type: "string" },
        "qwen-description": { type: "string" },
      },
      strict: true,
    }).values;
  } catch (error) {
    process.stderr.write(`[submission:ready] ${describe(error)}\n`);
    return 2;
  }
  if (!values.db || !values["manifest-id"] || !values["representative-run-id"] || !values.out) {
    process.stderr.write(
      "用法：pnpm run submission:ready -- --db <runs.db> --manifest-id <id> --representative-run-id <id> --out <new-dir> " +
        "[--input-price-per-million <n> --output-price-per-million <n> --currency <code> --model <id> --price-source <text>] " +
        "[--submission-file <作品.pdf>] [--registration <截图目录>] [--qwen-evidence <凭证>] [--public-api <url>] [--public-webui <url>]\n",
    );
    return 2;
  }
  const pricing = parseExplicitPricing(values);
  if (pricing.error !== null) {
    process.stderr.write(`[submission:ready] ${pricing.error}\n`);
    return 2;
  }
  try {
    const report = writeSubmissionReadiness({
      dbPath: values.db,
      manifestId: values["manifest-id"],
      representativeRunId: values["representative-run-id"],
      outputDir: values.out,
      pricing: pricing.value,
      submissionFile: values["submission-file"],
      registrationEvidencePath: values.registration,
      qwenEvidencePath: values["qwen-evidence"],
      publicApi: values["public-api"],
      publicWebui: values["public-webui"],
      projectInfoPath: values["project-info"],
      qwenDescriptionPath: values["qwen-description"],
    });
    process.stdout.write(`[submission:ready] ${report.status} out=${resolve(values.out)}\n`);
    return report.status === "pass" ? 0 : 1;
  } catch (error) {
    process.stderr.write(`[submission:ready] ${describe(error)}\n`);
    return 2;
  }
}

function parseExplicitPricing(values: {
  "input-price-per-million"?: string;
  "output-price-per-million"?: string;
  currency?: string;
  model?: string;
  "price-source"?: string;
}): { value: UsagePricing | undefined; error: string | null } {
  const fields = [
    values["input-price-per-million"],
    values["output-price-per-million"],
    values.currency,
    values.model,
    values["price-source"],
  ];
  if (fields.every((value) => value === undefined)) return { value: undefined, error: null };
  if (fields.some((value) => value === undefined || value.trim() === "")) {
    return { value: undefined, error: "价格参数必须成组提供；缺失价格保持 unknown，不应填默认值。" };
  }
  const inputPerMillion = Number(values["input-price-per-million"]);
  const outputPerMillion = Number(values["output-price-per-million"]);
  if (
    !Number.isFinite(inputPerMillion) ||
    inputPerMillion < 0 ||
    !Number.isFinite(outputPerMillion) ||
    outputPerMillion < 0
  ) {
    return { value: undefined, error: "价格必须是非负有限数字。" };
  }
  return {
    value: {
      inputPerMillion,
      outputPerMillion,
      currency: values.currency!.trim(),
      model: values.model!.trim(),
      source: values["price-source"]!.trim(),
    },
    error: null,
  };
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === import.meta.filename) process.exitCode = main();
