import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onTestFinished, test } from "vitest";

import { admitPaidBatch, readPhaseBQuestionIds } from "../src/batch/admission.ts";

const clean = { gitCommit: "a".repeat(40), treeDirty: false } as const;
const science125 = Array.from({ length: 125 }, (_, index) => index + 1);

test("admission plan distinguishes paid execution from release guarding", () => {
  assert.deepEqual(
    admitPaidBatch({
      stage: "launch",
      questionIds: [1],
      dryRun: false,
      noMemory: false,
      manifestId: undefined,
      confirmedScience125: false,
      confirmedMemoryAblation: false,
      releaseCommit: undefined,
      repoRoot: ".",
      databasePath: ":memory:",
    }),
    {
      admitted: true,
      plan: {
        sourceIdentity: null,
        memoryArm: "on",
        paid: true,
        formal: false,
        releaseGuarded: false,
        intent: "launch",
      },
    },
  );
  assert.deepEqual(
    admitPaidBatch({
      stage: "launch",
      questionIds: [1],
      dryRun: true,
      noMemory: false,
      manifestId: undefined,
      confirmedScience125: false,
      confirmedMemoryAblation: false,
      releaseCommit: undefined,
      repoRoot: ".",
      databasePath: ":memory:",
    }),
    {
      admitted: true,
      plan: {
        sourceIdentity: null,
        memoryArm: "on",
        paid: false,
        formal: false,
        releaseGuarded: false,
        intent: "launch",
      },
    },
  );
});

test("formal release commit is exact and produces a frozen Phase A plan", () => {
  for (const [releaseCommit, pattern] of [
    [undefined, /--release-commit/],
    ["abc", /40/],
    ["A".repeat(40), /40/],
    ["b".repeat(40), /当前.*commit/],
  ] as const) {
    const decision = admitPaidBatch({
      stage: "launch",
      questionIds: science125,
      dryRun: false,
      noMemory: false,
      manifestId: undefined,
      confirmedScience125: true,
      confirmedMemoryAblation: false,
      releaseCommit,
      repoRoot: ".",
      databasePath: ":memory:",
      facts: { sourceIdentity: clean, databaseArtifacts: [] },
    });
    assert.equal(decision.admitted, false);
    if (!decision.admitted) assert.match(decision.error, pattern);
  }

  assert.deepEqual(
    admitPaidBatch({
      stage: "launch",
      questionIds: science125,
      dryRun: false,
      noMemory: false,
      manifestId: undefined,
      confirmedScience125: true,
      confirmedMemoryAblation: false,
      releaseCommit: clean.gitCommit,
      repoRoot: ".",
      databasePath: ":memory:",
      facts: { sourceIdentity: clean, databaseArtifacts: [] },
    }),
    {
      admitted: true,
      plan: {
        sourceIdentity: clean,
        memoryArm: "on",
        paid: true,
        formal: true,
        releaseGuarded: true,
        intent: "launch",
      },
    },
  );
});

test("Phase B launch is pinned to the registered cohort, confirmation, clean source, and off arm", () => {
  const ids = readPhaseBQuestionIds();
  assert.equal(ids.length, 30);

  const missingConfirmation = admitPaidBatch({
    stage: "launch",
    questionIds: ids,
    dryRun: false,
    noMemory: true,
    manifestId: undefined,
    confirmedScience125: false,
    confirmedMemoryAblation: false,
    releaseCommit: clean.gitCommit,
    repoRoot: ".",
    databasePath: ":memory:",
    facts: { sourceIdentity: clean, protocolQuestionIds: ids },
  });
  assert.equal(missingConfirmation.admitted, false);
  if (!missingConfirmation.admitted) assert.match(missingConfirmation.error, /--confirm-memory-ablation/);

  const wrongIds = admitPaidBatch({
    stage: "launch",
    questionIds: [1],
    dryRun: false,
    noMemory: true,
    manifestId: undefined,
    confirmedScience125: false,
    confirmedMemoryAblation: true,
    releaseCommit: clean.gitCommit,
    repoRoot: ".",
    databasePath: ":memory:",
    facts: { sourceIdentity: clean, protocolQuestionIds: ids },
  });
  assert.equal(wrongIds.admitted, false);
  if (!wrongIds.admitted) assert.match(wrongIds.error, /精确匹配.*30 题/);

  const dirty = admitPaidBatch({
    stage: "launch",
    questionIds: ids,
    dryRun: false,
    noMemory: true,
    manifestId: undefined,
    confirmedScience125: false,
    confirmedMemoryAblation: true,
    releaseCommit: clean.gitCommit,
    repoRoot: ".",
    databasePath: ":memory:",
    facts: { sourceIdentity: { ...clean, treeDirty: true }, protocolQuestionIds: ids },
  });
  assert.equal(dirty.admitted, false);
  if (!dirty.admitted) assert.match(dirty.error, /tree clean/);

  const admitted = admitPaidBatch({
    stage: "launch",
    questionIds: ids,
    dryRun: false,
    noMemory: true,
    manifestId: undefined,
    confirmedScience125: false,
    confirmedMemoryAblation: true,
    releaseCommit: clean.gitCommit,
    repoRoot: ".",
    databasePath: ":memory:",
    facts: { sourceIdentity: clean, protocolQuestionIds: ids },
  });
  assert.equal(admitted.admitted, true);
  if (admitted.admitted)
    assert.deepEqual(admitted.plan, {
      sourceIdentity: clean,
      memoryArm: "off",
      paid: true,
      formal: true,
      releaseGuarded: true,
      intent: "launch",
    });
});

