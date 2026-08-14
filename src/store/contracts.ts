import type { Role } from "../agent/contracts.ts";

/** 一个 Task 执行时看到的冻结上下文。 */
export type TaskContext = {
  runId: string;
  taskId: string;
  role: Role;
  goal: string;
  question: string;
  inputArtifactIds: string[];
  inputArtifacts: StoredInput[];
};

/** 冻结输入里的一条 Artifact。`type` 为 "feedback" 时来自 feedback_artifacts 表。 */
export type StoredInput = {
  id: string;
  type: string;
  content: Record<string, unknown>;
};
