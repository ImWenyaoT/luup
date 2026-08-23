import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import type { DomainArtifact } from "../src/agent/contracts.ts";
import { BatchManifest, type BatchTerminalStatus } from "../src/batch/manifest.ts";
import { main, runBatch } from "../src/batch/runner.ts";
import { SqliteStore } from "../src/store/store.ts";

function manifest(expectedIds: number[]) {
  const store = new SqliteStore(":memory:");
  const value = BatchManifest.create(store, expectedIds);
  return { store, value };
}

function close(store: SqliteStore): void {
  store.close();
}

function completeRun(store: SqliteStore, runId: string): void {
  const attemptId = store.startAttempt(runId, "research-plan");
  const artifact = store.publishArtifact(
    runId,
    attemptId,
    { artifact_type: "research-plan" } as unknown as DomainArtifact,
    [],
    0,
  );
  store.finishRun(runId, "completed", { finalArtifactId: artifact.id });
}

function manifestRun(store: SqliteStore, questionId: number, status: BatchTerminalStatus): string {
  const runId = store.createRun(`题 ${questionId}`, { science125Id: questionId });
  if (status === "success") completeRun(store, runId);
  else if (status === "partial") store.finishRun(runId, "failed", { errorCode: "partial" });
  else if (status === "failure") store.finishRun(runId, "failed", { errorCode: "invalid_output" });
  else store.finishRun(runId, "review_rejected", { errorCode: "review_rejected" });
  return runId;
}

test("a manifest counts every terminal status and becomes complete only at exact coverage", () => {
  const { store, value } = manifest([1, 2, 3, 4]);
  try {
    const statuses: BatchTerminalStatus[] = ["success", "partial", "failure", "human_review"];
    const runIds = statuses.map((status, index) => manifestRun(store, index + 1, status));
    statuses.forEach((status, index) => value.record({ questionId: index + 1, status, runId: runIds[index] }));

    assert.deepEqual(value.snapshot(), {
      id: value.id,
      expectedIds: [1, 2, 3, 4],
      expectedDuplicateIds: [],
      records: [
        { questionId: 1, status: "success", runId: runIds[0] },
        { questionId: 2, status: "partial", runId: runIds[1] },
        { questionId: 3, status: "failure", runId: runIds[2] },
        { questionId: 4, status: "human_review", runId: runIds[3] },
      ],
      invalidRecords: [],
      counts: { success: 1, partial: 1, failure: 1, human_review: 1, total: 4 },
      omittedIds: [],
      duplicateIds: [],
      unexpectedIds: [],
      complete: true,
    });
  } finally {
    close(store);
  }
});

test("an omitted question keeps a partial batch incomplete", () => {
  const { store, value } = manifest([1, 2]);
  try {
    value.record({ questionId: 1, status: "success" });

    const snapshot = value.snapshot();
    assert.deepEqual(snapshot.omittedIds, [2]);
    assert.equal(snapshot.complete, false);
    assert.throws(() => value.assertComplete(), /omitted.*2/);
  } finally {
    close(store);
  }
});

test("a manifest never treats a missing or non-terminal Run as a valid success", () => {
  const { store, value } = manifest([1]);
  try {
    value.record({ questionId: 1, status: "success" });
    assert.deepEqual(value.snapshot().invalidRecords, [
      { questionId: 1, status: "success", runId: null, reason: "missing_run_id" },
    ]);
    assert.equal(value.snapshot().complete, false);
    assert.deepEqual(value.pendingIds(), [1]);

    const running = store.createRun("仍在运行", { science125Id: 1 });
    value.record({ questionId: 1, status: "success", runId: running });
    assert.throws(() => value.assertComplete(), /invalid=.*run_status_running/);
  } finally {
    close(store);
  }
});

