import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { MemoryArm, SourceIdentity } from "../agent/contracts.ts";
import type { BatchRunFacts } from "../store/store.ts";

type LaunchIntent = {
  stage: "launch";
  questionIds: readonly number[] | null;
  dryRun: boolean;
  noMemory: boolean;
  manifestId: string | undefined;
  confirmedScience125: boolean;
  confirmedMemoryAblation: boolean;
  releaseCommit: string | undefined;
  repoRoot: string;
  databasePath: string;
  facts?: {
    sourceIdentity?: SourceIdentity | null;
    protocolQuestionIds?: readonly number[];
    databaseArtifacts?: readonly string[];
  };
};

type ResumeIntent = {
  stage: "resume";
  questionIds: readonly number[];
  noMemory: boolean;
  confirmedScience125: boolean;
  sourceIdentity: SourceIdentity | null;
  existingRuns: readonly BatchRunFacts[];
};

export type BatchAdmissionRequest = LaunchIntent | ResumeIntent;
type BatchAdmissionPlan = {
  sourceIdentity: SourceIdentity | null;
  memoryArm: MemoryArm;
  paid: boolean;
  formal: boolean;
  releaseGuarded: boolean;
  intent: "launch" | "resume";
};
export type BatchAdmissionDecision = { admitted: true; plan: BatchAdmissionPlan } | { admitted: false; error: string };

/** The single policy interface for paid launch and durable manifest resume admission. */
export function admitPaidBatch(request: BatchAdmissionRequest): BatchAdmissionDecision {
  return request.stage === "launch" ? admitLaunch(request) : admitResume(request);
}

function admitLaunch(intent: LaunchIntent): BatchAdmissionDecision {
  if (intent.dryRun) return admitted(intent, null, false, false);

  let sourceIdentity: SourceIdentity | null = null;
  if (intent.noMemory) {
    if (!intent.confirmedMemoryAblation)
      return rejected("非 dry-run 的 memory-off 消融必须显式传 --confirm-memory-ablation。");
    if (intent.questionIds === null) {
      return rejected("memory-off 消融必须显式传 --ids，并与预注册 Phase B 的 30 题完全一致；续跑也不能省略 --ids。");
    }
    let protocolIds: number[];
    try {
      protocolIds = intent.facts?.protocolQuestionIds
        ? [...intent.facts.protocolQuestionIds]
        : readPhaseBQuestionIds(intent.repoRoot);
    } catch (error) {
      return rejected(describe(error));
    }
    if (!sameIdSet(intent.questionIds, protocolIds)) {
      return rejected(`memory-off 消融的 --ids 必须精确匹配预注册 Phase B 30 题：${compactIds(protocolIds)}。`);
    }
    sourceIdentity = sourceFact(intent);
    if (sourceIdentity === null)
      return rejected("memory-off 消融无法取得 source identity；请从可识别的 Git 仓库启动。");
    if (sourceIdentity.treeDirty) return rejected("memory-off 消融要求当前 git tree clean；请先固定待运行版本。");
  }

  const complete = isCompleteScience125(intent.questionIds ?? []);
  if (complete) {
    if (!intent.confirmedScience125) return rejected("正式 Science-125 全量批跑必须显式传 --confirm-science125。");
    if (intent.manifestId === undefined) {
      sourceIdentity ??= sourceFact(intent);
      if (sourceIdentity === null)
        return rejected("首次正式 Science-125 批跑无法取得 source identity；请从可识别的 Git 仓库启动。");
      if (sourceIdentity.treeDirty)
        return rejected("首次正式 Science-125 批跑要求 git tree clean；请先固定待运行版本。");
      const artifacts = intent.facts?.databaseArtifacts ?? existingBatchDatabaseArtifacts(intent.databasePath);
      if (artifacts.length > 0)
        return rejected(`首次正式 Science-125 批跑拒绝使用已存在的 DB/sidecar：${artifacts.join(", ")}`);
    }
  }

  const releaseRequired = intent.noMemory || intent.manifestId !== undefined || complete;
  if (!releaseRequired) return admitted(intent, sourceIdentity, false, false);
  if (intent.releaseCommit === undefined) return rejected("正式付费批跑必须显式传 --release-commit <40hex>。");
  if (!/^[0-9a-f]{40}$/.test(intent.releaseCommit))
    return rejected("--release-commit 必须是 40 位小写十六进制 Git commit。");
  sourceIdentity ??= sourceFact(intent);
  if (sourceIdentity === null) return rejected("正式付费批跑无法取得 source identity；请从可识别的 Git 仓库启动。");
  if (sourceIdentity.treeDirty) return rejected("正式付费批跑要求当前 git tree clean。");
  if (intent.releaseCommit !== sourceIdentity.gitCommit)
    return rejected("--release-commit 必须精确等于当前 clean source identity 的 commit。");
  return admitted(intent, sourceIdentity, intent.noMemory || complete, true);
}

