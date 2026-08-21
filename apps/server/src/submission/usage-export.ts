import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { parseArgs } from "node:util";

import { Database } from "bun:sqlite";

export const USAGE_REPORT_FORMAT = "luup.usage-report" as const;
export const USAGE_REPORT_VERSION = 2 as const;

/** 价格单位固定为每一百万 input/output token；没有完整配置就不计算成本。 */
export type UsagePricing = {
  inputPerMillion: number;
  outputPerMillion: number;
  currency: string;
  model: string;
  source: string;
};

export type UsagePricingMetadata =
  | {
      configured: true;
      input_per_million: number;
      output_per_million: number;
      currency: string;
      model: string;
      source: string;
      unit: "per_million_tokens";
    }
  | {
      configured: false;
      input_per_million: null;
      output_per_million: null;
      currency: null;
      model: null;
      source: null;
      unit: null;
    };

export type UsageTokens = {
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
};

export type UsageCost = {
  input: number | null;
  output: number | null;
  total: number | null;
  currency: string | null;
  model: string | null;
  source: string | null;
};

export type UsageAttemptRecord = UsageTokens & {
  record_type: "attempt";
  run_id: string;
  question_id: number | null;
  status: string;
  role: string;
  attempt_id: string;
  ordinal: number;
  cost: UsageCost;
  unknown_reasons: string[];
};

export type UsageRoleRecord = UsageTokens & {
  record_type: "role";
  run_id: string;
  question_id: number | null;
  role: string;
  attempt_count: number;
  unknown_attempts: number;
  cost: UsageCost;
  unknown_reasons: string[];
};

export type UsageRunRecord = UsageTokens & {
  record_type: "run";
  run_id: string;
  question_id: number | null;
  question: string;
  status: string;
  role_count: number;
  unknown_roles: number;
  cost: UsageCost;
  unknown_reasons: string[];
};

export type UsageQuestionRecord = UsageTokens & {
  record_type: "question";
  question_id: number | null;
  run_count: number;
  unknown_runs: number;
  run_ids: string[];
  cost: UsageCost;
  unknown_reasons: string[];
};

export type UsageSummary = UsageTokens & {
  record_type: "summary";
  run_count: number;
  question_count: number;
  attempt_count: number;
  unknown_attempts: number;
  cost: UsageCost;
  unknown_reasons: string[];
};

export type UsageReport = {
  format: typeof USAGE_REPORT_FORMAT;
  version: typeof USAGE_REPORT_VERSION;
  generated_at: string;
  db_path: string;
  pricing: UsagePricingMetadata;
  attempts: UsageAttemptRecord[];
  roles: UsageRoleRecord[];
  runs: UsageRunRecord[];
  questions: UsageQuestionRecord[];
  summary: UsageSummary;
};

export type UsageExportOptions = {
  dbPath: string;
  outputPath: string;
  markdownPath?: string;
  pricing?: UsagePricing;
  generatedAt?: string;
};

type RawRow = Record<string, unknown>;
type RawEvent = { version: number; kind: string; payload: Record<string, unknown> | null; malformed: boolean };
type AttemptUsage = {
  runId: string;
  questionId: number | null;
  status: string;
  role: string;
  attemptId: string;
  ordinal: number;
  usage: UsageTokens;
  unknownReasons: string[];
};

const EMPTY_PRICING: UsagePricingMetadata = {
  configured: false,
  input_per_million: null,
  output_per_million: null,
  currency: null,
  model: null,
  source: null,
  unit: null,
};

/** CLI 价格参数；价格以每百万 token 计，五项必须成组出现。 */
export type PricingArgs = {
  input?: string;
  output?: string;
  currency?: string;
  model?: string;
  source?: string;
};

export function parsePricing(values: PricingArgs): UsagePricing | null {
  const provided = Object.values(values).some((value) => value !== undefined);
  if (!provided) return null;
  const missing = (["input", "output", "currency", "model", "source"] as const).filter(
    (key) => values[key] === undefined || values[key]!.trim() === "",
  );
  if (missing.length > 0) throw new Error(`显式价格配置不完整，缺少：${missing.join(", ")}`);
  return {
    inputPerMillion: parsePrice(values.input!, "input-price-per-million"),
    outputPerMillion: parsePrice(values.output!, "output-price-per-million"),
    currency: values.currency!.trim(),
    model: values.model!.trim(),
    source: values.source!.trim(),
  };
}

