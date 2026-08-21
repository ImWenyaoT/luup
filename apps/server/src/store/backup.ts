import { lstatSync, mkdirSync, statSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { Database } from "bun:sqlite";

type TableDefinition = {
  name: string;
  columns: readonly string[];
};

export type TableCheck = {
  name: string;
  present: boolean;
  ok: boolean;
  missingColumns: string[];
};

export type SqliteVerification = {
  path: string;
  ok: boolean;
  integrityCheck: string[];
  foreignKeyErrors: string[];
  tables: TableCheck[];
  issues: string[];
};

export type SqliteSnapshot = {
  source: string;
  destination: string;
  bytes: number;
  verification: SqliteVerification;
};

/** These tables are the durable Luup fact surface, not an arbitrary SQLite schema. */
const CORE_TABLES: readonly TableDefinition[] = [
  {
    name: "runs",
    columns: [
      "id",
      "question",
      "status",
      "current_role",
      "version",
      "budget_json",
      "error_code",
      "final_artifact_id",
      "science125_id",
      "source_identity_json",
      "memory_arm",
      "created_at",
      "updated_at",
    ],
  },
  {
    name: "attempts",
    columns: [
      "id",
      "run_id",
      "role",
      "ordinal",
      "status",
      "corrections",
      "failure_code",
      "error_type",
      "started_at",
      "finished_at",
    ],
  },
  {
    name: "artifacts",
    columns: ["id", "run_id", "attempt_id", "type", "content_json", "input_artifact_ids_json", "created_at"],
  },
  {
    name: "tool_evidence",
    columns: ["id", "attempt_id", "tool_name", "query", "output_json", "status", "created_at"],
  },
  {
    name: "events",
    columns: ["id", "run_id", "version", "kind", "payload_json", "created_at"],
  },
  {
    name: "batch_manifests",
    columns: ["id", "expected_ids_json", "created_at"],
  },
  {
    name: "batch_manifest_records",
    columns: ["id", "manifest_id", "question_id", "status", "run_id", "created_at"],
  },
];

function emptyTableChecks(): TableCheck[] {
  return CORE_TABLES.map((table) => ({
    name: table.name,
    present: false,
    ok: false,
    missingColumns: [...table.columns],
  }));
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isMissingEntry(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
}

function entryExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (isMissingEntry(error)) return false;
    throw error;
  }
}

function filesystemPath(input: string): string {
  if (!input || input === ":memory:") throw new Error("filesystem database path is required");
  return resolve(input);
}

function quoteSqliteString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function destinationIsAvailable(path: string): void {
  for (const candidate of [path, `${path}-wal`, `${path}-shm`]) {
    if (entryExists(candidate)) throw new Error(`destination already exists: ${candidate}`);
  }
}

function removeCreatedDatabase(path: string): void {
  for (const candidate of [path, `${path}-wal`, `${path}-shm`]) {
    try {
      unlinkSync(candidate);
    } catch (error) {
      if (!isMissingEntry(error)) throw error;
    }
  }
}

function tableChecks(db: Database): TableCheck[] {
  const tableRows = db.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name?: unknown }>;
  const existing = new Set(tableRows.map((row) => (typeof row.name === "string" ? row.name : "")));
  return CORE_TABLES.map((table) => {
    if (!existing.has(table.name)) {
      return { name: table.name, present: false, ok: false, missingColumns: [...table.columns] };
    }
    const columns = new Set(
      (db.query(`PRAGMA table_info(${quoteSqliteString(table.name)})`).all() as Array<{ name?: unknown }>).map((row) =>
        typeof row.name === "string" ? row.name : "",
      ),
    );
    const missingColumns = table.columns.filter((column) => !columns.has(column));
    return { name: table.name, present: true, ok: missingColumns.length === 0, missingColumns: [...missingColumns] };
  });
}

function pragmaValues(db: Database, pragma: string): string[] {
  return (db.query(`PRAGMA ${pragma}`).all() as Array<Record<string, unknown>>).map((row) => {
    const value = Object.values(row)[0];
    return typeof value === "string" ? value : JSON.stringify(value);
  });
}

