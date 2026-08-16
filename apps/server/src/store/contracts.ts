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
  /** 同题最近几次 run 的确定性战役记录。消融臂与无题号 run 为空。 */
  priorAttempts?: readonly string[];
};

/** 哪个 build 产出了这个 Run —— 模型无从知道也无从上报的事实。
 *
 * `treeDirty` 用 `git status --porcelain -uno` 判定：批跑会往 outputs/ 写文件，
 * 把未跟踪文件算进去会让每个 run 都是脏的，这个标志就什么也不说明了。
 */
export type SourceIdentity = { gitCommit: string; treeDirty: boolean };

/** 这个 Run 属于消融实验的哪一臂。批跑之外的 run 不属于任何一臂，记 null。 */
export type MemoryArm = "on" | "off";

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