/** 从 SQLite 只读事实生成逐 Attempt、逐角色、逐 Run、逐题和汇总记录。 */
export function buildUsageReport(
  dbPath: string,
  pricing?: UsagePricing,
  generatedAt = new Date().toISOString(),
): UsageReport {
  const db = new Database(dbPath, { readonly: true });
  try {
    const runs = (
      db.prepare("SELECT id, question, science125_id, status FROM runs ORDER BY created_at, rowid").all() as RawRow[]
    ).map((row) => ({
      id: stringColumn(row, "id"),
      question: stringColumn(row, "question"),
      questionId: nullableInteger(row.science125_id),
      status: stringColumn(row, "status"),
    }));

    const attempts: AttemptUsage[] = runs.flatMap((run) => loadAttempts(db, run.id, run.questionId));
    const attemptRecords = attempts.map((item) => toAttemptRecord(item, pricing));
    const roles = aggregateRoles(attempts, pricing);
    const runRecords = runs.map((run) => {
      const runAttempts = attempts.filter((item) => item.runId === run.id);
      const roleRecords = roles.filter((item) => item.run_id === run.id);
      const aggregate =
        runAttempts.length === 0
          ? {
              ...aggregateTokenFacts([], pricing),
              unknown_reasons: ["attempts_missing"],
            }
          : aggregateTokenFacts(
              runAttempts.map((item) => ({ ...item.usage, unknown_reasons: item.unknownReasons })),
              pricing,
            );
      return {
        record_type: "run" as const,
        run_id: run.id,
        question_id: run.questionId,
        question: run.question,
        status: run.status,
        role_count: roleRecords.length,
        unknown_roles: roleRecords.filter((item) => item.unknown_attempts > 0).length,
        ...aggregate,
      } satisfies UsageRunRecord;
    });
    const questions = aggregateQuestions(runRecords, pricing);
    const summary = {
      record_type: "summary" as const,
      run_count: runRecords.length,
      question_count: questions.length,
      attempt_count: attempts.length,
      unknown_attempts: attempts.filter((item) => item.unknownReasons.length > 0).length,
      ...aggregateTokenFacts(runRecords, pricing),
    } satisfies UsageSummary;

    return {
      format: USAGE_REPORT_FORMAT,
      version: USAGE_REPORT_VERSION,
      generated_at: generatedAt,
      // Submission artifacts must not reveal the operator's absolute filesystem layout.
      db_path: basename(dbPath),
      pricing: pricingMetadata(pricing),
      attempts: attemptRecords,
      roles,
      runs: runRecords,
      questions,
      summary,
    };
  } finally {
    db.close();
  }
}

/** 写 JSONL；首行是元数据，末行是汇总，中间行按 scope 展开。 */
export function exportUsageReport(options: UsageExportOptions): UsageReport {
  const report = buildUsageReport(options.dbPath, options.pricing, options.generatedAt);
  mkdirSync(dirname(resolve(options.outputPath)), { recursive: true });
  const lines = [
    JSON.stringify({
      record_type: "header",
      format: report.format,
      version: report.version,
      generated_at: report.generated_at,
      db_path: report.db_path,
      pricing: report.pricing,
    }),
    ...report.attempts.map((record) => JSON.stringify(record)),
    ...report.roles.map((record) => JSON.stringify(record)),
    ...report.runs.map((record) => JSON.stringify(record)),
    ...report.questions.map((record) => JSON.stringify(record)),
    JSON.stringify(report.summary),
  ];
  writeFileSync(options.outputPath, `${lines.join("\n")}\n`, "utf8");
  if (options.markdownPath) {
    mkdirSync(dirname(resolve(options.markdownPath)), { recursive: true });
    writeFileSync(options.markdownPath, renderUsageMarkdown(report), "utf8");
  }
  return report;
}

