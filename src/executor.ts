import {
  MaxTurnsExceededError,
  ModelBehaviorError,
  ModelRefusalError,
  OpenAIProvider,
  Runner,
} from "@openai/agents";

import { ContractError, StageError } from "./agent/failures.ts";
import type { StageExecutor } from "./roles.ts";
import type { Role } from "./agent/contracts.ts";

export type StageMetrics = {
  runId: string;
  role: Role;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  toolCalls: number;
  /** 这次调用是交出了结果，还是半路失败。失败那条也要记账 —— 见下面 `usageOf`。 */
  outcome: "completed" | "failed";
};

/** 从 SDK 异常里读出**已经发生**的用量。
 *
 * 调用失败不等于没花钱：超时、turn 用尽、模型写错格式，token 都已经烧掉了。
 * 只在成功路径记账，等于把所有失败的成本从账上抹掉 —— 跑完 125 题算总账时，
 * 差的正好是最该被看见的那一块。
 *
 * SDK 把这些挂在 `AgentsError.state` 上（`errors.d.ts`：所有错误类都带 `state?: RunState`，
 * `RunState.usage` 是聚合用量）。拿不到就返回 null，绝不用零顶替：
 * 零的意思是「确实没花」，缺失的意思是「不知道」。
 */
export type StageUsage = Omit<StageMetrics, "runId" | "role" | "outcome">;

export function usageOf(error: unknown): StageUsage | null {
  const state = (error as { state?: { usage?: unknown; _generatedItems?: unknown } } | null)?.state;
  const usage = state?.usage as
    | { requests?: number; inputTokens?: number; outputTokens?: number; totalTokens?: number }
    | undefined;
  if (!usage || typeof usage.totalTokens !== "number") return null;
  const items = Array.isArray(state?._generatedItems) ? state._generatedItems : [];
  return {
    requests: usage.requests ?? 0,
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    totalTokens: usage.totalTokens,
    toolCalls: items.filter((item) => (item as { type?: string }).type === "tool_call_item").length,
  };
}

export function createQwenExecutor(onComplete?: (metrics: StageMetrics) => void): StageExecutor {
  const apiKey = process.env.QWEN_API_KEY;
  if (!apiKey) throw new StageError("missing_credential", "missing QWEN_API_KEY");
  const provider = new OpenAIProvider({
    apiKey,
    baseURL: (process.env.QWEN_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1").replace(/\/$/, ""),
  });
  const runner = new Runner({ modelProvider: provider, tracingDisabled: true });
  return async ({ runId, role, agent, input, timeoutMs }) => {
    const signal = AbortSignal.timeout(timeoutMs);
    let result;
    try {
      result = await runner.run(agent, input, { maxTurns: 6, signal });
    } catch (error) {
      // 先记账再分类：下面每条分支都会抛，记账写进分支就会漏掉其中几条。
      // 记账本身失败绝不拖垮 Attempt —— 少一条用量事件，远好过因为记账把 Run 打死。
      const spent = usageOf(error);
      if (spent) {
        try {
          onComplete?.({ runId, role, ...spent, outcome: "failed" });
        } catch {
          // 记账是旁路，不参与失败分类。
        }
      }
      // 抛出去的是新造的分类异常，用量必须挂在**它**身上：上层看不见这里的原始 error。
      const fail = <E extends Error>(classified: E): never => {
        if (spent) (classified as { usage?: typeof spent }).usage = spent;
        throw classified;
      };
      // 执行层失败不给纠错机会：换个提示词重发一次也不会让超时或 provider 报错消失。
      if (signal.aborted) {
        fail(new StageError(
          "deadline_exceeded",
          `${role} exceeded the Attempt deadline`,
          { cause: error },
        ));
      }
      // SDK 把「模型没按约定输出」和「provider 坏了」分成了不同的错误类，这里必须跟着分：
      // ModelBehaviorError（含 outputType 校验失败）是模型写错了，该给一次纠错机会；
      // 全都归成 provider_error 会让这类失败一次机会都没有就终止 Attempt。
      if (error instanceof ModelBehaviorError || error instanceof ModelRefusalError) {
        fail(new ContractError(
          `${role} 的输出不符合约定：${error.message}`,
          { cause: error },
        ));
      }
      // 模型一直调用工具却不交最终答案，是 Agent 没完成，不是 provider 宕机。
      if (error instanceof MaxTurnsExceededError) {
        fail(new StageError("invalid_output", `${role} reached the Agent turn limit`, { cause: error }));
      }
      return fail(new StageError(
        "provider_error",
        `${role} provider call failed: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      ));
    }
    if (result.finalOutput === undefined) {
      throw new StageError("provider_error", `${role} returned no final output`);
    }
    const usage = result.runContext.usage;
    onComplete?.({
      runId,
      role,
      requests: usage.requests,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      toolCalls: result.newItems.filter((item) => item.type === "tool_call_item").length,
      outcome: "completed",
    });
    return result.finalOutput;
  };
}
