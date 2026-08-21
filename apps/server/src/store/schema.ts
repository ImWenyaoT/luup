import type { Database } from "bun:sqlite";

export const RUN_STATUSES = ["running", "completed", "review_rejected", "failed"] as const;
export const ATTEMPT_STATUSES = ["running", "completed", "failed"] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];

/** 全库唯一的时间戳来源。
 *
 * JS 原生 ISO（毫秒 + `Z`），与 Python 的微秒 + `+00:00` 不兼容 —— 新库不与旧库互读。
 * 毫秒精度下同一毫秒的多条记录会并列，所以按时间排序的查询一律带 rowid 兜底。
 */
export function nowIso(): string {
  return new Date().toISOString();
}

/** 五张表，够记清「谁在什么时候、基于哪些冻结输入、产出了什么、查过什么」。
 *
 * 这里曾经是 12 张表，含 task_dependencies / successor_of / command_receipts /
 * science125_items 等等 —— 那是 Python 版为任意 DAG、多进程跑批和生产级恢复
 * （resume / retry / cancel）准备的。Luup 只有固定五阶段加两个有界回路，
 * 「下一个角色是谁」写在 harness 的控制流里比写成依赖图更能说明问题，
 * 所以那一层整个删掉了。留下的都是可审计性真正需要的。
 */
const DDL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  question TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'review_rejected', 'failed')),
  current_role TEXT,
  version INTEGER NOT NULL DEFAULT 0,
  -- 兼容迁移分支早期创建的 TypeScript 数据库；不再承诺未执行的 RunBudget 接口。
  budget_json TEXT NOT NULL DEFAULT '{}',
  error_code TEXT,
  final_artifact_id TEXT,
  -- 这个 Run 跑的是 Science-125 第几题；自由输入为 NULL。断点续跑只认它。
  science125_id INTEGER,
  -- 哪个 build 产出了这个 Run（git commit + 工作树是否脏）；取不到时为 NULL。
  source_identity_json TEXT,
  -- 消融臂标签：'on' / 'off'。只有批跑发的 run 属于某一臂；单跑（HTTP/canary）为 NULL，
  -- 它们不进 2×2 表，把它们标成 on 会往配对里掺没有对照的样本。
  memory_arm TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 一个业务 Attempt = 一次 runTask。SDK 内部的 model/tool turn 不升级成 Attempt；
-- 同一个 Attempt 内的结构化纠错记在 corrections 上，不虚增计数。
CREATE TABLE IF NOT EXISTS attempts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  role TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'failed')),
  corrections INTEGER NOT NULL DEFAULT 0,
  failure_code TEXT,
  error_type TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  UNIQUE(run_id, role, ordinal)
);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  attempt_id TEXT NOT NULL UNIQUE REFERENCES attempts(id),
  type TEXT NOT NULL,
  content_json TEXT NOT NULL,
  input_artifact_ids_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- 一条 = 一次检索事件。一次检索可以挂多条 citation，它们共享同一个 evidence_id。
CREATE TABLE IF NOT EXISTS tool_evidence (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL REFERENCES attempts(id),
  tool_name TEXT NOT NULL,
  query TEXT NOT NULL,
  output_json TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- version 是 per-run 单调序号，既是事件顺序也是 SSE 游标。
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES runs(id),
  version INTEGER NOT NULL,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(run_id, version)
);

-- A batch manifest is the durable expected set for one Science-125 execution.
-- Records intentionally have no uniqueness constraint: a duplicate is evidence of
-- an invalid batch and must remain visible to the completeness gate, not be ignored.
CREATE TABLE IF NOT EXISTS batch_manifests (
  id TEXT PRIMARY KEY,
  expected_ids_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS batch_manifest_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  manifest_id TEXT NOT NULL REFERENCES batch_manifests(id),
  question_id INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('success', 'partial', 'failure', 'human_review')),
  run_id TEXT,
  created_at TEXT NOT NULL
);
`;

/** 后加的列。`CREATE TABLE IF NOT EXISTS` 对已存在的库是空操作，只补列这一条路。 */
const ADDED_RUN_COLUMNS: ReadonlyArray<[string, string]> = [
  ["science125_id", "INTEGER"],
  ["source_identity_json", "TEXT"],
  ["memory_arm", "TEXT"],
];

export function createSchema(db: Database): void {
  db.exec(DDL);
  // 只补列、不改列、不删列：批跑要能接着跑迁移期已经建好的库，
  // 而 runs 里已经落盘的事实不因为加了两列就重写。
  const existing = new Set(
    (db.prepare("PRAGMA table_info(runs)").all() as Array<{ name: string }>).map((column) => column.name),
  );
  for (const [name, type] of ADDED_RUN_COLUMNS) {
    if (!existing.has(name)) db.exec(`ALTER TABLE runs ADD COLUMN ${name} ${type}`);
  }
}