export function renderUsageMarkdown(report: UsageReport): string {
  const pricingLine = report.pricing.configured
    ? `已配置：${report.pricing.model}，${report.pricing.currency}，输入 ${report.pricing.input_per_million}/M、输出 ${report.pricing.output_per_million}/M，来源：${report.pricing.source}`
    : "未提供；成本列保持 N/A，不猜默认价格。";
  const lines = [
    "# Luup usage / cost 报告",
    "",
    `- 生成时间（UTC）：${report.generated_at}`,
    `- 数据源：${report.db_path}`,
    `- 成本配置：${pricingLine}`,
    `- Run：${report.summary.run_count}；题目分组：${report.summary.question_count}；Attempt：${report.summary.attempt_count}`,
    "",
    "所有 token 均直接来自 SQLite 的 `sdk.usage` 事实；缺失或损坏保持 `null`，不以 0 代替。",
    "",
    "## 汇总",
    "",
    "| 范围 | input tokens | output tokens | total tokens | total cost | unknown attempts |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    `| 全部 | ${numberOrNa(report.summary.input_tokens)} | ${numberOrNa(report.summary.output_tokens)} | ${numberOrNa(report.summary.total_tokens)} | ${costOrNa(report.summary.cost.total, report.summary.cost.currency)} | ${report.summary.unknown_attempts} |`,
    "",
    "## 按题目",
    "",
    "| 题号 | Run 数 | input | output | total | cost | unknown Run |",
    "| ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...report.questions.map(
      (item) =>
        `| ${item.question_id === null ? "unassigned" : item.question_id} | ${item.run_count} | ${numberOrNa(item.input_tokens)} | ${numberOrNa(item.output_tokens)} | ${numberOrNa(item.total_tokens)} | ${costOrNa(item.cost.total, item.cost.currency)} | ${item.unknown_runs} |`,
    ),
    "",
    "## 按 Run / 角色",
    "",
    "| Run | 题号 | 状态 | 角色 | Attempts | input | output | total | cost |",
    "| --- | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: |",
    ...report.roles.map((item) => {
      const run = report.runs.find((candidate) => candidate.run_id === item.run_id);
      return `| ${item.run_id.slice(0, 12)} | ${item.question_id ?? "-"} | ${run?.status ?? "unknown"} | ${item.role} | ${item.attempt_count} | ${numberOrNa(item.input_tokens)} | ${numberOrNa(item.output_tokens)} | ${numberOrNa(item.total_tokens)} | ${costOrNa(item.cost.total, item.cost.currency)} |`;
    }),
    "",
    "## 逐 Attempt 未知原因",
    "",
    ...report.attempts
      .filter((item) => item.unknown_reasons.length > 0)
      .map((item) => `- ${item.run_id}/${item.role}#${item.ordinal}: ${item.unknown_reasons.join(", ")}`),
    ...(report.attempts.some((item) => item.unknown_reasons.length > 0) ? [] : ["- 无"]),
    "",
  ];
  return `${lines.join("\n").replace(/\s+$/, "")}\n`;
}

export function main(argv: string[] = process.argv.slice(2)): number {
  let values;
  try {
    values = parseArgs({
      args: argv,
      options: {
        db: { type: "string" },
        out: { type: "string" },
        markdown: { type: "string" },
        "input-price-per-million": { type: "string" },
        "output-price-per-million": { type: "string" },
        currency: { type: "string" },
        model: { type: "string" },
        "price-source": { type: "string" },
      },
      strict: true,
    }).values;
  } catch (error) {
    process.stderr.write(`[usage:export] ${describe(error)}\n`);
    return 2;
  }
  if (!values.db || !values.out) {
    process.stderr.write(
      "用法：usage-export.ts --db <runs.db> --out <usage.jsonl> [--markdown <usage.md>] " +
        "[--input-price-per-million <n> --output-price-per-million <n> --currency <code> --model <id> --price-source <text>]\n",
    );
    return 2;
  }
  try {
    const report = exportUsageReport({
      dbPath: values.db,
      outputPath: values.out,
      markdownPath: values.markdown,
      pricing:
        parsePricing({
          input: values["input-price-per-million"],
          output: values["output-price-per-million"],
          currency: values.currency,
          model: values.model,
          source: values["price-source"],
        }) ?? undefined,
    });
    process.stdout.write(
      `[usage:export] runs=${report.summary.run_count} attempts=${report.summary.attempt_count} ` +
        `unknown=${report.summary.unknown_attempts} cost=${report.pricing.configured ? "configured" : "N/A"} ` +
        `out=${resolve(values.out)}\n`,
    );
    return 0;
  } catch (error) {
    process.stderr.write(`[usage:export] ${describe(error)}\n`);
    return 2;
  }
}

