import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { onTestFinished, test } from "vitest";

import { buildSubmissionReadiness, main, writeSubmissionReadiness } from "../src/submission/readiness.ts";
import { SqliteStore } from "../src/store/store.ts";

function fixture(): { dbPath: string; runId: string; manifestId: string; root: string } {
  const root = mkdtempSync(join(tmpdir(), "luup-submission-readiness-"));
  const dbPath = join(root, "formal.db");
  const store = new SqliteStore(dbPath);
  const runId = store.createRun("一道尚未完成的题", { science125Id: 1 });
  const manifestId = store.createBatchManifest([1]);
  const recordedRunId = store.createRun("一道已失败的题", { science125Id: 1 });
  store.finishRun(recordedRunId, "failed", { errorCode: "invalid_output" });
  store.recordBatchManifest(manifestId, { questionId: 1, status: "failure", runId: recordedRunId });
  store.close();
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  return { dbPath, runId, manifestId, root };
}

test("submission readiness is a fail-closed, read-only audit with explicit external gates", () => {
  const { dbPath, runId, manifestId, root } = fixture();

  const report = buildSubmissionReadiness({
    dbPath,
    manifestId,
    representativeRunId: runId,
    outputDir: join(root, "report"),
    generatedAt: "2026-08-22T00:00:00.000Z",
  });

  assert.equal(report.status, "fail");
  assert.equal(report.format, "luup.submission-readiness");
  assert.equal(report.checks.find((item) => item.name === "science125_index")?.state, "fail");
  assert.equal(report.checks.find((item) => item.name === "pricing")?.state, "unknown");
  assert.equal(report.checks.find((item) => item.name === "registration_screenshots")?.state, "manual");
  assert.equal(report.checks.find((item) => item.name === "qwen_call_evidence")?.state, "manual");
  assert.equal(report.checks.find((item) => item.name === "final_submission_pdf")?.state, "manual");
  assert.equal(report.checks.find((item) => item.name === "public_api")?.state, "manual");
  assert.equal(report.checks.find((item) => item.name === "public_webui")?.state, "manual");
  assert.equal(existsSync(join(root, "report")), false);

  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    assert.equal(
      (db.prepare("SELECT status FROM runs WHERE id = ?").get(runId) as { status: string }).status,
      "running",
    );
  } finally {
    db.close();
  }
});

test("submission readiness writes a new atomic report directory and never overwrites it", () => {
  const { dbPath, runId, manifestId, root } = fixture();
  const outputDir = join(root, "report");
  const report = writeSubmissionReadiness({
    dbPath,
    manifestId,
    representativeRunId: runId,
    outputDir,
    generatedAt: "2026-08-22T00:00:00.000Z",
  });

  assert.equal(JSON.parse(readFileSync(join(outputDir, "readiness.json"), "utf8")).status, report.status);
  assert.match(readFileSync(join(outputDir, "readiness.md"), "utf8"), /submission readiness/i);
  assert.match(readFileSync(join(outputDir, "scoring.md"), "utf8"), new RegExp(manifestId));
  assert.deepEqual(
    readdirSync(outputDir).sort(),
    [
      "batch-index.json",
      "metrics.json",
      "metrics.md",
      "readiness.json",
      "readiness.md",
      "scoring.json",
      "scoring.md",
      "usage.jsonl",
      "usage.md",
      "representative-case.json",
      "representative-case.md",
    ].sort(),
  );
  assert.throws(
    () =>
      writeSubmissionReadiness({
        dbPath,
        manifestId,
        representativeRunId: runId,
        outputDir,
        generatedAt: "2026-08-22T00:00:00.000Z",
      }),
    /already exists/i,
  );
});

test("submission readiness CLI writes diagnostics and exits non-zero until every required gate passes", () => {
  const { dbPath, runId, manifestId, root } = fixture();
  const outputDir = join(root, "cli-report");

  const exitCode = main([
    "--db",
    dbPath,
    "--manifest-id",
    manifestId,
    "--representative-run-id",
    runId,
    "--out",
    outputDir,
  ]);

  assert.equal(exitCode, 1);
  const report = JSON.parse(readFileSync(join(outputDir, "readiness.json"), "utf8"));
  assert.equal(report.status, "fail");
  assert.equal(report.checks.find((item: { name: string }) => item.name === "science125_index").state, "fail");
});