test("duplicate expected ids and duplicate terminal records are explicit gate failures", () => {
  const { store, value } = manifest([1, 1, 2]);
  try {
    value.record({ questionId: 1, status: "success", runId: "run-a" });
    value.record({ questionId: 1, status: "failure", runId: "run-b" });
    value.record({ questionId: 2, status: "human_review", runId: "run-c" });

    const snapshot = value.snapshot();
    assert.deepEqual(snapshot.expectedDuplicateIds, [1]);
    assert.deepEqual(snapshot.duplicateIds, [1]);
    assert.deepEqual(snapshot.unexpectedIds, []);
    assert.equal(snapshot.complete, false);
    assert.throws(() => value.assertComplete(), /duplicate.*1/);
  } finally {
    close(store);
  }
});

test("an unexpected terminal record is retained and prevents a false full-batch claim", () => {
  const { store, value } = manifest([1]);
  try {
    value.record({ questionId: 1, status: "success" });
    value.record({ questionId: 99, status: "partial" });

    const snapshot = value.snapshot();
    assert.deepEqual(snapshot.unexpectedIds, [99]);
    assert.deepEqual(snapshot.omittedIds, []);
    assert.equal(snapshot.complete, false);
    assert.throws(() => value.assertComplete(), /unexpected.*99/);
  } finally {
    close(store);
  }
});