function loadAttempts(db: Database, runId: string, questionId: number | null): AttemptUsage[] {
  const events = (
    db
      .prepare("SELECT version, kind, payload_json FROM events WHERE run_id = ? ORDER BY version")
      .all(runId) as RawRow[]
  ).map(parseEvent);
  const starts = events
    .filter((event) => event.kind === "attempt.started")
    .map((event) => ({
      version: event.version,
      role: stringPayload(event.payload, "role"),
      ordinal: integerPayload(event.payload, "ordinal"),
    }))
    .filter(
      (item): item is { version: number; role: string; ordinal: number } => item.role !== null && item.ordinal !== null,
    );
  const rows = db
    .prepare("SELECT id, role, ordinal, status FROM attempts WHERE run_id = ? ORDER BY started_at, rowid")
    .all(runId) as RawRow[];
  return rows.map((row) => {
    const role = stringColumn(row, "role");
    const ordinal = integerColumn(row, "ordinal");
    const start = starts.find((item) => item.role === role && item.ordinal === ordinal);
    const nextStart = start === undefined ? null : (starts.find((item) => item.version > start.version) ?? null);
    const candidates = events.filter(
      (event) =>
        event.kind === "sdk.usage" &&
        start !== undefined &&
        event.version > start.version &&
        (nextStart === null || event.version < nextStart.version),
    );
    return {
      runId,
      questionId,
      status: stringColumn(row, "status"),
      role,
      attemptId: stringColumn(row, "id"),
      ordinal,
      ...usageFromEvents(candidates, role, start === undefined),
    };
  });
}

function usageFromEvents(
  events: RawEvent[],
  role: string,
  missingStart: boolean,
): {
  usage: UsageTokens;
  unknownReasons: string[];
} {
  if (missingStart) return { usage: unknownUsage(), unknownReasons: ["attempt_start_missing"] };
  if (events.length === 0) return { usage: unknownUsage(), unknownReasons: ["usage_missing"] };
  if (events.length > 1) return { usage: unknownUsage(), unknownReasons: ["usage_multiple_events"] };
  const event = events[0]!;
  if (event.malformed || event.payload === null) return { usage: unknownUsage(), unknownReasons: ["usage_malformed"] };
  if (event.payload.agent !== role) return { usage: unknownUsage(), unknownReasons: ["usage_agent_mismatch"] };
  const input = safeToken(event.payload.input_tokens);
  const output = safeToken(event.payload.output_tokens);
  const total = safeToken(event.payload.total_tokens);
  if (input === null || output === null || total === null)
    return { usage: unknownUsage(), unknownReasons: ["usage_malformed"] };
  return {
    usage: { input_tokens: input, output_tokens: output, total_tokens: total },
    unknownReasons: [],
  };
}

function aggregateRoles(attempts: AttemptUsage[], pricing: UsagePricing | undefined): UsageRoleRecord[] {
  const groups = new Map<string, AttemptUsage[]>();
  for (const attempt of attempts) {
    const key = `${attempt.runId}\u0000${attempt.role}`;
    groups.set(key, [...(groups.get(key) ?? []), attempt]);
  }
  return [...groups.values()].map((items) => {
    const first = items[0]!;
    const aggregate = aggregateTokenFacts(
      items.map((item) => ({ ...item.usage, unknown_reasons: item.unknownReasons })),
      pricing,
    );
    return {
      record_type: "role" as const,
      run_id: first.runId,
      question_id: first.questionId,
      role: first.role,
      attempt_count: items.length,
      unknown_attempts: items.filter((item) => item.unknownReasons.length > 0).length,
      ...aggregate,
    } satisfies UsageRoleRecord;
  });
}

function aggregateQuestions(runs: UsageRunRecord[], pricing: UsagePricing | undefined): UsageQuestionRecord[] {
  const groups = new Map<number | null, UsageRunRecord[]>();
  for (const run of runs) groups.set(run.question_id, [...(groups.get(run.question_id) ?? []), run]);
  return [...groups.entries()]
    .sort(([left], [right]) => (left === null ? 1 : right === null ? -1 : left - right))
    .map(([questionId, items]) => {
      const aggregate = aggregateTokenFacts(items, pricing);
      return {
        record_type: "question" as const,
        question_id: questionId,
        run_count: items.length,
        unknown_runs: items.filter((item) => item.unknown_reasons.length > 0).length,
        run_ids: items.map((item) => item.run_id),
        ...aggregate,
      } satisfies UsageQuestionRecord;
    });
}

