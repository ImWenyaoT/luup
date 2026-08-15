import {
  MaxTurnsExceededError,
  ModelBehaviorError,
  ModelRefusalError,
  Runner,
} from "@openai/agents";

import { ContractError, StageError } from "./agent/failures.ts";
import { qwenModelProvider } from "./seams/index.ts";
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
 * `errors.d.ts` 上所有错误类都**声明**了 `state?: RunState`（`RunState.usage` 是聚合用量），
 * 但 0.14.3 只有一部分构造点真的传了它。读源码逐条核对过：
 * - `MaxTurnsExceededError`（`runner/turnPreparation.mjs:20`）传了 state，这里读得到；
 * - `ModelBehaviorError`（`runner/turnResolution.mjs:795`，`outputType` 校验失败）没传，
 *   `run.mjs` 的 catch 里那句 `attachRunStateToError` 也只补 ToolCallError ——
 *   这条路改由 `createQwenExecutor` 的 `errorHandlers.invalidFinalOutput` 观测，见下面；
 * - 超时中断与 provider 抛错走的是原始异常，SDK 不暴露 state，也没有等价钩子：
 *   这两条如实记 null，不造数。
 *
 * 拿不到就返回 null，绝不用零顶替：零的意思是「确实没花」，缺失的意思是「不知道」。
 */
export type StageUsage = Omit<StageMetrics, "runId" | "role" | "outcome">;

/** 一份 `RunState` 形状的观测点：聚合用量 + 已生成的 run item。
 *  `usageOf` 与 `invalidFinalOutput` 观测器读的是同一个形状，所以只写一次。 */
type UsageSource = { usage?: unknown; _generatedItems?: unknown } | null | undefined;

function stageUsageOf(source: UsageSource): StageUsage | null {
  const usage = source?.usage as
    | { requests?: number; inputTokens?: number; outputTokens?: number; totalTokens?: number }
    | undefined;
  if (!usage || typeof usage.totalTokens !== "number") return null;
  const items = Array.isArray(source?._generatedItems) ? source._generatedItems : [];
  return {
    requests: usage.requests ?? 0,
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    totalTokens: usage.totalTokens,
    toolCalls: items.filter((item) => (item as { type?: string }).type === "tool_call_item").length,
  };
}

export function usageOf(error: unknown): StageUsage | null {
  return stageUsageOf((error as { state?: UsageSource } | null)?.state);
}

/** provider 说「上下文放不下了」的各种说法。
 *
 * 写法参照 dsh `packages/llm/llm/src/error.ts:80` 的正则并集：provider 之间措辞不统一，
 * 但都在同一句话里点名 context 这个对象，所以按「谁超了 + 超的是 context」两段来匹配，
 * 不做宽泛的 "too long" 全匹配 —— 那会把工具参数过长之类的错误一起吞掉。
 */
const CONTEXT_OVERFLOW_PATTERNS: readonly RegExp[] = [
  /(?:^|[^a-z0-9])context[\s_-](?:length|window)[\s_-](?:exceed(?:ed|s)?|overflow(?:ed)?|limit[\s_-]exceeded)(?:$|[^a-z0-9])/i,
  /\b(?:maximum|max)(?:\s+(?:allowed|supported))?\s+context\s+(?:length|window)\b/i,
  /\b(?:request|prompt|input|messages?)\s+(?:is\s+|are\s+)?too\s+(?:large|long)\s+for\s+(?:(?:this|the)\s+)?(?:model(?:'s)?\s+)?context(?:\s+window)?\b/i,
  /\b(?:input|prompt|request)\s+(?:is\s+)?too\s+(?:long|large)\s+for\s+(?:this|the)\s+model\b/i,
  /\b(?:input|prompt|request|messages?)\b.{0,40}\b(?:exceed(?:s|ed)?|overflows?|is\s+larger\s+than)\b.{0,40}\b(?:the\s+)?(?:model(?:'s)?\s+)?context(?:\s+(?:length|window))?\b/i,
];

/** 把 provider 的 code / type / message 拼成一条待匹配的文本。
 *
 * 两种投递方式都要覆盖：抛出来的异常，和塞在响应体里的错误对象。 */
function providerDetail(error: unknown): string {
  const fields = error as { message?: unknown; code?: unknown; type?: unknown } | null;
  return [fields?.code, fields?.type, fields?.message ?? String(error)]
    .filter((part) => typeof part === "string" && part.length > 0)
    .join(" ");
}

/** 上下文超长归一成一个稳定错误码。
 *
 * 单列出来是为了让兜底可拆：这一类不是 provider 宕机，也不是模型写错格式，
 * 而是我们塞进去的东西超了容量 —— 唯一能救它的动作（压缩、裁剪输入、换更大窗口）
 * 都要先认出它。混在 `provider_error` 里，报告上看不出这件事发生过几次。
 */
export function isContextOverflow(detail: string): boolean {
  return CONTEXT_OVERFLOW_PATTERNS.some((pattern) => pattern.test(detail));
}

export function createQwenExecutor(onComplete?: (metrics: StageMetrics) => void): StageExecutor {
  const runner = new Runner({ modelProvider: qwenModelProvider(), tracingDisabled: true });
  return async ({ runId, role, agent, input, timeoutMs, onUsage }) => {
    const signal = AbortSignal.timeout(timeoutMs);
    // `outputType` 校验失败时 SDK 不给异常挂 state：`runner/turnResolution.mjs` 直接
    // `new ModelBehaviorError(message)`，而 `attachRunStateToError` 只补 ToolCallError，
    // 于是 `usageOf` 在这条最常见的失败路径上永远读回 null。SDK 自己留了观测口 ——
    // `errorHandlers.invalidFinalOutput` 收到的 `runData.state` 就是那一次 run 的状态，
    // 用量此刻已经累加完（`run.mjs` 每收到一次模型响应就 `state._context.usage.add`）。
    // 处理器返回 undefined 表示不接管，SDK 照常抛原来的错误：这里只观测，不改语义。
    const observed: { usage: StageUsage | null } = { usage: null };
    let result;
    try {
      result = await runner.run(agent, input, {
        maxTurns: 6,
        signal,
        errorHandlers: {
          invalidFinalOutput: ({ context, runData }) => {
            observed.usage = stageUsageOf(runData.state as UsageSource)
              ?? stageUsageOf({ usage: context.usage, _generatedItems: runData.newItems });
            return undefined;
          },
        },
      });
    } catch (error) {
      // 先记账再分类：下面每条分支都会抛，记账写进分支就会漏掉其中几条。
      // 记账本身失败绝不拖垮 Attempt —— 少一条用量事件，远好过因为记账把 Run 打死。
      const spent = usageOf(error) ?? observed.usage;
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
      // 上下文超长必须在 provider_error 兜底之前认出来，否则它就永远混在兜底里。
      if (isContextOverflow(providerDetail(error))) {
        fail(new StageError(
          "context_overflow",
          `${role} exceeded the model context window: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        ));
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
    const spent: StageUsage = {
      requests: usage.requests,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      toolCalls: result.newItems.filter((item) => item.type === "tool_call_item").length,
    };
    // 成功也要记账，而且要落到与失败同一条通路上：`onUsage` 把用量交还给 runTask，
    // 由它按 Attempt 累加、再由 harness 落成唯一一条 `sdk.usage`。
    // `onComplete` 只是进程内遥测（canary 报告），不写库 —— 两者不重复记账。
    onUsage?.(spent);
    onComplete?.({ runId, role, ...spent, outcome: "completed" });
    return result.finalOutput;
  };
}
