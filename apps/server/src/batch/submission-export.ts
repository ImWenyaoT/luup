import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";

import {
  BatchManifest,
  deriveBatchManifestSnapshot,
  type BatchManifestReadSource,
  type BatchManifestSnapshot,
  type BatchTerminalStatus,
  type StoredBatchManifest,
} from "./manifest.ts";
import { SqliteStore } from "../store/store.ts";

export const BATCH_SUBMISSION_INDEX_FORMAT = "luup.batch-submission-index" as const;
export const BATCH_SUBMISSION_INDEX_VERSION = 1 as const;

export type SubmissionQuestionStatus = BatchTerminalStatus | "omitted" | "invalid";

export type SubmissionQuestion = {
  questionId: number;
  status: SubmissionQuestionStatus;
  runId: string | null;
  reason: string | null;
  /** Relative API paths only; the export never embeds Artifact content. */
  links: { run: string; finalArtifact: string | null } | null;
};

export type SubmissionInvalidRecord = {
  questionId: number;
  status: BatchTerminalStatus | null;
  runId: string | null;
  reason: string;
};

export type BatchSubmissionIndex = {
  format: typeof BATCH_SUBMISSION_INDEX_FORMAT;
  version: typeof BATCH_SUBMISSION_INDEX_VERSION;
  generatedAt: string;
  manifestId: string;
  complete: boolean;
  /** One row per normalized expected ID, in ascending order. */
  expectedIds: number[];
  questions: SubmissionQuestion[];
  counts: {
    success: number;
    partial: number;
    failure: number;
    human_review: number;
    omitted: number;
    invalid: number;
    expected: number;
    records: number;
  };
  /** Raw manifest counts remain visible, even when a record is invalid. */
  manifestCounts: Record<BatchTerminalStatus, number> & { total: number };
  omittedIds: number[];
  invalidIds: number[];
  invalidRecords: SubmissionInvalidRecord[];
  duplicateIds: number[];
  expectedDuplicateIds: number[];
  unexpectedIds: number[];
};

export type ExportBatchSubmissionOptions = {
  dbPath: string;
  manifestId: string;
  outputPath: string;
  generatedAt?: string;
  /** Test and embedding seam; production CLI opens `dbPath` itself. */
  store?: SqliteStore;
};

/** The minimal read seam needed by the submission index. */
export type BatchSubmissionReadSource = BatchManifestReadSource & {
  readBatchManifest(manifestId: string): StoredBatchManifest | null;
  snapshot(runId: string): Record<string, unknown> | null;
};

export type Science125BatchExportGate = {
  passed: boolean;
  reasons: string[];
};

const SCIENCE125_IDS = Array.from({ length: 125 }, (_, index) => index + 1);

/**
 * Strict pre-submission gate for the official Science-125 export.
 *
 * The normal index remains a diagnostic projection for arbitrary manifests. This
 * gate is deliberately a separate pure seam so callers can always write that
 * projection first, then fail closed without losing the evidence of why it was
 * not eligible for submission.
 */
export function checkScience125BatchIndex(index: BatchSubmissionIndex): Science125BatchExportGate {
  const reasons: string[] = [];
  if (!sameIds(index.expectedIds, SCIENCE125_IDS)) reasons.push("expected_ids_not_exact_science125");
  if (!index.complete) reasons.push("manifest_incomplete");
  if (index.counts.invalid > 0 || index.invalidRecords.length > 0) reasons.push("invalid_records_present");
  if (index.counts.omitted > 0 || index.omittedIds.length > 0) reasons.push("omitted_ids_present");
  if (index.duplicateIds.length > 0 || index.expectedDuplicateIds.length > 0) {
    reasons.push("duplicate_ids_present");
  }
  if (index.unexpectedIds.length > 0) reasons.push("unexpected_ids_present");
  if (index.counts.expected !== SCIENCE125_IDS.length || index.counts.records !== SCIENCE125_IDS.length) {
    reasons.push("record_count_not_125");
  }
  return { passed: reasons.length === 0, reasons };
}