function aggregateTokenFacts(
  values: readonly (UsageTokens | UsageRunRecord)[],
  pricing: UsagePricing | undefined,
): UsageTokens & { cost: UsageCost; unknown_reasons: string[] } {
  const usages = values.map((value) => value);
  const usage: UsageTokens = {
    input_tokens: sumNullable(usages.map((value) => value.input_tokens)),
    output_tokens: sumNullable(usages.map((value) => value.output_tokens)),
    total_tokens: sumNullable(usages.map((value) => value.total_tokens)),
  };
  const reasons = unique(usages.flatMap((value) => ("unknown_reasons" in value ? value.unknown_reasons : [])));
  return { ...usage, cost: costFor(usage, pricing), unknown_reasons: reasons };
}

function toAttemptRecord(attempt: AttemptUsage, pricing: UsagePricing | undefined): UsageAttemptRecord {
  return {
    record_type: "attempt",
    run_id: attempt.runId,
    question_id: attempt.questionId,
    status: attempt.status,
    role: attempt.role,
    attempt_id: attempt.attemptId,
    ordinal: attempt.ordinal,
    ...attempt.usage,
    cost: costFor(attempt.usage, pricing),
    unknown_reasons: attempt.unknownReasons,
  };
}

function costFor(usage: UsageTokens, pricing: UsagePricing | undefined): UsageCost {
  if (!pricing) return emptyCost();
  const input = usage.input_tokens === null ? null : (usage.input_tokens / 1_000_000) * pricing.inputPerMillion;
  const output = usage.output_tokens === null ? null : (usage.output_tokens / 1_000_000) * pricing.outputPerMillion;
  const total = input === null || output === null ? null : input + output;
  return {
    input,
    output,
    total,
    currency: pricing.currency,
    model: pricing.model,
    source: pricing.source,
  };
}

function pricingMetadata(pricing: UsagePricing | undefined): UsagePricingMetadata {
  if (!pricing) return EMPTY_PRICING;
  return {
    configured: true,
    input_per_million: pricing.inputPerMillion,
    output_per_million: pricing.outputPerMillion,
    currency: pricing.currency,
    model: pricing.model,
    source: pricing.source,
    unit: "per_million_tokens",
  };
}

function parseEvent(row: RawRow): RawEvent {
  const kind = stringColumn(row, "kind");
  try {
    const payload = JSON.parse(stringColumn(row, "payload_json")) as unknown;
    return {
      version: integerColumn(row, "version"),
      kind,
      payload: isObject(payload) ? payload : null,
      malformed: !isObject(payload),
    };
  } catch {
    return { version: integerColumn(row, "version"), kind, payload: null, malformed: true };
  }
}

function parsePrice(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${name} 必须是非负有限数字`);
  return parsed;
}

function stringColumn(row: RawRow, column: string): string {
  const value = row[column];
  if (typeof value !== "string") throw new Error(`列 ${column} 不是文本：${String(value)}`);
  return value;
}

function integerColumn(row: RawRow, column: string): number {
  const value = row[column];
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new Error(`列 ${column} 不是安全整数`);
  return value;
}

function nullableInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function stringPayload(payload: Record<string, unknown> | null, field: string): string | null {
  return typeof payload?.[field] === "string" ? payload[field] : null;
}

function integerPayload(payload: Record<string, unknown> | null, field: string): number | null {
  const value = payload?.[field];
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function safeToken(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function unknownUsage(): UsageTokens {
  return { input_tokens: null, output_tokens: null, total_tokens: null };
}

function emptyCost(): UsageCost {
  return { input: null, output: null, total: null, currency: null, model: null, source: null };
}

function sumNullable(values: readonly (number | null)[]): number | null {
  if (values.length === 0 || values.some((value) => value === null)) return null;
  let sum = 0;
  for (const value of values) sum += value as number;
  return sum;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberOrNa(value: number | null): string {
  return value === null ? "N/A" : String(value);
}

function costOrNa(value: number | null, currency: string | null): string {
  return value === null || currency === null ? "N/A" : `${currency} ${value.toFixed(6)}`;
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === import.meta.filename) {
  process.exitCode = main();
}
