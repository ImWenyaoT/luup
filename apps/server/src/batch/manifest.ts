import type { SqliteStore } from "../store/store.ts";

/** The only terminal categories a Science-125 manifest may count. */
export const BATCH_TERMINAL_STATUSES = ["success", "partial", "failure", "human_review"] as const;
export type BatchTerminalStatus = (typeof BATCH_TERMINAL_STATUSES)[number];

export type BatchTerminalRecord = {
  questionId: number;
  status: BatchTerminalStatus;
  runId: string | null;
};

type BatchManifestInvalidRecord = BatchTerminalRecord & {
  reason: string;
};

/** Raw durable shape returned by the SQLite adapter; completeness is derived above. */
export type StoredBatchManifest = {
  id: string;
  expectedIds: number[];
  records: BatchTerminalRecord[];
};

export type BatchManifestSnapshot = {
  id: string;
  /** The expected set, normalised for deterministic comparison. */
  expectedIds: number[];
  /** Repeated IDs in the original request; a malformed expected set is not complete. */
  expectedDuplicateIds: number[];
  records: BatchTerminalRecord[];
  /** Records which cannot be reconciled with a durable Science-125 Run. */
  invalidRecords: BatchManifestInvalidRecord[];
  counts: Record<BatchTerminalStatus, number> & { total: number };
  omittedIds: number[];
  duplicateIds: number[];
  unexpectedIds: number[];
  complete: boolean;
};

export type BatchManifestRecordInput = {
  questionId: number;
  status: BatchTerminalStatus;
  runId?: string | null;
};

/**
 * The manifest is deliberately a thin handle over SQLite. It does not cache the
 * expected set or records, so every snapshot and gate reads the durable facts.
 */
export class BatchManifest {
  readonly id: string;
  readonly #store: SqliteStore;
  readonly #resumable: boolean;

  private constructor(store: SqliteStore, id: string, resumable: boolean) {
    this.#store = store;
    this.id = id;
    this.#resumable = resumable;
  }

  static create(store: SqliteStore, expectedIds: readonly number[]): BatchManifest {
    validateIds(expectedIds, "expected IDs");
    if (expectedIds.length === 0) throw new Error("batch manifest requires at least one expected ID");
    return new BatchManifest(store, store.createBatchManifest(expectedIds), false);
  }

  static open(store: SqliteStore, id: string): BatchManifest {
    if (store.readBatchManifest(id) === null) throw new Error(`unknown batch manifest: ${id}`);
    return new BatchManifest(store, id, true);
  }

  record(input: BatchManifestRecordInput): void {
    validateIds([input.questionId], "question ID");
    const record = {
      questionId: input.questionId,
      status: input.status,
      runId: input.runId ?? null,
    } satisfies BatchTerminalRecord;
    if (this.#resumable) {
      const stored = this.#store.readBatchManifest(this.id);
      const previous = stored?.records.filter((item) => item.questionId === record.questionId) ?? [];
      if (previous.length === 1 && durableRecordError(this.#store, previous[0]!) !== null) {
        this.#store.replaceBatchManifestRecord(this.id, record);
        return;
      }
    }
    this.#store.recordBatchManifest(this.id, record);
  }

  /** IDs whose durable terminal record is absent or invalid and may be resumed. */
  pendingIds(): number[] {
    const snapshot = this.snapshot();
    if (
      snapshot.expectedDuplicateIds.length > 0 ||
      snapshot.duplicateIds.length > 0 ||
      snapshot.unexpectedIds.length > 0
    ) {
      throw new Error(`batch manifest ${snapshot.id} has an invalid expected/record set; refusing to resume`);
    }
    const invalid = new Set(snapshot.invalidRecords.map((record) => record.questionId));
    const recorded = new Set(snapshot.records.map((record) => record.questionId));
    return snapshot.expectedIds.filter((questionId) => !recorded.has(questionId) || invalid.has(questionId));
  }

