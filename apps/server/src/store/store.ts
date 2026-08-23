import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { DomainArtifact, Role } from "../agent/contracts.ts";
import type { EvidenceRecord } from "../agent/evidence.ts";
import {
  BATCH_TERMINAL_STATUSES,
  type BatchTerminalRecord,
  type BatchTerminalStatus,
  type StoredBatchManifest,
} from "../batch/manifest.ts";
import type { MemoryArm, SourceIdentity, StoredInput, UsageFacts } from "../agent/contracts.ts";
import { createSchema, nowIso, type RunStatus } from "./schema.ts";

type Row = Record<string, any>;

export type StoredEvent = {
  id: number;
  version: number;
  kind: string;
  payload: Record<string, unknown>;
  created_at: string;
};

export type StoredArtifact = {
  id: string;
  type: DomainArtifact["artifact_type"];
  content: DomainArtifact;
};

export type ResearcherFeedback = { id: string; text: string; round: 1 };

export class FeedbackSubmissionError extends Error {
  readonly code: "invalid" | "conflict" | "not_found";

  constructor(code: FeedbackSubmissionError["code"], message: string) {
    super(message);
    this.name = "FeedbackSubmissionError";
    this.code = code;
  }
}

/** The durable facts a batch manifest needs in order to validate one record. */
export type BatchRunFacts = {
  runId: string;
  science125Id: number | null;
  status: RunStatus;
  errorCode: string | null;
  sourceIdentity: SourceIdentity | null;
  memoryArm: MemoryArm | null;
};

const shortId = () => randomUUID().replaceAll("-", "");
export const MAX_QUESTION_LENGTH = 4_000;
const batchTerminalStatuses = new Set<string>(BATCH_TERMINAL_STATUSES);