test("Science-125 launch rejects missing source, dirty source, and SQLite sidecars", () => {
  const missing = admitPaidBatch({
    stage: "launch",
    questionIds: science125,
    dryRun: false,
    noMemory: false,
    manifestId: undefined,
    confirmedScience125: true,
    confirmedMemoryAblation: false,
    releaseCommit: clean.gitCommit,
    repoRoot: ".",
    databasePath: ":memory:",
    facts: { sourceIdentity: null, databaseArtifacts: [] },
  });
  assert.equal(missing.admitted, false);
  if (!missing.admitted) assert.match(missing.error, /source identity/);

  const dirty = admitPaidBatch({
    stage: "launch",
    questionIds: science125,
    dryRun: false,
    noMemory: false,
    manifestId: undefined,
    confirmedScience125: true,
    confirmedMemoryAblation: false,
    releaseCommit: clean.gitCommit,
    repoRoot: ".",
    databasePath: ":memory:",
    facts: { sourceIdentity: { ...clean, treeDirty: true }, databaseArtifacts: [] },
  });
  assert.equal(dirty.admitted, false);
  if (!dirty.admitted) assert.match(dirty.error, /tree clean/);

  const dir = mkdtempSync(join(tmpdir(), "luup-admission-"));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  const databasePath = join(dir, "runs.db");
  writeFileSync(`${databasePath}-wal`, "old");
  writeFileSync(`${databasePath}.writer-lock.db-journal`, "old");
  const sidecars = admitPaidBatch({
    stage: "launch",
    questionIds: science125,
    dryRun: false,
    noMemory: false,
    manifestId: undefined,
    confirmedScience125: true,
    confirmedMemoryAblation: false,
    releaseCommit: clean.gitCommit,
    repoRoot: ".",
    databasePath,
    facts: { sourceIdentity: clean },
  });
  assert.equal(sidecars.admitted, false);
  if (!sidecars.admitted) {
    assert.match(sidecars.error, /runs\.db-wal/);
    assert.match(sidecars.error, /writer-lock\.db-journal/);
  }
});

test("resume reconciliation keeps one clean commit and memory arm", () => {
  const onRun = {
    runId: "run-1",
    science125Id: 1,
    status: "completed" as const,
    errorCode: null,
    sourceIdentity: clean,
    memoryArm: "on" as const,
  };
  const valid = admitPaidBatch({
    stage: "resume",
    questionIds: science125,
    noMemory: false,
    confirmedScience125: true,
    sourceIdentity: clean,
    existingRuns: [onRun],
  });
  assert.equal(valid.admitted, true);
  if (valid.admitted)
    assert.deepEqual(valid.plan, {
      sourceIdentity: clean,
      memoryArm: "on",
      paid: true,
      formal: true,
      releaseGuarded: true,
      intent: "resume",
    });

  for (const [runs, pattern] of [
    [[{ ...onRun, sourceIdentity: null }], /run-1/],
    [[{ ...onRun, sourceIdentity: { gitCommit: "b".repeat(40), treeDirty: false } }], /commit/],
    [[{ ...onRun, sourceIdentity: { ...clean, treeDirty: true } }], /dirty/],
    [[{ ...onRun, memoryArm: "off" as const }], /memory arm/],
  ] as const) {
    const decision = admitPaidBatch({
      stage: "resume",
      questionIds: science125,
      noMemory: false,
      confirmedScience125: true,
      sourceIdentity: clean,
      existingRuns: runs,
    });
    assert.equal(decision.admitted, false);
    if (!decision.admitted) assert.match(decision.error, pattern);
  }

  const offRun = { ...onRun, memoryArm: "off" as const };
  const phaseB = admitPaidBatch({
    stage: "resume",
    questionIds: readPhaseBQuestionIds(),
    noMemory: true,
    confirmedScience125: false,
    sourceIdentity: clean,
    existingRuns: [offRun],
  });
  assert.equal(phaseB.admitted, true);
  const wrongArm = admitPaidBatch({
    stage: "resume",
    questionIds: readPhaseBQuestionIds(),
    noMemory: true,
    confirmedScience125: false,
    sourceIdentity: clean,
    existingRuns: [onRun],
  });
  assert.equal(wrongArm.admitted, false);
  if (!wrongArm.admitted) assert.match(wrongArm.error, /memory arm.*off/);

  const subset = admitPaidBatch({
    stage: "resume",
    questionIds: [1, 2],
    noMemory: false,
    confirmedScience125: false,
    sourceIdentity: null,
    existingRuns: [],
  });
  assert.equal(subset.admitted, true, "ordinary subset resume remains outside formal cohort reconciliation");
});
