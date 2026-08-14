import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { DomainArtifact, Role } from "../agent/contracts.ts";
import type { EvidenceRecord } from "../agent/evidence.ts";
import type { StoredInput } from "./contracts.ts";
import { createSchema, nowIso, type RunStatus } from "./schema.ts";

type Row = Record<string, any>;

export type StoredArtifact = {
  id: string;
  type: DomainArtifact["artifact_type"];
  content: DomainArtifact;
};

const shortId = () => randomUUID().replaceAll("-", "");
export const MAX_QUESTION_LENGTH = 4_000;

/** API 和直接调用 Harness 都用同一套问题规范化，避免两条入口的上限不一致。 */
export const normalizeQuestion = (question: string) => question.split(/\s+/).filter(Boolean).join(" ");

/** SQLite 持久化。
 *
 * `node:sqlite` 的 `DatabaseSync` 是同步的，和 Python 的 `sqlite3` 一样 —— 读路径可以
 * 一比一翻译，不用退化成 await 瀑布。零依赖。
 *
 * 这一层只管**记账**：谁在什么时候、基于哪些冻结输入、产出了什么、查过什么。
 * 「下一个角色是谁」不在这里，在 harness 的控制流里。
 */
export class SqliteStore {
  readonly #db: DatabaseSync;
  readonly #lockDb: DatabaseSync | null;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    // 文件名带上协议含义，避免把迁移分支早期的纯文本 `.lock` 当成 SQLite 打开。
    this.#lockDb = path === ":memory:" ? null : acquireLock(`${path}.writer-lock.db`);
    try {
      this.#db = new DatabaseSync(path);
      createSchema(this.#db);
      this.#failInterruptedRuns();
    } catch (error) {
      this.#lockDb?.close();
      throw error;
    }
  }

  close(): void {
    try {
      this.#db.close();
    } finally {
      if (this.#lockDb) {
        this.#lockDb.exec("ROLLBACK");
        this.#lockDb.close();
      }
    }
  }

