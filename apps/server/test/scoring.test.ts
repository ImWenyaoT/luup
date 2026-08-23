import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { onTestFinished, test } from "vitest";

import { BatchManifest } from "../src/batch/manifest.ts";
import { exportScoringMarkdown, loadRunScores } from "../src/eval/scoring.ts";
import { SqliteStore } from "../src/store/store.ts";

function databasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), "luup-scoring-"));
  onTestFinished(() => rmSync(directory, { recursive: true, force: true }));
  return join(directory, "runs.db");
}

test("scoring can be scoped to a manifest while retaining the unscoped report", () => {
  const path = databasePath();
  const store = new SqliteStore(path);
  const includedRun = store.createRun("题 1", { science125Id: 1 });
  store.finishRun(includedRun, "failed", { errorCode: "invalid_output" });
  const excludedRun = store.createRun("题 2", { science125Id: 2 });
  store.finishRun(excludedRun, "failed", { errorCode: "invalid_output" });
  const manifest = BatchManifest.create(store, [1]);
  manifest.record({ questionId: 1, status: "failure", runId: includedRun });
  store.close();

  assert.equal(loadRunScores(path).length, 2);
  const scoped = loadRunScores(path, manifest.id);
  assert.deepEqual(
    scoped.map((item) => item.runId),
    [includedRun],
  );

  const output = join(dirname(path), "scoring.md");
  exportScoringMarkdown(path, output, manifest.id);
  const markdown = readFileSync(output, "utf8");
  assert.ok(markdown.includes(`Manifest：\`${manifest.id}\``));
  assert.match(markdown, /排除的 DB Run：1/);
  assert.match(markdown, new RegExp(excludedRun.slice(0, 8)));
});

test("scoring rejects an unknown manifest or a manifest without a valid run", () => {
  const path = databasePath();
  const store = new SqliteStore(path);
  const manifest = BatchManifest.create(store, [1]);
  manifest.record({ questionId: 1, status: "failure" });
  store.close();

  assert.throws(() => loadRunScores(path, "does-not-exist"), /manifest.*not found/i);
  assert.throws(() => loadRunScores(path, manifest.id), /no valid run/i);
});