/** 只提交已经写入的拒绝诊断，再把状态转换错误抛还调用方。 */
class RejectedTransition extends Error {}

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
    } catch {
      // 幂等关闭，已经关闭时不抛
    } finally {
      if (this.#lockDb) {
        try {
          this.#lockDb.exec("ROLLBACK");
          this.#lockDb.close();
        } catch {
          // 进程退出时锁会被 OS 回收，不抛
        }
      }
    }
  }

  /**
   * Read-only process readiness probe.
   *
   * Liveness only proves that the server is answering HTTP. Deployment health checks
   * also need to distinguish a closed/corrupt SQLite handle from a live
   * process, without creating a Run or mutating the fact store.
   */
  isReady(): boolean {
    try {
      this.#db.prepare("SELECT 1").get();
      return true;
    } catch {
      return false;
    }
  }

  #write<T>(fn: (db: DatabaseSync) => T): T {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn(this.#db);
      this.#db.exec("COMMIT");
      return result;
    } catch (error) {
      if (error instanceof RejectedTransition) {
        this.#db.exec("COMMIT");
        throw error;
      }
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
      for (const run of runs) failRunInPlace(db, String(run.id), "interrupted", "ProcessRestart");
    });
  }

  /** 给一个没人再会回来收尾的 Run 补一个终态。
   *
   * 批跑取消一道超时的题之后，那个 Run 可能停在 running 上：执行流被放弃了，
   * 没有任何人还会走到 finishRun。批跑是唯一在场的证人，所以由它落终态。
   *
   * **已经终态的 Run 一律不动**（对齐 Python `_settle_timeout` 的 merge 语义）：
   * 取消也可能正好赶上 Run 自己收尾，那份结果是它自己的事实，重写只会丢信息。
   * 返回值表示这次调用是否真的补了终态。
   */
  settleAbandonedRun(runId: string, failureCode: string, errorType = "BatchTimeout"): boolean {
    return this.#write((db) => {
      const run = db.prepare("SELECT status FROM runs WHERE id = ?").get(runId) as Row | undefined;
      if (run?.status !== "running") return false;
      failRunInPlace(db, runId, failureCode, errorType);
      return true;
    });
  }

  /** 建 Run。题号、sourceIdentity 与消融臂都是可选的**出身**信息：自由输入没有题号，
   *  取不到 git 就写 NULL，批跑之外的 run 不属于任何一臂 —— 记不下出身绝不能让一个
   *  花了钱的 Run 起不来。 */
  createRun(
    question: string,
    origin: {
      science125Id?: number | null;
      sourceIdentity?: SourceIdentity | null;
      memoryArm?: MemoryArm | null;
    } = {},
  ): string {
    const normalized = normalizeQuestion(question);
    if (!normalized) throw new Error("question must not be empty");
    if (normalized.length > MAX_QUESTION_LENGTH) {
      throw new Error(`question must not exceed ${MAX_QUESTION_LENGTH} characters`);
    }
    const science125Id = origin.science125Id ?? null;
    if (science125Id !== null && !Number.isSafeInteger(science125Id)) {
      throw new Error("science125Id must be an integer");
    }
    return this.#write((db) => {
      const runId = shortId();
      const now = nowIso();
      db.prepare(
        "INSERT INTO runs(id, question, status, current_role, version, budget_json, error_code, " +
          "final_artifact_id, science125_id, source_identity_json, memory_arm, created_at, updated_at) " +
          "VALUES(?, ?, 'running', NULL, 0, '{}', NULL, NULL, ?, ?, ?, ?, ?)",
      ).run(
        runId,
        normalized,
        science125Id,
        origin.sourceIdentity ? JSON.stringify(origin.sourceIdentity) : null,
        origin.memoryArm ?? null,
        now,
        now,
      );
      emitEvent(db, runId, "run.created", { question: normalized });
      return runId;
    });
  }

  /** Create the durable expected set for one batch execution. */
  createBatchManifest(expectedIds: readonly number[]): string {
    if (expectedIds.length === 0) throw new Error("batch manifest requires at least one expected ID");
    if (expectedIds.some((id) => !Number.isSafeInteger(id) || id < 1)) {
      throw new Error("batch manifest expected IDs must be positive safe integers");
    }
    return this.#write((db) => {
      const id = shortId();
      db.prepare("INSERT INTO batch_manifests(id, expected_ids_json, created_at) VALUES(?, ?, ?)").run(
        id,
        JSON.stringify(expectedIds),
        nowIso(),
      );
      return id;
    });
  }

  /** Append a terminal fact. Duplicates are intentionally retained for the gate to expose. */
  recordBatchManifest(
    manifestId: string,
    record: { questionId: number; status: BatchTerminalStatus; runId?: string | null },
  ): void {
    if (!Number.isSafeInteger(record.questionId) || record.questionId < 1) {
      throw new Error("batch manifest question ID must be a positive safe integer");
    }
    if (!batchTerminalStatuses.has(record.status)) {
      throw new Error(`invalid batch terminal status: ${record.status}`);
    }
    this.#write((db) => {
      const manifest = db.prepare("SELECT id FROM batch_manifests WHERE id = ?").get(manifestId) as Row | undefined;
      if (!manifest) throw new Error(`unknown batch manifest: ${manifestId}`);
      db.prepare(
        "INSERT INTO batch_manifest_records(manifest_id, question_id, status, run_id, created_at) VALUES(?, ?, ?, ?, ?)",
      ).run(manifestId, record.questionId, record.status, record.runId ?? null, nowIso());
    });
  }

  /** Repair one invalid record while reopening a manifest; valid duplicates remain append-only evidence. */
  replaceBatchManifestRecord(
    manifestId: string,
    record: { questionId: number; status: BatchTerminalStatus; runId?: string | null },
  ): void {
    if (!Number.isSafeInteger(record.questionId) || record.questionId < 1) {
      throw new Error("batch manifest question ID must be a positive safe integer");
    }
    if (!batchTerminalStatuses.has(record.status)) {
      throw new Error(`invalid batch terminal status: ${record.status}`);
    }
    this.#write((db) => {
      const updated = db
        .prepare(
          "UPDATE batch_manifest_records SET status = ?, run_id = ?, created_at = ? " +
            "WHERE id = (SELECT id FROM batch_manifest_records WHERE manifest_id = ? AND question_id = ? ORDER BY id LIMIT 1)",
        )
        .run(record.status, record.runId ?? null, nowIso(), manifestId, record.questionId);
      if (Number(updated.changes) === 0)
        throw new Error(`unknown batch manifest record: ${manifestId}/${record.questionId}`);
    });
  }

  /** Read only raw manifest facts; the BatchManifest domain module derives the gate. */
  readBatchManifest(manifestId: string): StoredBatchManifest | null {
    const manifest = this.#get("SELECT id, expected_ids_json FROM batch_manifests WHERE id = ?", manifestId);
    if (!manifest) return null;
    const records = this.#all(
      "SELECT question_id, status, run_id FROM batch_manifest_records WHERE manifest_id = ? ORDER BY id",
      manifestId,
    ).map((row) => ({
      questionId: Number(row.question_id),
      status: String(row.status) as BatchTerminalStatus,
      runId: row.run_id === null ? null : String(row.run_id),
    })) satisfies BatchTerminalRecord[];
    return {
      id: String(manifest.id),
      expectedIds: JSON.parse(String(manifest.expected_ids_json)) as number[],
      records,
    };
  }

  /** 断点续跑的唯一判据：这道题是否已经有一个 completed 的 Run。
   *
   * 只认 `completed`。`review_rejected` 是模型没能交出可接受的计划，重跑有意义；
   * 只有真正交付过的题才是「已经付过钱」的题。
   */
  completedRunForQuestion(science125Id: number): string | null {
    const row = this.#get(
      "SELECT id FROM runs WHERE science125_id = ? AND status = 'completed' " +
        "ORDER BY created_at DESC, rowid DESC LIMIT 1",
      science125Id,
    );
    return row ? String(row.id) : null;
  }

  /**
   * 续跑/消融的唯一 skip 判据：completed Run 必须属于同一 memory arm。
   *
   * `completedRunForQuestion` 保留给非批跑的历史查询；批跑不能把 on 当成
   * off（或把无臂的单跑当成任一实验臂），否则两臂无法形成可解释的配对。
   */
  completedRunForQuestionInArm(science125Id: number, memoryArm: MemoryArm | null): string | null {
    const row = this.#get(
      "SELECT id FROM runs WHERE science125_id = ? AND status = 'completed' AND memory_arm IS ? " +
        "ORDER BY created_at DESC, rowid DESC LIMIT 1",
      science125Id,
      memoryArm,
    );
    return row ? String(row.id) : null;
  }

  /** Read the terminal facts for a manifest record without exposing the raw run row. */
  batchRunFacts(runId: string): BatchRunFacts | null {
    const row = this.#get(
      "SELECT id, science125_id, status, error_code, source_identity_json, memory_arm FROM runs WHERE id = ?",
      runId,
    );
    if (!row) return null;
    return {
      runId: String(row.id),
      science125Id: typeof row.science125_id === "number" ? row.science125_id : null,
      status: String(row.status) as RunStatus,
      errorCode: row.error_code === null ? null : String(row.error_code),
      sourceIdentity: parseSourceIdentity(row.source_identity_json),
      memoryArm: row.memory_arm === "on" || row.memory_arm === "off" ? row.memory_arm : null,
    };
  }

  /** 这个 Run 跑的是第几题。自由输入没有题号，返回 null —— 战役记忆按题分页，没题号就不分页。 */
  science125Id(runId: string): number | null {
    const row = this.#get("SELECT science125_id FROM runs WHERE id = ?", runId);
    const value = row?.science125_id;
    return typeof value === "number" ? value : null;
  }

  question(runId: string): string {
    const row = this.#get("SELECT question FROM runs WHERE id = ?", runId);
    if (!row) throw new Error(`unknown run: ${runId}`);
    return row.question;
  }

  /** 人工意见只在首轮 Reviewer 执行期间排队；Harness 在决定终止前读取。 */
  submitResearcherFeedback(runId: string, input: { id: string; text: string }): ResearcherFeedback {
    const id = input.id.trim();
    const text = input.text.trim();
    if (id === "" || id.length > 128 || !/^[A-Za-z0-9_-]+$/.test(id)) {
      throw new FeedbackSubmissionError("invalid", "feedback_id must be 1-128 letters, digits, _ or -");
    }
    if (text === "" || text.length > 2_000) {
      throw new FeedbackSubmissionError("invalid", "feedback must be 1-2000 characters");
    }
    return this.#write((db) => {
      const run = db.prepare("SELECT status FROM runs WHERE id = ?").get(runId) as Row | undefined;
      if (!run) throw new FeedbackSubmissionError("not_found", `unknown run: ${runId}`);
      if (run.status !== "running") {
        throw new FeedbackSubmissionError("conflict", `cannot submit feedback to ${String(run.status)} run`);
      }
      const active = db
        .prepare("SELECT role, ordinal FROM attempts WHERE run_id = ? AND status = 'running'")
        .get(runId) as Row | undefined;
      if (active?.role !== "reviewer" || Number(active.ordinal) !== 1) {
        throw new FeedbackSubmissionError("conflict", "feedback is only accepted during the first reviewer attempt");
      }
      const feedbackEvents = (
        db
          .prepare("SELECT payload_json FROM events WHERE run_id = ? AND kind = 'feedback.received' ORDER BY version")
          .all(runId) as Row[]
      ).map((row) => JSON.parse(String(row.payload_json)) as Record<string, unknown>);
      if (feedbackEvents.some((payload) => payload.feedback_source === "human")) {
        throw new FeedbackSubmissionError("conflict", "researcher feedback already queued");
      }
      const feedback: ResearcherFeedback = { id, text, round: 1 };
      emitEvent(db, runId, "feedback.received", {
        source: "researcher",
        feedback_source: "human",
        target: "research-plan",
        round: 1,
        action: "revise",
        feedback_count: 1,
        feedback_artifact_id: null,
        feedback_id: id,
        feedback: text,
        retry_reason: "researcher_requested_revision",
        stop_reason: null,
        rollback_reason: null,
      });
      return feedback;
    });
  }

  researcherFeedback(runId: string, round: number): ResearcherFeedback | null {
    const events = this.eventsAfter(runId, 0);
    for (const event of events) {
      if (
        event.kind === "feedback.received" &&
        event.payload.feedback_source === "human" &&
        event.payload.round === round &&
        typeof event.payload.feedback_id === "string" &&
        typeof event.payload.feedback === "string"
      ) {
        return { id: event.payload.feedback_id, text: event.payload.feedback, round: 1 };
      }
    }
    return null;
  }

  startAttempt(runId: string, role: Role): string {
    return this.#write((db) => {
      const run = db.prepare("SELECT status FROM runs WHERE id = ?").get(runId) as Row | undefined;
      if (!run) throw new Error(`unknown run: ${runId}`);
      if (run.status !== "running") {
        emitEvent(db, runId, "attempt.transition_rejected", {
          action: "start_attempt",
          attempt_status: null,
          run_status: run.status,
        });
        throw new RejectedTransition(`cannot start ${role} attempt on ${run.status} run ${runId}`);
      }
      const active = db.prepare("SELECT id FROM attempts WHERE run_id = ? AND status = 'running'").get(runId) as
        | Row
        | undefined;
      if (active) {
        emitEvent(db, runId, "attempt.transition_rejected", {
          action: "start_attempt",
          attempt_status: "running",
          run_status: "running",
        });
        throw new RejectedTransition(`run ${runId} already has running attempt ${String(active.id)}`);
      }
      const count = db
        .prepare("SELECT COUNT(*) AS n FROM attempts WHERE run_id = ? AND role = ?")
        .get(runId, role) as Row;
      const ordinal = Number(count.n) + 1;
      const attemptId = shortId();
      const now = nowIso();
      db.prepare(
        "INSERT INTO attempts(id, run_id, role, ordinal, status, corrections, failure_code, " +
          "error_type, started_at, finished_at) VALUES(?, ?, ?, ?, 'running', 0, NULL, NULL, ?, NULL)",
      ).run(attemptId, runId, role, ordinal, now);
      db.prepare("UPDATE runs SET current_role = ?, updated_at = ? WHERE id = ?").run(role, now, runId);
      emitEvent(db, runId, "attempt.started", { role, ordinal });
      emitEvent(db, runId, "subagent.started", {
        subagent_id: attemptId,
        parent_run_id: runId,
        role,
        ordinal,
      });
      return attemptId;
    });
  }

  /** 成功的 Attempt 落库。
   *
   * `usage` 与 `failAttempt` 那一份是同一件事的两半：一个业务 Attempt 至多一条
   * `sdk.usage`，成败同一形状、同一位置（在终态事件之前）。成功路径也必须记 ——
   * 一次运行里绝大多数 token 都烧在成功的阶段上，只记失败等于把成本账倒过来看。
   */
  publishArtifact(
    runId: string,
    attemptId: string,
    artifact: DomainArtifact,
    inputs: StoredInput[],
    corrections: number,
    usage: UsageFacts | null = null,
  ): StoredArtifact {
    return this.#write((db) => {
      const run = db.prepare("SELECT status FROM runs WHERE id = ?").get(runId) as Row | undefined;
      if (!run) throw new Error(`unknown run: ${runId}`);
      const attempt = db
        .prepare("SELECT role, status FROM attempts WHERE id = ? AND run_id = ?")
        .get(attemptId, runId) as Row | undefined;
      if (!attempt) throw new Error(`unknown attempt: ${attemptId}`);
      if (run.status !== "running" || attempt.status !== "running") {
        emitEvent(db, runId, "attempt.transition_rejected", {
          action: "publish_artifact",
          attempt_status: attempt.status,
          run_status: run.status,
        });
        throw new RejectedTransition(`cannot publish from ${attempt.status} attempt on ${run.status} run`);
      }
      const artifactId = shortId();
      const now = nowIso();
      if (usage) {
        emitEvent(db, runId, "sdk.usage", {
          agent: usage.agent,
          input_tokens: usage.inputTokens,
          output_tokens: usage.outputTokens,
          total_tokens: usage.totalTokens,
        });
      }
      db.prepare(
        "INSERT INTO artifacts(id, run_id, attempt_id, type, content_json, input_artifact_ids_json, " +
          "created_at) VALUES(?, ?, ?, ?, ?, ?, ?)",
      ).run(
        artifactId,
        runId,
        attemptId,
        artifact.artifact_type,
        JSON.stringify(artifact),
        JSON.stringify(inputs.map((item) => item.id)),
        now,
      );
      db.prepare("UPDATE attempts SET status = 'completed', corrections = ?, finished_at = ? WHERE id = ?").run(
        corrections,
        now,
        attemptId,
      );
      if (corrections > 0) {
        emitEvent(db, runId, "sdk.structured_correction", { corrections });
      }
      emitEvent(db, runId, "artifact.published", { artifact_type: artifact.artifact_type });
      emitEvent(db, runId, "subagent.ended", {
        subagent_id: attemptId,
        role: attempt.role,
        status: "completed",
        failure_code: null,
      });
      return { id: artifactId, type: artifact.artifact_type, content: artifact };
    });
  }

  /** 失败的 Attempt 也要记账。
   *
   * `usage` 是这次 Attempt **已经发生**的用量：调用失败不等于没花钱，不记就等于
   * 把失败的成本从账上抹掉，跑完 125 题算总账时差的正是这一块。拿不到就传 null，
   * 绝不用零顶替 —— 零是「确实没花」，缺失是「不知道」。
   */
  failAttempt(
    runId: string,
    attemptId: string,
    failure: { code: string; reason: string },
    errorType: string,
    corrections: number,
    usage: UsageFacts | null = null,
  ): void {
    this.#write((db) => {
      const run = db.prepare("SELECT status FROM runs WHERE id = ?").get(runId) as Row | undefined;
      if (!run) throw new Error(`unknown run: ${runId}`);
      const attempt = db
        .prepare("SELECT role, status FROM attempts WHERE id = ? AND run_id = ?")
        .get(attemptId, runId) as Row | undefined;
      if (!attempt) throw new Error(`unknown attempt: ${attemptId}`);
      if (run.status !== "running" || attempt.status !== "running") {
        emitEvent(db, runId, "attempt.transition_rejected", {
          action: "fail_attempt",
          attempt_status: attempt.status,
          run_status: run.status,
        });
        throw new RejectedTransition(`cannot fail ${attempt.status} attempt on ${run.status} run`);
      }
      const now = nowIso();
      if (usage) {
        emitEvent(db, runId, "sdk.usage", {
          agent: usage.agent,
          input_tokens: usage.inputTokens,
          output_tokens: usage.outputTokens,
          total_tokens: usage.totalTokens,
        });
      }
      db.prepare(
        "UPDATE attempts SET status = 'failed', corrections = ?, failure_code = ?, error_type = ?, " +
          "finished_at = ? WHERE id = ?",
      ).run(corrections, failure.code, errorType, now, attemptId);
      // reason 带的是校验器内部信息，只用于排障，投影层不放行它出网。
      emitEvent(db, runId, "sdk.output_rejected", { error_type: errorType, reason: failure.reason });
      emitEvent(db, runId, "attempt.failed", { failure_code: failure.code });
      emitEvent(db, runId, "subagent.ended", {
        subagent_id: attemptId,
        role: attempt.role,
        status: "failed",
        failure_code: failure.code,
      });
    });
  }

  /** 登记一次检索。ID 与全部字段都由代码写定，模型只能引用。 */
  recordEvidence(runId: string, attemptId: string, record: EvidenceRecord): void {
    this.#write((db) => {
      const attempt = db.prepare("SELECT status FROM attempts WHERE id = ? AND run_id = ?").get(attemptId, runId) as
        | Row
        | undefined;
      // Abort 后仍在收尾的工具可能晚到；Attempt 一旦终止，冻结审计不可再追加。
      if (attempt?.status !== "running") {
        emitEvent(db, runId, "tool.evidence_dropped", {
          tool_name: record.tool,
          status: record.status,
          reason: "attempt_not_running",
        });
        return;
      }
      db.prepare(
        "INSERT INTO tool_evidence(id, attempt_id, tool_name, query, output_json, status, created_at) " +
          "VALUES(?, ?, ?, ?, ?, ?, ?)",
      ).run(
        record.evidenceId,
        attemptId,
        record.tool,
        record.query,
        JSON.stringify({
          source_type: record.sourceType,
          result_summary: record.resultSummary,
          citations: record.citations,
        }),
        record.status,
        nowIso(),
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
      const run = db.prepare("SELECT status FROM runs WHERE id = ?").get(runId) as Row | undefined;
      if (!run) throw new Error(`unknown run: ${runId}`);
      // 终态是不可逆事实：取消/重启已经收尾后，迟到的执行流只能幂等忽略。
      if (run.status !== "running") {
        emitEvent(db, runId, "run.transition_rejected", {
          action: "finish_run",
          requested_status: status,
          run_status: run.status,
        });
        return;
      }
      const active = db
        .prepare("SELECT COUNT(*) AS n FROM attempts WHERE run_id = ? AND status = 'running'")
        .get(runId) as Row;
      if (Number(active.n) > 0) {
        emitEvent(db, runId, "run.transition_rejected", {
          action: "finish_run",
          requested_status: status,
          run_status: "running",
          reason: "active_attempts",
        });
        throw new RejectedTransition(`cannot finish run ${runId} with running attempts`);
      }
      if (status !== "completed" && options.finalArtifactId) {
        throw new Error(`${status} run cannot carry finalArtifactId`);
      }
      if (status === "completed") {
        const finalArtifactId = options.finalArtifactId;
        if (!finalArtifactId) throw new Error(`completed run ${runId} requires finalArtifactId`);
        const artifact = db
          .prepare(
            "SELECT a.id FROM artifacts a JOIN attempts t ON t.id = a.attempt_id " +
              "WHERE a.id = ? AND a.run_id = ? AND a.type = 'research-plan' AND t.status = 'completed'",
          )
          .get(finalArtifactId, runId) as Row | undefined;
        if (!artifact) throw new Error(`final artifact ${finalArtifactId} is not a completed artifact of run ${runId}`);
      }
      db.prepare(
        "UPDATE runs SET status = ?, current_role = NULL, final_artifact_id = ?, error_code = ?, " +
          "updated_at = ? WHERE id = ? AND status = 'running'",
      ).run(status, options.finalArtifactId ?? null, options.errorCode ?? null, nowIso(), runId);
      const eventKind =
        status === "completed" ? "run.completed" : status === "review_rejected" ? "run.review_rejected" : "run.failed";
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
  eventsAfter(runId: string, after: number): StoredEvent[] {
    return this.#all(
      "SELECT id, version, kind, payload_json, created_at FROM events " +
        "WHERE run_id = ? AND version > ? ORDER BY version",
      runId,
      after,
    ).map((row) => ({
      id: Number(row.id),
      version: Number(row.version),
      kind: String(row.kind),
      payload: JSON.parse(String(row.payload_json)) as Record<string, unknown>,
      created_at: String(row.created_at),
    }));
  }

  /** 这个 Run 最后一次发布的某类 Artifact。
   *
   * 战役记忆要记的是「这条路走成什么样」，不只是「有没有交付」：被引用验收否掉的计划，
   * 它的标题与引用同样值得下一次绕开，可它不会成为 final_artifact_id。
   */
  latestArtifact(runId: string, type: string): StoredArtifact | null {
    const row = this.#get(
      "SELECT id, type, content_json FROM artifacts WHERE run_id = ? AND type = ? " +
        "ORDER BY created_at DESC, rowid DESC LIMIT 1",
      runId,
      type,
    );
    if (!row) return null;
    return { id: row.id, type: row.type, content: JSON.parse(row.content_json) };
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
    const attempts = this.#all("SELECT * FROM attempts WHERE run_id = ? ORDER BY started_at, rowid", runId);
    const attemptIds = attempts.map((attempt) => attempt.id);
    const evidence =
      attemptIds.length === 0
        ? []
        : this.#all(
            `SELECT * FROM tool_evidence WHERE attempt_id IN (${attemptIds.map(() => "?").join(",")}) ` +
              "ORDER BY created_at, rowid",
            ...attemptIds,
          ).map((row) => ({ ...row, output: JSON.parse(row.output_json) }));
    const artifacts = this.#all("SELECT * FROM artifacts WHERE run_id = ? ORDER BY created_at, rowid", runId).map(
      (row) => ({
        ...row,
        content: JSON.parse(row.content_json),
        input_artifact_ids: JSON.parse(row.input_artifact_ids_json),
      }),
    );
    return {
      ...run,
      attempts,
      tool_evidence: evidence,
      artifacts,
      recent_events: this.eventsAfter(runId, 0),
    };
  }
}

