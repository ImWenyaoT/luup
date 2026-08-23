import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onTestFinished, test } from "vitest";

import type { DomainArtifact } from "../src/agent/contracts.ts";
import { BatchManifest } from "../src/batch/manifest.ts";
import {
  buildUsageReport,
  exportUsageReport,
  parsePricing,
  renderUsageMarkdown,
  type UsagePricing,
} from "../src/submission/usage-export.ts";
import { SqliteStore } from "../src/store/store.ts";

function databasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), "luup-usage-export-"));
  onTestFinished(() => rmSync(directory, { recursive: true, force: true }));
  return join(directory, "runs.db");
}

function researchPlan(): DomainArtifact {
  return { artifact_type: "research-plan" } as unknown as DomainArtifact;
}

function makeStore(path: string): SqliteStore {
  const store = new SqliteStore(path);
  onTestFinished(() => store.close());
  return store;
}

function completedRun(store: SqliteStore, questionId: number, usage: { input: number; output: number }): string {
  const runId = store.createRun(`问题 ${questionId}`, { science125Id: questionId });
  const attemptId = store.startAttempt(runId, "research-plan");
  const artifact = store.publishArtifact(runId, attemptId, researchPlan(), [], 0, {
    agent: "research-plan",
    inputTokens: usage.input,
    outputTokens: usage.output,
    totalTokens: usage.input + usage.output,
  });
  store.finishRun(runId, "completed", { finalArtifactId: artifact.id });
  return runId;
}

const pricing: UsagePricing = {
  inputPerMillion: 2.5,
  outputPerMillion: 5,
  currency: "CNY",
  model: "qwen-test",
  source: "explicit test price sheet",
};

test("usage report emits run/question/role records and keeps configured cost metadata", () => {
  const path = databasePath();
  const store = makeStore(path);
  const runId = completedRun(store, 1, { input: 100, output: 40 });
  const report = buildUsageReport(path, pricing, "2026-08-22T00:00:00.000Z");

  assert.equal(report.format, "luup.usage-report");
  assert.equal(report.version, 2);
  assert.equal(report.db_path, "runs.db");
  assert.equal(report.db_path.includes(tmpdir()), false);
  assert.deepEqual(
    report.attempts.map((item) => item.role),
    ["research-plan"],
  );
  assert.deepEqual(
    {
      input_tokens: report.attempts[0]!.input_tokens,
      output_tokens: report.attempts[0]!.output_tokens,
      total_tokens: report.attempts[0]!.total_tokens,
    },
    { input_tokens: 100, output_tokens: 40, total_tokens: 140 },
  );
  assert.equal(report.attempts[0]!.run_id, runId);
  assert.equal(report.roles[0]!.total_tokens, 140);
  assert.equal(report.runs[0]!.total_tokens, 140);
  assert.equal(report.questions[0]!.question_id, 1);
  assert.equal(report.questions[0]!.total_tokens, 140);
  assert.equal(report.runs[0]!.cost.total, 0.00045);
  assert.deepEqual(report.pricing, {
    configured: true,
    input_per_million: 2.5,
    output_per_million: 5,
    currency: "CNY",
    model: "qwen-test",
    source: "explicit test price sheet",
    unit: "per_million_tokens",
  });
});

test("usage report can be scoped to a manifest and reports excluded database runs", () => {
  const path = databasePath();
  const store = makeStore(path);
  const includedRun = completedRun(store, 1, { input: 100, output: 40 });
  const excludedRun = completedRun(store, 2, { input: 200, output: 80 });
  const manifest = BatchManifest.create(store, [1]);
  manifest.record({ questionId: 1, status: "success", runId: includedRun });

  const report = buildUsageReport(path, undefined, "2026-08-22T00:00:00.000Z", manifest.id);

  assert.equal(report.runs.length, 1);
  assert.equal(report.runs[0]!.run_id, includedRun);
  assert.deepEqual(report.manifest_scope, {
    manifest_id: manifest.id,
    included_run_count: 1,
    excluded_db_run_count: 1,
    excluded_db_run_ids: [excludedRun],
  });
});

test("usage report rejects an unknown or run-less manifest instead of silently exporting an empty cohort", () => {
  const path = databasePath();
  const store = makeStore(path);
  assert.throws(() => buildUsageReport(path, undefined, undefined, "does-not-exist"), /manifest.*not found/i);

  const manifest = BatchManifest.create(store, [1]);
  manifest.record({ questionId: 1, status: "success" });
  assert.throws(() => buildUsageReport(path, undefined, undefined, manifest.id), /no valid run/i);
});