  snapshot(): BatchManifestSnapshot {
    const stored = this.#store.readBatchManifest(this.id);
    if (stored === null) throw new Error(`unknown batch manifest: ${this.id}`);

    const expectedIds = uniqueSorted(stored.expectedIds);
    const expectedDuplicateIds = duplicateIds(stored.expectedIds);
    const records = stored.records.map((record) => ({
      questionId: record.questionId,
      status: record.status,
      runId: record.runId,
    }));
    const expected = new Set(expectedIds);
    const seen = countBy(records.map((record) => record.questionId));
    const omittedIds = expectedIds.filter((questionId) => !seen.has(questionId));
    const duplicateIdsInRecords = [...seen.entries()]
      .filter(([, count]) => count > 1)
      .map(([questionId]) => questionId)
      .sort((left, right) => left - right);
    const unexpectedIds = uniqueSorted(records.map((record) => record.questionId).filter((id) => !expected.has(id)));
    const counts = {
      success: 0,
      partial: 0,
      failure: 0,
      human_review: 0,
      total: records.length,
    } satisfies Record<BatchTerminalStatus, number> & { total: number };
    for (const record of records) counts[record.status] += 1;

    const invalidRecords = records.flatMap((record) => {
      const reason = durableRecordError(this.#store, record);
      return reason === null ? [] : [{ ...record, reason }];
    });

    const complete =
      expectedDuplicateIds.length === 0 &&
      omittedIds.length === 0 &&
      duplicateIdsInRecords.length === 0 &&
      unexpectedIds.length === 0 &&
      invalidRecords.length === 0;
    return {
      id: stored.id,
      expectedIds,
      expectedDuplicateIds,
      records,
      invalidRecords,
      counts,
      omittedIds,
      duplicateIds: duplicateIdsInRecords,
      unexpectedIds,
      complete,
    };
  }

  assertComplete(): BatchManifestSnapshot {
    const snapshot = this.snapshot();
    if (!snapshot.complete) {
      const reasons = [
        snapshot.omittedIds.length > 0 ? `omitted=${snapshot.omittedIds.join(",")}` : null,
        snapshot.duplicateIds.length > 0 ? `duplicate=${snapshot.duplicateIds.join(",")}` : null,
        snapshot.expectedDuplicateIds.length > 0
          ? `duplicate-expected=${snapshot.expectedDuplicateIds.join(",")}`
          : null,
        snapshot.unexpectedIds.length > 0 ? `unexpected=${snapshot.unexpectedIds.join(",")}` : null,
        snapshot.invalidRecords.length > 0
          ? `invalid=${snapshot.invalidRecords.map((record) => `${record.questionId}:${record.reason}`).join(",")}`
          : null,
      ].filter((reason): reason is string => reason !== null);
      throw new Error(`batch manifest ${snapshot.id} is incomplete: ${reasons.join("; ")}`);
    }
    return snapshot;
  }
}

function durableRecordError(store: SqliteStore, record: BatchTerminalRecord): string | null {
  if (record.runId === null) return "missing_run_id";
  const facts = store.batchRunFacts(record.runId);
  if (facts === null) return "unknown_run";
  if (facts.science125Id !== record.questionId) return "science125_id_mismatch";
  switch (record.status) {
    case "success":
      return facts.status === "completed" ? null : `run_status_${facts.status}`;
    case "partial":
      return facts.status === "failed" && facts.errorCode === "partial" ? null : "partial_status_mismatch";
    case "failure":
      return facts.status === "failed" && facts.errorCode !== "partial" ? null : "failure_status_mismatch";
    case "human_review":
      return facts.status === "review_rejected" ? null : "human_review_status_mismatch";
  }
}

function validateIds(ids: readonly number[], label: string): void {
  if (ids.some((id) => !Number.isSafeInteger(id) || id < 1)) {
    throw new Error(`${label} must contain positive safe integers`);
  }
}

function uniqueSorted(ids: readonly number[]): number[] {
  return [...new Set(ids)].sort((left, right) => left - right);
}

function duplicateIds(ids: readonly number[]): number[] {
  const counts = countBy(ids);
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([id]) => id)
    .sort((left, right) => left - right);
}

function countBy(ids: readonly number[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  return counts;
}
