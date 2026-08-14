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
};

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
      // 执行层失败不给纠错机会：换个提示词重发一次也不会让超时或 provider 报错消失。
      if (signal.aborted) {
        throw new StageError(
          "deadline_exceeded",
          `${role} exceeded the Attempt deadline`,
          { cause: error },
        );
      }
      // SDK 把「模型没按约定输出」和「provider 坏了」分成了不同的错误类，这里必须跟着分：
      // ModelBehaviorError（含 outputType 校验失败）是模型写错了，该给一次纠错机会；
      // 全都归成 provider_error 会让这类失败一次机会都没有就终止 Attempt。
      if (error instanceof ModelBehaviorError || error instanceof ModelRefusalError) {
        throw new ContractError(
          `${role} 的输出不符合约定：${error.message}`,
          { cause: error },
        );
      }
      // 模型一直调用工具却不交最终答案，是 Agent 没完成，不是 provider 宕机。
      if (error instanceof MaxTurnsExceededError) {
        throw new StageError("invalid_output", `${role} reached the Agent turn limit`, { cause: error });
      }
      throw new StageError(
        "provider_error",
        `${role} provider call failed: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
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
    });
    return result.finalOutput;
  };
}