/** Verify SQLite integrity and the schema needed to read Luup facts. This never writes the database. */
export function verifySqlite(databasePath: string): SqliteVerification {
  const path = filesystemPath(databasePath);
  if (!entryExists(path)) {
    return {
      path,
      ok: false,
      integrityCheck: [],
      foreignKeyErrors: [],
      tables: emptyTableChecks(),
      issues: ["database_not_found"],
    };
  }

  let db: Database | null = null;
  try {
    db = new Database(path, { readonly: true });
    db.exec("PRAGMA busy_timeout = 5000");
    const integrityCheck = pragmaValues(db, "integrity_check");
    const foreignKeyErrors = (db.query("PRAGMA foreign_key_check").all() as Array<Record<string, unknown>>).map((row) =>
      JSON.stringify(row),
    );
    const tables = tableChecks(db);
    const issues: string[] = [];
    if (integrityCheck.length !== 1 || integrityCheck[0] !== "ok") issues.push("integrity_check_failed");
    if (foreignKeyErrors.length > 0) issues.push("foreign_key_check_failed");
    for (const table of tables) {
      if (!table.present) issues.push(`missing_table:${table.name}`);
      else if (table.missingColumns.length > 0) {
        issues.push(`missing_columns:${table.name}:${table.missingColumns.join(",")}`);
      }
    }
    return { path, ok: issues.length === 0, integrityCheck, foreignKeyErrors, tables, issues };
  } catch (error) {
    return {
      path,
      ok: false,
      integrityCheck: [],
      foreignKeyErrors: [],
      tables: emptyTableChecks(),
      issues: [`database_open_failed:${describe(error)}`],
    };
  } finally {
    try {
      db?.close();
    } catch {
      // Verification already has a durable result; a close error must not hide it.
    }
  }
}

function requireVerified(path: string, label: string): SqliteVerification {
  const verification = verifySqlite(path);
  if (!verification.ok) throw new Error(`${label} verification failed: ${verification.issues.join(", ")}`);
  return verification;
}

function createSnapshot(sourcePath: string, destinationPath: string, operation: "backup" | "restore"): SqliteSnapshot {
  const source = filesystemPath(sourcePath);
  const destination = filesystemPath(destinationPath);
  if (source === destination) throw new Error("source and destination must differ");
  if (!entryExists(source)) throw new Error(`source database does not exist: ${source}`);
  requireVerified(source, "source");
  destinationIsAvailable(destination);
  mkdirSync(dirname(destination), { recursive: true });

  let created = false;
  let db: Database | null = null;
  try {
    // VACUUM INTO asks SQLite for a transactionally consistent image and includes
    // committed pages still residing in the source connection's WAL.
    db = new Database(source, { readonly: true });
    db.exec("PRAGMA busy_timeout = 5000");
    db.exec(`VACUUM INTO ${quoteSqliteString(destination)}`);
    created = entryExists(destination);
    const verification = requireVerified(destination, operation === "backup" ? "backup" : "restored database");
    return {
      source,
      destination,
      bytes: statSync(destination).size,
      verification,
    };
  } catch (error) {
    if (!created) created = entryExists(destination);
    if (created) removeCreatedDatabase(destination);
    throw error;
  } finally {
    try {
      db?.close();
    } catch {
      // Preserve the operation error or result; the snapshot has already been verified.
    }
  }
}

/** Create a new, non-overwriting SQLite snapshot. */
export function backupSqlite(sourcePath: string, destinationPath: string): SqliteSnapshot {
  return createSnapshot(sourcePath, destinationPath, "backup");
}

/** Restore a verified snapshot into a new path; existing files and sidecars are never overwritten. */
export function restoreSqlite(sourcePath: string, destinationPath: string): SqliteSnapshot {
  return createSnapshot(sourcePath, destinationPath, "restore");
}

function printUsage(): void {
  process.stderr.write(
    "用法：bun run db:backup -- --source <db> --target <backup>\n" +
      "      bun run db:verify -- --source <db>\n" +
      "      bun run db:restore -- --source <backup> --target <db>\n",
  );
}

/** CLI seam. It fails closed before opening/creating any database when arguments are incomplete. */
export function main(argv: string[] = process.argv.slice(2)): number {
  const [operation, ...args] = argv;
  if (operation !== "backup" && operation !== "verify" && operation !== "restore") {
    printUsage();
    return 2;
  }
  let values: { source?: string; target?: string };
  try {
    values = parseArgs({
      args,
      options: {
        source: { type: "string" },
        target: { type: "string" },
      },
      strict: true,
      allowPositionals: false,
    }).values;
  } catch (error) {
    process.stderr.write(`[db:${operation}] ${describe(error)}\n`);
    return 2;
  }

  if (!values.source || (operation !== "verify" && !values.target)) {
    printUsage();
    return 2;
  }

  try {
    if (operation === "verify") {
      const report = verifySqlite(values.source);
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      return report.ok ? 0 : 1;
    }
    const report =
      operation === "backup"
        ? backupSqlite(values.source, values.target!)
        : restoreSqlite(values.source, values.target!);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`[db:${operation}] ${describe(error)}\n`);
    return 1;
  }
}

if (import.meta.main) process.exitCode = main();
