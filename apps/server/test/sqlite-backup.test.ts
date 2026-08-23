import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "vitest";

import { createSchema } from "../src/store/schema.ts";
import { backupSqlite, main, restoreSqlite, verifySqlite } from "../src/store/backup.ts";

function withTempDirectory(run: (directory: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), "luup-sqlite-backup-"));
  try {
    run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function createDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  createSchema(db);
  return db;
}

test("verify reports a healthy Luup database and checks every core table", () => {
  withTempDirectory((directory) => {
    const source = join(directory, "source.db");
    const db = createDatabase(source);
    db.close();

    const report = verifySqlite(source);

    assert.equal(report.ok, true);
    assert.deepEqual(report.integrityCheck, ["ok"]);
    assert.equal(report.foreignKeyErrors.length, 0);
    assert.deepEqual(
      report.tables.map((table) => table.name),
      ["runs", "attempts", "artifacts", "tool_evidence", "events", "batch_manifests", "batch_manifest_records"],
    );
    assert.ok(report.tables.every((table) => table.ok));
  });
});

test("verify keeps missing core tables visible as a failed check", () => {
  withTempDirectory((directory) => {
    const source = join(directory, "incomplete.db");
    const db = createDatabase(source);
    db.exec("DROP TABLE events");
    db.close();

    const report = verifySqlite(source);

    assert.equal(report.ok, false);
    assert.ok(report.issues.includes("missing_table:events"));
    assert.equal(report.tables.find((table) => table.name === "events")?.ok, false);
  });
});

test("backup captures committed WAL facts and refuses to overwrite an existing target", () => {
  withTempDirectory((directory) => {
    const source = join(directory, "source.db");
    const target = join(directory, "backup.db");
    const db = createDatabase(source);
    db.prepare(
      "INSERT INTO runs(id, question, status, version, budget_json, created_at, updated_at) VALUES(?, ?, 'running', 0, '{}', ?, ?)",
    ).run("wal-run", "fact committed in wal", "2026-08-22T00:00:00.000Z", "2026-08-22T00:00:00.000Z");
    assert.ok(statSync(`${source}-wal`).size > 0);

    const report = backupSqlite(source, target);
    assert.equal(report.verification.ok, true);
    assert.equal(verifySqlite(target).ok, true);

    const copy = new DatabaseSync(target, { readOnly: true });
    assert.deepEqual(
      { ...copy.prepare("SELECT question FROM runs WHERE id = 'wal-run'").get() },
      {
        question: "fact committed in wal",
      },
    );
    copy.close();
    db.close();

    writeFileSync(target, "do not overwrite");
    assert.throws(() => backupSqlite(source, target), /destination already exists/);
    assert.equal(readFileSync(target, "utf8"), "do not overwrite");
  });
});

test("restore only creates a new target and verifies the restored database", () => {
  withTempDirectory((directory) => {
    const source = join(directory, "source.db");
    const backup = join(directory, "backup.db");
    const restored = join(directory, "restored", "runs.db");
    const db = createDatabase(source);
    db.prepare(
      "INSERT INTO runs(id, question, status, version, budget_json, created_at, updated_at) VALUES(?, ?, 'completed', 0, '{}', ?, ?)",
    ).run("restore-run", "restored fact", "2026-08-22T00:00:00.000Z", "2026-08-22T00:00:00.000Z");
    db.close();
    backupSqlite(source, backup);

    const report = restoreSqlite(backup, restored);
    assert.equal(report.verification.ok, true);
    assert.equal(existsSync(restored), true);
    assert.deepEqual(verifySqlite(restored).issues, []);

    const copy = new DatabaseSync(restored, { readOnly: true });
    assert.deepEqual(
      { ...copy.prepare("SELECT question FROM runs WHERE id = 'restore-run'").get() },
      {
        question: "restored fact",
      },
    );
    copy.close();

    writeFileSync(restored, "do not overwrite");
    assert.throws(() => restoreSqlite(backup, restored), /destination already exists/);
    assert.equal(readFileSync(restored, "utf8"), "do not overwrite");
  });
});

test("CLI verify returns a non-zero result for a missing database", () => {
  withTempDirectory((directory) => {
    const source = join(directory, "missing.db");
    assert.equal(main(["verify", "--source", source]), 1);
  });
});

test("CLI fails closed when paths are missing and does not create an implicit database", () => {
  withTempDirectory((directory) => {
    const before = readdirSync(directory);
    assert.equal(main(["backup"]), 2);
    assert.equal(main(["restore", "--source", join(directory, "backup.db")]), 2);
    assert.equal(main(["verify"]), 2);
    assert.deepEqual(readdirSync(directory), before);
  });
});
