import { Database } from "bun:sqlite";

/** A read-only cohort selected by one durable batch manifest. */
export type ManifestRunScope = {
  manifestId: string;
  includedRunIds: string[];
  /** Runs present in SQLite but not validly associated with this manifest. */
  excludedDbRunIds: string[];
};

type Row = Record<string, unknown>;
type ManifestRecord = {
  questionId: number;
  status: string;
  runId: string | null;
};
type RunFact = {
  id: string;
  questionId: number | null;
  status: string;
  errorCode: string | null;
};

/**
 * Resolve a manifest to the run IDs it durably and semantically owns.
 *
 * Reports use a read-only Database directly rather than SqliteStore: opening a
 * store is allowed to settle interrupted runs, which would make an offline
 * report mutate its own input. A record is valid only when its run exists,
 * carries the same Science-125 ID, and its terminal state agrees with the
 * manifest status. Invalid records remain excluded and are visible through the
 * excluded database-run count/IDs in each report.
 */
export function resolveManifestRunScope(db: Database, manifestId: string): ManifestRunScope {
  const manifest = db.prepare("SELECT id, expected_ids_json FROM batch_manifests WHERE id = ?").get(manifestId) as
    | Row
    | undefined;
  if (manifest === undefined || manifest === null) throw new Error(`manifest not found: ${manifestId}`);

  const expectedIds = parseExpectedIds(manifest.expected_ids_json, manifestId);
  const expected = new Set(expectedIds);
  const records = (
    db
      .prepare("SELECT question_id, status, run_id FROM batch_manifest_records WHERE manifest_id = ? ORDER BY id")
      .all(manifestId) as Row[]
  ).map(parseManifestRecord);
  const runs = (
    db.prepare("SELECT id, science125_id, status, error_code FROM runs ORDER BY created_at, rowid").all() as Row[]
  ).map(parseRunFact);
  const byId = new Map(runs.map((run) => [run.id, run]));
  const included = new Set<string>();

  for (const record of records) {
    if (record.runId === null || !expected.has(record.questionId)) continue;
    const run = byId.get(record.runId);
    if (run !== undefined && validRecord(record, run)) included.add(run.id);
  }

  if (included.size === 0) throw new Error(`manifest ${manifestId} has no valid run records`);
  const includedRunIds = runs.filter((run) => included.has(run.id)).map((run) => run.id);
  const excludedDbRunIds = runs.filter((run) => !included.has(run.id)).map((run) => run.id);
  return { manifestId, includedRunIds, excludedDbRunIds };
}

function parseExpectedIds(value: unknown, manifestId: string): number[] {
  if (typeof value !== "string") throw new Error(`manifest ${manifestId} has malformed expected IDs`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`manifest ${manifestId} has malformed expected IDs`);
  }
  if (!Array.isArray(parsed) || parsed.some((id) => typeof id !== "number" || !Number.isSafeInteger(id) || id < 1)) {
    throw new Error(`manifest ${manifestId} has malformed expected IDs`);
  }
  return parsed;
}

function parseManifestRecord(row: Row): ManifestRecord {
  return {
    questionId: typeof row.question_id === "number" ? row.question_id : Number.NaN,
    status: typeof row.status === "string" ? row.status : "",
    runId: typeof row.run_id === "string" && row.run_id.length > 0 ? row.run_id : null,
  };
}

function parseRunFact(row: Row): RunFact {
  return {
    id: typeof row.id === "string" ? row.id : "",
    questionId: typeof row.science125_id === "number" ? row.science125_id : null,
    status: typeof row.status === "string" ? row.status : "",
    errorCode: typeof row.error_code === "string" ? row.error_code : null,
  };
}

function validRecord(record: ManifestRecord, run: RunFact): boolean {
  if (run.id === "" || run.questionId !== record.questionId) return false;
  switch (record.status) {
    case "success":
      return run.status === "completed";
    case "partial":
      return run.status === "failed" && run.errorCode === "partial";
    case "failure":
      return run.status === "failed" && run.errorCode !== "partial";
    case "human_review":
      return run.status === "review_rejected";
    default:
      return false;
  }
}