test("manifest facts survive a fresh store instance because SQLite is the source of truth", () => {
  const dir = mkdtempSync(join(tmpdir(), "luup-manifest-"));
  const path = join(dir, "runs.db");
  try {
    const first = new SqliteStore(path);
    const value = BatchManifest.create(first, [7]);
    const runId = first.createRun("持久化题", { science125Id: 7 });
    completeRun(first, runId);
    value.record({ questionId: 7, status: "success", runId });
    const id = value.id;
    first.close();

    const second = new SqliteStore(path);
    try {
      const reopened = BatchManifest.open(second, id);
      assert.equal(reopened.snapshot().complete, true);
      assert.deepEqual(reopened.snapshot().records, [{ questionId: 7, status: "success", runId }]);
    } finally {
      second.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runBatch records one terminal manifest row per settled question", async () => {
  const store = new SqliteStore(":memory:");
  try {
    const report = await runBatch([1, 2], {
      store,
      runQuestion: async ({ questionId, runId }) => {
        if (questionId === 1) completeRun(store, runId);
        else store.finishRun(runId, "failed", { errorCode: "invalid_output" });
        return {
          status: questionId === 1 ? ("completed" as const) : ("failed" as const),
          errorCode: questionId === 1 ? null : "invalid_output",
        };
      },
      concurrency: 1,
      log: () => {},
    });

    assert.equal(report.manifestId, report.manifest.id);
    assert.equal(report.manifest.complete, true);
    assert.deepEqual(report.manifest.omittedIds, []);
    assert.deepEqual(report.manifest.counts, { success: 1, partial: 0, failure: 1, human_review: 0, total: 2 });
  } finally {
    store.close();
  }
});

test("runBatch downgrades a returned completed result when SQLite is still running", async () => {
  const store = new SqliteStore(":memory:");
  try {
    const report = await runBatch([1], {
      store,
      runQuestion: async () => ({ status: "completed", errorCode: null }),
      concurrency: 1,
      log: () => {},
    });

    assert.deepEqual(
      report.outcomes.map((item) => `${item.status}/${item.classification}`),
      ["error/infra_error"],
    );
    const runId = report.outcomes[0]!.runId!;
    assert.equal(store.batchRunFacts(runId)?.status, "failed");
    assert.equal(report.manifest.complete, true);
    assert.deepEqual(report.manifest.counts, { success: 0, partial: 0, failure: 1, human_review: 0, total: 1 });
  } finally {
    store.close();
  }
});

test("opening a manifest resumes only omitted or invalid questions", async () => {
  const store = new SqliteStore(":memory:");
  try {
    const value = BatchManifest.create(store, [1, 2]);
    const firstRun = manifestRun(store, 1, "success");
    value.record({ questionId: 1, status: "success", runId: firstRun });
    const asked: number[] = [];
    const report = await runBatch([1, 2], {
      store,
      manifestId: value.id,
      runQuestion: async ({ questionId, runId }) => {
        asked.push(questionId);
        completeRun(store, runId);
        return { status: "completed", errorCode: null };
      },
      concurrency: 1,
      log: () => {},
    });

    assert.deepEqual(asked, [2]);
    assert.equal(report.manifest.complete, true);
    assert.deepEqual(report.manifest.omittedIds, []);
  } finally {
    store.close();
  }
});

test("resuming repairs an invalid record from an already completed Run without duplicating it", async () => {
  const store = new SqliteStore(":memory:");
  try {
    const value = BatchManifest.create(store, [1]);
    value.record({ questionId: 1, status: "success" });
    const runId = store.createRun("已交付但未记入 manifest", { science125Id: 1 });
    completeRun(store, runId);

    const report = await runBatch([1], {
      store,
      manifestId: value.id,
      runQuestion: async () => {
        throw new Error("completed Run should be reused");
      },
      log: () => {},
    });

    assert.equal(report.manifest.complete, true);
    assert.deepEqual(report.manifest.records, [{ questionId: 1, status: "success", runId }]);
    assert.equal(report.manifest.duplicateIds.length, 0);
  } finally {
    store.close();
  }
});

test("CLI can reopen a manifest without repeating --ids", async () => {
  const dir = mkdtempSync(join(tmpdir(), "luup-manifest-cli-"));
  const path = join(dir, "runs.db");
  const first = new SqliteStore(path);
  const value = BatchManifest.create(first, [1]);
  const runId = manifestRun(first, 1, "success");
  value.record({ questionId: 1, status: "success", runId });
  const manifestId = value.id;
  first.close();
  try {
    assert.equal(await main(["--manifest-id", manifestId, "--dry-run", "--db", path], { nodeVersion: "v22.0.0" }), 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runBatch keeps reviewer rejection as human review rather than generic failure", async () => {
  const store = new SqliteStore(":memory:");
  try {
    const report = await runBatch([1], {
      store,
      runQuestion: async ({ runId }) => {
        store.finishRun(runId, "review_rejected", { errorCode: "review_rejected" });
        return { status: "review_rejected", errorCode: "review_rejected" };
      },
      concurrency: 1,
      log: () => {},
    });

    assert.deepEqual(report.manifest.counts, {
      success: 0,
      partial: 0,
      failure: 0,
      human_review: 1,
      total: 1,
    });
    assert.equal(report.manifest.complete, true);
  } finally {
    store.close();
  }
});

test("an explicitly partial durable Run is counted as partial, not hidden as failure", async () => {
  const store = new SqliteStore(":memory:");
  try {
    const report = await runBatch([1], {
      store,
      runQuestion: async ({ runId }) => {
        store.finishRun(runId, "failed", { errorCode: "partial" });
        return { status: "failed", errorCode: "partial" };
      },
      concurrency: 1,
      log: () => {},
    });

    assert.deepEqual(report.manifest.counts, { success: 0, partial: 1, failure: 0, human_review: 0, total: 1 });
    assert.equal(report.manifest.complete, true);
  } finally {
    store.close();
  }
});

test("a circuit-broken runBatch exposes omitted IDs instead of claiming a full batch", async () => {
  const dir = mkdtempSync(join(tmpdir(), "luup-manifest-batch-"));
  const store = new SqliteStore(":memory:");
  try {
    const report = await runBatch([1, 2, 3], {
      store,
      repoRoot: dir,
      runQuestion: () => Promise.resolve({ status: "failed" as const, errorCode: "infra_error" }),
      concurrency: 1,
      log: () => {},
    });

    assert.ok(report.stopped);
    assert.deepEqual(report.manifest.omittedIds, [3]);
    assert.equal(report.manifest.complete, false);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
