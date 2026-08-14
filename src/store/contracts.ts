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

/** 哪个 build 产出了这个 Run —— 模型无从知道也无从上报的事实。
 *
 * `treeDirty` 用 `git status --porcelain -uno` 判定：批跑会往 outputs/ 写文件，
 * 把未跟踪文件算进去会让每个 run 都是脏的，这个标志就什么也不说明了。
 */
export type SourceIdentity = { gitCommit: string; treeDirty: boolean };

/** 一次业务 Attempt 真实发生过的用量。失败路径上只有「已发生」的那部分，不补零也不猜。 */
export type UsageFacts = {
  agent: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

/** 冻结输入里的一条 Artifact。`type` 为 "feedback" 时来自 feedback_artifacts 表。 */
export type StoredInput = {
  id: string;
  type: string;
  content: Record<string, unknown>;
};