test("missing usage is represented as null at every aggregate instead of zero", () => {
  const path = databasePath();
  const store = makeStore(path);
  const runId = store.createRun("没有用量的题", { science125Id: 2 });
  const attemptId = store.startAttempt(runId, "researcher");
  const artifact = store.publishArtifact(
    runId,
    attemptId,
    { artifact_type: "research" } as unknown as DomainArtifact,
    [],
    0,
  );
  store.finishRun(runId, "failed", { errorCode: "provider_error" });

  const report = buildUsageReport(path, undefined, "2026-08-22T00:00:00.000Z");
  assert.equal(report.attempts[0]!.run_id, runId);
  assert.deepEqual(
    {
      input_tokens: report.attempts[0]!.input_tokens,
      output_tokens: report.attempts[0]!.output_tokens,
      total_tokens: report.attempts[0]!.total_tokens,
    },
    { input_tokens: null, output_tokens: null, total_tokens: null },
  );
  assert.deepEqual(report.attempts[0]!.cost, {
    input: null,
    output: null,
    total: null,
    currency: null,
    model: null,
    source: null,
  });
  assert.equal(report.runs[0]!.total_tokens, null);
  assert.equal(report.questions[0]!.total_tokens, null);
  assert.equal(report.summary.total_tokens, null);
  assert.equal(report.summary.unknown_attempts, 1);
  assert.equal(artifact.id.length > 0, true);
});

test("partial or malformed usage does not become a zero-cost fact", () => {
  const path = databasePath();
  const store = makeStore(path);
  const runId = store.createRun("损坏用量", { science125Id: 3 });
  const attemptId = store.startAttempt(runId, "researcher");
  store.emit(runId, "sdk.usage", { agent: "researcher", input_tokens: 20, output_tokens: "unknown", total_tokens: 20 });
  store.publishArtifact(runId, attemptId, { artifact_type: "research" } as unknown as DomainArtifact, [], 0);
  store.finishRun(runId, "failed", { errorCode: "provider_error" });

  const report = buildUsageReport(path, pricing, "2026-08-22T00:00:00.000Z");
  assert.deepEqual(
    {
      input_tokens: report.attempts[0]!.input_tokens,
      output_tokens: report.attempts[0]!.output_tokens,
      total_tokens: report.attempts[0]!.total_tokens,
    },
    { input_tokens: null, output_tokens: null, total_tokens: null },
  );
  assert.deepEqual(report.attempts[0]!.unknown_reasons, ["usage_malformed"]);
  assert.equal(report.runs[0]!.cost.total, null);
});

test("JSONL export and Markdown include the same explicit unknown semantics", () => {
  const path = databasePath();
  const store = makeStore(path);
  completedRun(store, 4, { input: 10, output: 5 });
  const directory = mkdtempSync(join(tmpdir(), "luup-usage-output-"));
  onTestFinished(() => rmSync(directory, { recursive: true, force: true }));
  const output = join(directory, "usage.jsonl");
  const markdown = join(directory, "usage.md");

  const report = exportUsageReport({
    dbPath: path,
    outputPath: output,
    markdownPath: markdown,
    pricing,
    generatedAt: "2026-08-22T00:00:00.000Z",
  });
  const lines = readFileSync(output, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  assert.equal(lines[0]!.record_type, "header");
  assert.equal(lines.at(-1)!.record_type, "summary");
  assert.equal(lines.filter((line) => line.record_type === "run").length, 1);
  assert.match(readFileSync(markdown, "utf8"), /qwen-test/);
  assert.equal(report.runs.length, 1);
});

test("pricing requires every explicit provenance field and never invents a price", () => {
  assert.equal(parsePricing({}), null);
  assert.throws(() => parsePricing({ input: "2.5", output: "5", currency: "CNY", model: "qwen-test" }), /source/);
  assert.deepEqual(
    parsePricing({ input: "0", output: "5", currency: "CNY", model: "qwen-test", source: "catalog" }),
    pricingForZeroInput(),
  );
});

function pricingForZeroInput(): UsagePricing {
  return {
    inputPerMillion: 0,
    outputPerMillion: 5,
    currency: "CNY",
    model: "qwen-test",
    source: "catalog",
  };
}

test("Markdown reports N/A for an unconfigured cost instead of ¥0", () => {
  const path = databasePath();
  const store = makeStore(path);
  completedRun(store, 5, { input: 10, output: 5 });
  const report = buildUsageReport(path, undefined, "2026-08-22T00:00:00.000Z");
  const text = renderUsageMarkdown(report);
  assert.match(text, /成本配置：未提供/);
  assert.match(text, /N\/A/);
  assert.doesNotMatch(text, /¥0/);
});