  #write<T>(fn: (db: DatabaseSync) => T): T {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn(this.#db);
      this.#db.exec("COMMIT");
      return result;
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  #all(sql: string, ...params: unknown[]): Row[] {
    return this.#db.prepare(sql).all(...(params as any[])) as Row[];
  }

  #get(sql: string, ...params: unknown[]): Row | undefined {
    return this.#db.prepare(sql).get(...(params as any[])) as Row | undefined;
  }

  #failInterruptedRuns(): void {
    this.#write((db) => {
      const runs = db.prepare("SELECT id FROM runs WHERE status = 'running'").all() as Row[];
      if (runs.length === 0) return;

      // 这个 MVP 只跑一个 Node 进程。数据库重新打开时仍是 running 的记录，必然属于
      // 已经退出的旧进程；明确写成失败，避免 API 和 SSE 永远等一个不会回来的任务。
      const now = nowIso();
      for (const run of runs) {
        db.prepare(
          "UPDATE attempts SET status = 'failed', failure_code = 'interrupted', "
          + "error_type = 'ProcessRestart', finished_at = ? "
          + "WHERE run_id = ? AND status = 'running'",
        ).run(now, run.id);
        db.prepare(
          "UPDATE runs SET status = 'failed', current_role = NULL, error_code = 'interrupted', "
          + "updated_at = ? WHERE id = ?",
        ).run(now, run.id);
        emitEvent(db, run.id, "run.failed", {
          failure_code: "interrupted",
          final_artifact_id: null,
        });
      }
    });
  }

  createRun(question: string): string {
    const normalized = normalizeQuestion(question);
    if (!normalized) throw new Error("question must not be empty");
    if (normalized.length > MAX_QUESTION_LENGTH) {
      throw new Error(`question must not exceed ${MAX_QUESTION_LENGTH} characters`);
    }
    return this.#write((db) => {
      const runId = shortId();
      const now = nowIso();
      db.prepare(
        "INSERT INTO runs(id, question, status, current_role, version, budget_json, error_code, "
        + "final_artifact_id, created_at, updated_at) "
        + "VALUES(?, ?, 'running', NULL, 0, '{}', NULL, NULL, ?, ?)",
      ).run(runId, normalized, now, now);
      emitEvent(db, runId, "run.created", { question: normalized });
      return runId;
    });
  }

  question(runId: string): string {
    const row = this.#get("SELECT question FROM runs WHERE id = ?", runId);
    if (!row) throw new Error(`unknown run: ${runId}`);
    return row.question;
  }

  startAttempt(runId: string, role: Role): string {
    return this.#write((db) => {
      const count = db.prepare(
        "SELECT COUNT(*) AS n FROM attempts WHERE run_id = ? AND role = ?",
      ).get(runId, role) as Row;
      const ordinal = Number(count.n) + 1;
      const attemptId = shortId();
      const now = nowIso();
      db.prepare(
        "INSERT INTO attempts(id, run_id, role, ordinal, status, corrections, failure_code, "
        + "error_type, started_at, finished_at) VALUES(?, ?, ?, ?, 'running', 0, NULL, NULL, ?, NULL)",
      ).run(attemptId, runId, role, ordinal, now);
      db.prepare("UPDATE runs SET current_role = ?, updated_at = ? WHERE id = ?").run(role, now, runId);
      emitEvent(db, runId, "attempt.started", { role, ordinal });
      return attemptId;
    });
  }

  publishArtifact(
    runId: string,
    attemptId: string,
    artifact: DomainArtifact,
    inputs: StoredInput[],
    corrections: number,
  ): StoredArtifact {
    return this.#write((db) => {
      const artifactId = shortId();
      const now = nowIso();
      db.prepare(
        "INSERT INTO artifacts(id, run_id, attempt_id, type, content_json, input_artifact_ids_json, "
        + "created_at) VALUES(?, ?, ?, ?, ?, ?, ?)",
      ).run(
        artifactId, runId, attemptId, artifact.artifact_type,
        JSON.stringify(artifact), JSON.stringify(inputs.map((item) => item.id)), now,
      );
      db.prepare(
        "UPDATE attempts SET status = 'completed', corrections = ?, finished_at = ? WHERE id = ?",
      ).run(corrections, now, attemptId);
      if (corrections > 0) {
        emitEvent(db, runId, "sdk.structured_correction", { corrections });
      }
      emitEvent(db, runId, "artifact.published", { artifact_type: artifact.artifact_type });
      return { id: artifactId, type: artifact.artifact_type, content: artifact };
    });
  }

  failAttempt(
    runId: string,
    attemptId: string,
    failure: { code: string; reason: string },
    errorType: string,
    corrections: number,
  ): void {
    this.#write((db) => {
      const now = nowIso();
      db.prepare(
        "UPDATE attempts SET status = 'failed', corrections = ?, failure_code = ?, error_type = ?, "
        + "finished_at = ? WHERE id = ?",
      ).run(corrections, failure.code, errorType, now, attemptId);
      // reason 带的是校验器内部信息，只用于排障，投影层不放行它出网。
      emitEvent(db, runId, "sdk.output_rejected", { error_type: errorType, reason: failure.reason });
      emitEvent(db, runId, "attempt.failed", { failure_code: failure.code });
    });
  }

  /** 登记一次检索。ID 与全部字段都由代码写定，模型只能引用。 */
  recordEvidence(runId: string, attemptId: string, record: EvidenceRecord): void {
    this.#write((db) => {
      const attempt = db.prepare("SELECT status FROM attempts WHERE id = ? AND run_id = ?")
        .get(attemptId, runId) as Row | undefined;
      // Abort 后仍在收尾的工具可能晚到；Attempt 一旦终止，冻结审计不可再追加。
      if (attempt?.status !== "running") return;
      db.prepare(
        "INSERT INTO tool_evidence(id, attempt_id, tool_name, query, output_json, status, created_at) "
        + "VALUES(?, ?, ?, ?, ?, ?, ?)",
      ).run(
        record.evidenceId, attemptId, record.tool, record.query,
        JSON.stringify({
          source_type: record.sourceType,
          result_summary: record.resultSummary,
          citations: record.citations,
        }),
        record.status, nowIso(),
      );
      emitEvent(db, runId, "tool.evidence_recorded", {
        tool_name: record.tool,
        status: record.status,
        result_count: record.citations.length,
      });
    });
  }

  finishRun(runId: string, status: RunStatus, options: { finalArtifactId?: string; errorCode?: string } = {}): void {
    this.#write((db) => {
      db.prepare(
        "UPDATE runs SET status = ?, current_role = NULL, final_artifact_id = ?, error_code = ?, "
        + "updated_at = ? WHERE id = ?",
      ).run(status, options.finalArtifactId ?? null, options.errorCode ?? null, nowIso(), runId);
      const eventKind = status === "completed"
        ? "run.completed"
        : status === "review_rejected" ? "run.review_rejected" : "run.failed";
      emitEvent(db, runId, eventKind, {
        final_artifact_id: options.finalArtifactId ?? null,
        failure_code: options.errorCode ?? null,
      });
    });
  }

  emit(runId: string, kind: string, payload: Record<string, unknown>): number {
    return this.#write((db) => emitEvent(db, runId, kind, payload));
  }

  /** SSE 的数据源。游标是 per-run 的 version，开区间。 */
  eventsAfter(runId: string, after: number): Row[] {
    return this.#all(
      "SELECT id, version, kind, payload_json, created_at FROM events "
      + "WHERE run_id = ? AND version > ? ORDER BY version",
      runId, after,
    ).map((row) => ({
      id: row.id,
      version: row.version,
      kind: row.kind,
      payload: JSON.parse(row.payload_json),
      created_at: row.created_at,
    }));
  }

  artifact(artifactId: string): StoredArtifact | null {
    const row = this.#get("SELECT id, type, content_json FROM artifacts WHERE id = ?", artifactId);
    if (!row) return null;
    return { id: row.id, type: row.type, content: JSON.parse(row.content_json) };
  }

  /** 全 Run 的内部快照，是投影层的输入。含内部字段，不可直接出网。 */
  snapshot(runId: string): Row | null {
    const run = this.#get("SELECT * FROM runs WHERE id = ?", runId);
    if (!run) return null;
    const attempts = this.#all(
      "SELECT * FROM attempts WHERE run_id = ? ORDER BY started_at, rowid", runId,
    );
    const attemptIds = attempts.map((attempt) => attempt.id);
    const evidence = attemptIds.length === 0 ? [] : this.#all(
      `SELECT * FROM tool_evidence WHERE attempt_id IN (${attemptIds.map(() => "?").join(",")}) `
      + "ORDER BY created_at, rowid",
      ...attemptIds,
    ).map((row) => ({ ...row, output: JSON.parse(row.output_json) }));
    const artifacts = this.#all(
      "SELECT * FROM artifacts WHERE run_id = ? ORDER BY created_at, rowid", runId,
    ).map((row) => ({
      ...row,
      content: JSON.parse(row.content_json),
      input_artifact_ids: JSON.parse(row.input_artifact_ids_json),
    }));
    return {
      ...run,
      attempts,
      tool_evidence: evidence,
      artifacts,
      recent_events: this.eventsAfter(runId, 0),
    };
  }
}

/** 用 SQLite 自己的长事务做单写者锁；进程退出时 OS 会自动释放，不需要 PID 接管协议。 */
function acquireLock(path: string): DatabaseSync {
  const lock = new DatabaseSync(path);
  try {
    lock.exec("PRAGMA busy_timeout = 0; BEGIN EXCLUSIVE");
    return lock;
  } catch (error) {
    lock.close();
    throw error;
  }
}

/** 事件写入的唯一入口。version 是 per-run 单调序号，也是 SSE 游标。 */
function emitEvent(
  db: DatabaseSync,
  runId: string,
  kind: string,
  payload: Record<string, unknown>,
): number {
  const row = db.prepare("SELECT version FROM runs WHERE id = ?").get(runId) as Row | undefined;
  if (!row) throw new Error(`unknown run: ${runId}`);
  const version = Number(row.version) + 1;
  const now = nowIso();
  db.prepare("UPDATE runs SET version = ?, updated_at = ? WHERE id = ?").run(version, now, runId);
  db.prepare(
    "INSERT INTO events(run_id, version, kind, payload_json, created_at) VALUES(?, ?, ?, ?, ?)",
  ).run(runId, version, kind, JSON.stringify(payload), now);
  return version;
}