function admitResume(intent: ResumeIntent): BatchAdmissionDecision {
  if (isCompleteScience125(intent.questionIds) && !intent.confirmedScience125) {
    return rejected("正式 Science-125 全量批跑必须显式传 --confirm-science125。");
  }
  if (!intent.noMemory && !isCompleteScience125(intent.questionIds)) {
    return admitted(intent, intent.sourceIdentity, false, true);
  }
  const prefix = intent.noMemory ? "memory-off 消融续跑" : "正式 Science-125 续跑";
  if (intent.sourceIdentity === null) return rejected(`${prefix}无法取得 source identity；请从可识别的 Git 仓库启动。`);
  if (intent.sourceIdentity.treeDirty) return rejected(`${prefix}要求当前 git tree clean。`);
  for (const run of intent.existingRuns) {
    if (run.sourceIdentity === null) return rejected(`${prefix}中 run ${run.runId} 缺少 source identity。`);
    if (run.sourceIdentity.treeDirty) return rejected(`${prefix}中 run ${run.runId} 来自 dirty tree。`);
    if (run.sourceIdentity.gitCommit !== intent.sourceIdentity.gitCommit)
      return rejected(`${prefix}中 run ${run.runId} 的 commit 与当前 commit 不一致。`);
    if (run.memoryArm !== (intent.noMemory ? "off" : ("on" satisfies MemoryArm))) {
      return rejected(
        intent.noMemory
          ? `${prefix}中 run ${run.runId} 的 memory arm 不是 off。`
          : `${prefix}中 run ${run.runId} 的 memory arm 与本次选择不一致。`,
      );
    }
  }
  return admitted(intent, intent.sourceIdentity, true, true);
}

function sourceFact(intent: LaunchIntent): SourceIdentity | null {
  return intent.facts !== undefined && Object.hasOwn(intent.facts, "sourceIdentity")
    ? (intent.facts.sourceIdentity ?? null)
    : readSourceIdentity(intent.repoRoot);
}

export function readPhaseBQuestionIds(repoRoot: string = resolve(import.meta.dirname, "../../../..")): number[] {
  const path = resolve(repoRoot, "docs/design/experiment-protocol.json");
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (error) {
    throw new Error(`无法读取预注册实验协议 ${path}：${describe(error)}`);
  }
  const ids =
    typeof raw === "object" && raw !== null && !Array.isArray(raw)
      ? (raw as { phase_b_subset?: { question_ids?: unknown } }).phase_b_subset?.question_ids
      : undefined;
  const numeric =
    Array.isArray(ids) && ids.every((id) => Number.isSafeInteger(id) && (id as number) >= 1) ? (ids as number[]) : null;
  if (
    numeric === null ||
    numeric.length !== 30 ||
    new Set(numeric).size !== numeric.length ||
    !sameIds(
      numeric,
      [...numeric].sort((a, b) => a - b),
    )
  )
    throw new Error("预注册实验协议的 phase_b_subset.question_ids 必须是 30 个升序且唯一的正整数。");
  return [...numeric];
}

export function readSourceIdentity(repoRoot: string): SourceIdentity | null {
  try {
    const commit = git(repoRoot, ["rev-parse", "HEAD"]);
    const dirty = git(repoRoot, [
      "status",
      "--porcelain",
      "--untracked-files=normal",
      "--",
      ".",
      ":(exclude)memory/**",
      ":(exclude)outputs/**",
    ]);
    return commit === null || dirty === null ? null : { gitCommit: commit.trim(), treeDirty: dirty.trim().length > 0 };
  } catch {
    return null;
  }
}

function existingBatchDatabaseArtifacts(path: string): string[] {
  return [
    path,
    `${path}-wal`,
    `${path}-shm`,
    `${path}-journal`,
    `${path}.writer-lock.db`,
    `${path}.writer-lock.db-wal`,
    `${path}.writer-lock.db-shm`,
    `${path}.writer-lock.db-journal`,
  ].filter(existsSync);
}
function git(cwd: string, args: string[]): string | null {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 10_000 });
  return result.error || result.status !== 0 || typeof result.stdout !== "string" ? null : result.stdout;
}
function isCompleteScience125(ids: readonly number[]): boolean {
  return ids.length === 125 && ids.every((id, index) => id === index + 1);
}
function sameIds(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}
function sameIdSet(left: readonly number[], right: readonly number[]): boolean {
  if (left.length !== right.length || new Set(left).size !== left.length || new Set(right).size !== right.length) {
    return false;
  }
  return sameIds(
    [...left].sort((a, b) => a - b),
    [...right].sort((a, b) => a - b),
  );
}
function compactIds(ids: readonly number[]): string {
  return ids.join(",");
}
function admitted(
  intent: LaunchIntent | ResumeIntent,
  sourceIdentity: SourceIdentity | null,
  formal: boolean,
  releaseGuarded: boolean,
): BatchAdmissionDecision {
  return {
    admitted: true,
    plan: {
      sourceIdentity,
      memoryArm: intent.noMemory ? "off" : "on",
      paid: intent.stage === "resume" || !intent.dryRun,
      formal,
      releaseGuarded,
      intent: intent.stage,
    },
  };
}
function rejected(error: string): BatchAdmissionDecision {
  return { admitted: false, error };
}
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