/** Build a submission index from durable manifest/run facts without copying any body. */
export function buildBatchSubmissionIndex(
  store: SqliteStore,
  manifestId: string,
  generatedAt = new Date().toISOString(),
): BatchSubmissionIndex {
  const snapshot = BatchManifest.open(store, manifestId).snapshot();
  return buildBatchSubmissionIndexFromSnapshot(store, snapshot, generatedAt);
}

/** Build the same index through a read-only fact seam; this never opens SqliteStore. */
export function buildBatchSubmissionIndexReadOnly(
  source: BatchSubmissionReadSource,
  manifestId: string,
  generatedAt = new Date().toISOString(),
): BatchSubmissionIndex {
  const stored = source.readBatchManifest(manifestId);
  if (stored === null) throw new Error(`unknown batch manifest: ${manifestId}`);
  return buildBatchSubmissionIndexFromSnapshot(source, deriveBatchManifestSnapshot(source, stored), generatedAt);
}

function buildBatchSubmissionIndexFromSnapshot(
  source: BatchSubmissionReadSource,
  snapshot: BatchManifestSnapshot,
  generatedAt: string,
): BatchSubmissionIndex {
  const expected = new Set(snapshot.expectedIds);
  const byQuestion = new Map<number, typeof snapshot.records>();
  for (const record of snapshot.records) {
    const records = byQuestion.get(record.questionId) ?? [];
    records.push(record);
    byQuestion.set(record.questionId, records);
  }

  const invalidByRecord = new Map<string, string>();
  for (const record of snapshot.invalidRecords) {
    invalidByRecord.set(recordKey(record.questionId, record.status, record.runId), record.reason);
  }

  const invalidRecords: SubmissionInvalidRecord[] = [];
  for (const record of snapshot.records) {
    const reason = !expected.has(record.questionId)
      ? "unexpected_question_id"
      : snapshot.duplicateIds.includes(record.questionId)
        ? "duplicate_manifest_records"
        : (invalidByRecord.get(recordKey(record.questionId, record.status, record.runId)) ?? null);
    if (reason !== null) invalidRecords.push({ ...record, reason });
  }
  for (const questionId of snapshot.expectedDuplicateIds) {
    invalidRecords.push({ questionId, status: null, runId: null, reason: "duplicate_expected_id" });
  }

  const questions = snapshot.expectedIds.map((questionId): SubmissionQuestion => {
    const records = byQuestion.get(questionId) ?? [];
    const first = records[0] ?? null;
    if (snapshot.expectedDuplicateIds.includes(questionId)) {
      return question(questionId, "invalid", first?.runId ?? null, "duplicate_expected_id", source);
    }
    if (records.length === 0) return question(questionId, "omitted", null, "omitted", source);
    if (records.length > 1) {
      return question(questionId, "invalid", first?.runId ?? null, "duplicate_manifest_records", source);
    }
    const reason = first
      ? (invalidByRecord.get(recordKey(first.questionId, first.status, first.runId)) ??
        (!expected.has(first.questionId) ? "unexpected_question_id" : null))
      : null;
    if (reason !== null) return question(questionId, "invalid", first?.runId ?? null, reason, source);
    return question(questionId, first!.status, first!.runId, null, source);
  });

  const counts = {
    success: 0,
    partial: 0,
    failure: 0,
    human_review: 0,
    omitted: 0,
    invalid: 0,
    expected: questions.length,
    records: snapshot.records.length,
  };
  for (const item of questions) counts[item.status] += 1;

  const omittedIds = questions.filter((item) => item.status === "omitted").map((item) => item.questionId);
  const invalidIds = questions.filter((item) => item.status === "invalid").map((item) => item.questionId);
  return {
    format: BATCH_SUBMISSION_INDEX_FORMAT,
    version: BATCH_SUBMISSION_INDEX_VERSION,
    generatedAt,
    manifestId: snapshot.id,
    complete: snapshot.complete,
    expectedIds: [...snapshot.expectedIds],
    questions,
    counts,
    manifestCounts: snapshot.counts,
    omittedIds,
    invalidIds,
    invalidRecords,
    duplicateIds: [...snapshot.duplicateIds],
    expectedDuplicateIds: [...snapshot.expectedDuplicateIds],
    unexpectedIds: [...snapshot.unexpectedIds],
  };
}