function parseSourceIdentity(value: unknown): SourceIdentity | null {
  if (typeof value !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as Record<string, unknown>).gitCommit === "string" &&
      (parsed as Record<string, unknown>).gitCommit !== "" &&
      typeof (parsed as Record<string, unknown>).treeDirty === "boolean"
    ) {
      return {
        gitCommit: (parsed as Record<string, unknown>).gitCommit as string,
        treeDirty: (parsed as Record<string, unknown>).treeDirty as boolean,
      };
    }
  } catch {
    // Corrupt provenance is unknown; resume guards fail closed on null.
  }
  return null;
}

/** 把一个还在 running 的 Run 及其 Attempt 就地判失败。
 *
 * 两个调用方是同一件事的两种发生方式：进程重启（旧进程不会回来）和批跑取消
 * （执行流被放弃）。都必须留下和正常失败一样的证据，否则 API 与 SSE 会永远等下去。
 * 调用方负责先确认 Run 确实还在 running。
 */
function failRunInPlace(db: DatabaseSync, runId: string, failureCode: string, errorType: string): void {
  const now = nowIso();
  const attempts = db
    .prepare("SELECT id, role FROM attempts WHERE run_id = ? AND status = 'running'")
    .all(runId) as Row[];
  db.prepare(
    "UPDATE attempts SET status = 'failed', failure_code = ?, error_type = ?, finished_at = ? " +
      "WHERE run_id = ? AND status = 'running'",
  ).run(failureCode, errorType, now, runId);
  db.prepare("UPDATE runs SET status = 'failed', current_role = NULL, error_code = ?, updated_at = ? WHERE id = ?").run(
    failureCode,
    now,
    runId,
  );
  for (const attempt of attempts) {
    emitEvent(db, runId, "subagent.ended", {
      subagent_id: attempt.id,
      role: attempt.role,
      status: "failed",
      failure_code: failureCode,
    });
  }
  emitEvent(db, runId, "run.failed", { failure_code: failureCode, final_artifact_id: null });
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
function emitEvent(db: DatabaseSync, runId: string, kind: string, payload: Record<string, unknown>): number {
  const row = db.prepare("SELECT version FROM runs WHERE id = ?").get(runId) as Row | undefined;
  if (!row) throw new Error(`unknown run: ${runId}`);
  const version = Number(row.version) + 1;
  const now = nowIso();
  db.prepare("UPDATE runs SET version = ?, updated_at = ? WHERE id = ?").run(version, now, runId);
  db.prepare("INSERT INTO events(run_id, version, kind, payload_json, created_at) VALUES(?, ?, ?, ?, ?)").run(
    runId,
    version,
    kind,
    JSON.stringify(payload),
    now,
  );
  return version;
}