/** Write one JSON index; the SQLite store remains the sole source of run facts. */
export function exportBatchSubmissionIndex(options: ExportBatchSubmissionOptions): BatchSubmissionIndex {
  const store = options.store ?? new SqliteStore(options.dbPath);
  try {
    const index = buildBatchSubmissionIndex(store, options.manifestId, options.generatedAt);
    mkdirSync(dirname(resolve(options.outputPath)), { recursive: true });
    writeFileSync(options.outputPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");
    return index;
  } finally {
    if (!options.store) store.close();
  }
}

export function main(argv: string[] = process.argv.slice(2)): number {
  let values: { "manifest-id"?: string; db?: string; out?: string; "require-science125"?: boolean };
  try {
    values = parseArgs({
      args: argv,
      options: {
        "manifest-id": { type: "string" },
        db: { type: "string" },
        out: { type: "string" },
        "require-science125": { type: "boolean", default: false },
      },
      strict: true,
    }).values;
  } catch (error) {
    process.stderr.write(`[batch:export] ${describe(error)}\n`);
    return 2;
  }
  if (!values["manifest-id"] || !values.out) {
    process.stderr.write(
      "用法：bun run batch:export --manifest-id <id> --out <index.json> [--db <runs.db>] [--require-science125]\n",
    );
    return 2;
  }
  const dbPath = values.db || process.env.LUUP_DATABASE || "outputs/runtime/typescript-runs.db";
  try {
    const index = exportBatchSubmissionIndex({
      dbPath,
      manifestId: values["manifest-id"],
      outputPath: values.out,
    });
    process.stdout.write(
      `[batch:export] ${index.complete ? "complete" : "incomplete"} manifest=${index.manifestId} ` +
        `expected=${index.counts.expected} omitted=${index.counts.omitted} invalid=${index.counts.invalid} ` +
        `out=${resolve(values.out)}\n`,
    );
    if (values["require-science125"]) {
      const gate = checkScience125BatchIndex(index);
      if (!gate.passed) {
        process.stderr.write(`[batch:export] Science-125 strict gate failed: ${gate.reasons.join(", ")}\n`);
        return 1;
      }
    }
    return index.complete ? 0 : 1;
  } catch (error) {
    process.stderr.write(`[batch:export] ${describe(error)}\n`);
    return 2;
  }
}

function sameIds(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function question(
  questionId: number,
  status: SubmissionQuestionStatus,
  runId: string | null,
  reason: string | null,
  source: BatchSubmissionReadSource,
): SubmissionQuestion {
  return {
    questionId,
    status,
    runId,
    reason,
    links: linksFor(source, runId),
  };
}

function linksFor(source: BatchSubmissionReadSource, runId: string | null): SubmissionQuestion["links"] {
  if (runId === null) return null;
  const run = source.snapshot(runId);
  if (run === null) return null;
  const finalArtifactId = typeof run.final_artifact_id === "string" ? run.final_artifact_id : null;
  return {
    run: `/api/runs/${runId}`,
    finalArtifact: finalArtifactId === null ? null : `/api/artifacts/${finalArtifactId}`,
  };
}

function recordKey(questionId: number, status: BatchTerminalStatus, runId: string | null): string {
  return `${questionId}\u0000${status}\u0000${runId ?? ""}`;
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === import.meta.filename) {
  process.exitCode = main();
}
