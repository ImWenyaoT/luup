import {
  MaxTurnsExceededError,
  ModelBehaviorError,
  ModelRefusalError,
  retryPolicies,
  Runner,
  type ModelProvider,
  type ModelSettings,
  type RetryPolicy,
  type ModelResponse,
} from "@openai/agents";

import { ContractError, StageError } from "./agent/failures.ts";
import { installRunnerTraceHooks, TraceCollector, type TraceUsage } from "./agent/run-trace.ts";
import { modelConfigVersion, qwenModelProvider } from "./seams/index.ts";
import { observeQwenResponses, QwenResponseStatusError } from "./seams/qwen-responses.ts";
import type { StageExecutor } from "./roles.ts";
import type { Role } from "./agent/contracts.ts";

export type StageMetrics = {
  runId: string;
  role: Role;
  /** 已知用量只是部分调用的下界，不能当作完整成本。 */
  incomplete?: true;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  toolCalls: number;
  /** 这次调用是交出了结果，还是半路失败。失败那条也要记账 —— 见下面 `usageOf`。 */
  outcome: "completed" | "failed";
};

/** 已发生用量覆盖成功与失败；SDK 未暴露的部分保持未知，不能用零替代。 */
export type StageUsage = Omit<StageMetrics, "runId" | "role" | "outcome">;

/** 一份 `RunState` 形状的观测点：聚合用量 + 已生成的 run item。
 *  `usageOf` 与 `invalidFinalOutput` 观测器读的是同一个形状，所以只写一次。 */
type UsageSource = { usage?: unknown; _generatedItems?: unknown; _modelResponses?: unknown } | null | undefined;

function stageUsageOf(source: UsageSource): StageUsage | null {
  const usage = source?.usage as
    | { requests?: number; inputTokens?: number; outputTokens?: number; totalTokens?: number }
    | undefined;
  if (!usage || typeof usage.totalTokens !== "number") return null;
  const items = Array.isArray(source?._generatedItems) ? source._generatedItems : [];
  const responses = Array.isArray(source?._modelResponses) ? source._modelResponses : [];
  let knownResponses = 0;
  let incomplete = false;
  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  for (const response of responses) {
    const current = response as {
      providerData?: { object?: unknown; usage?: Record<string, unknown> };
      usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
    };
    // SDK 会把 Responses 缺失的 usage 补成 0；原始 providerData 才能证明它是否真实报告过。
    if (current.providerData?.object === "response") {
      const raw = current.providerData.usage;
      const valid = [raw?.input_tokens, raw?.output_tokens, raw?.total_tokens].every(
        (value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0,
      );
      if (!valid) {
        incomplete = true;
        continue;
      }
      inputTokens += raw!.input_tokens as number;
      outputTokens += raw!.output_tokens as number;
      totalTokens += raw!.total_tokens as number;
      knownResponses += 1;
    } else if (current.usage) {
      inputTokens += current.usage.inputTokens;
      outputTokens += current.usage.outputTokens;
      totalTokens += current.usage.totalTokens;
      knownResponses += 1;
    }
  }
  if (incomplete && knownResponses === 0) return null;
  return {
    ...(incomplete ? { incomplete: true as const } : {}),
    requests: usage.requests ?? 0,
    inputTokens: incomplete ? inputTokens : (usage.inputTokens ?? 0),
    outputTokens: incomplete ? outputTokens : (usage.outputTokens ?? 0),
    totalTokens: incomplete ? totalTokens : usage.totalTokens,
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

/** 每次 Runner 调用的模型响应轮数，不是工具次数；provider 可能忽略 parallelToolCalls。
 * Researcher 保留检索与纠错余量，其余角色使用 6 轮；Attempt deadline 另行约束总时长。
 * 预算与并行调用边界见 docs/design/experiment-protocol.json 的 queries_authority 修订。
 */
const MAX_TURNS_BY_ROLE: Record<Role, number> = {
  researcher: 12,
  "hypothesis-generation": 6,
  "evidence-review": 6,
  "research-plan": 6,
  reviewer: 6,
};

/** 角色的 turn 上限。`Record<Role, ...>` 保证少写一个角色是编译期错误。 */
export function maxTurnsFor(role: Role): number {
  return MAX_TURNS_BY_ROLE[role];
}

/** 只按 SDK 规范化状态码重试 429/5xx，不用错误正文把语义失败误判为瞬时故障。 */
const TRANSIENT_STATUS: RetryPolicy = ({ normalized }) => {
  const status = normalized.statusCode;
  if (status === undefined) return false;
  return status === 429 || status >= 500;
};

/** 同一次模型调用的传输重试，不增加 Attempt 或结构化纠错次数。
 * SDK 负责取消优先、provider 的禁止重试指示、Retry-After 与失败请求计数。
 * model seam 禁用 OpenAI 客户端重试；Runner 最多重试两次，总计最多 3 次传输。
 * 全部请求受 Attempt deadline 约束；本地退避为 2s/8s，附带 jitter。
 * 依据：docs/design/experiment-protocol.json 的 transient_backoff 修订。
 */
export const TRANSIENT_RETRY: ModelSettings = {
  retry: {
    // 2 次之后仍失败就不是抖动，是停机；继续重试只是把整批的墙钟烧在一个死掉的端点上。
    maxRetries: 2,
    policy: retryPolicies.any(retryPolicies.providerSuggested(), retryPolicies.networkError(), TRANSIENT_STATUS),
    backoff: { initialDelayMs: 2_000, multiplier: 4, maxDelayMs: 8_000, jitter: true },
  },
};

/** `modelProvider` 以接缝入参：默认是唯一的模型接线（`seams/model.ts`），
 *  测试注入按脚本抛状态码的替身，用来验证退避判据本身，零网络零 LLM。 */
export function createQwenExecutor(
  onComplete?: (metrics: StageMetrics) => void,
  modelProvider?: ModelProvider,
): StageExecutor {
  // 重试挂在 RunConfig 上，五个角色共用一份：瞬时故障是端点的属性，不是角色的属性。
  // Agent 自己的 modelSettings（`seams/model.ts` 的 `sharedModelSettings`）不带 retry 键，
  // 合并时（`mergeModelSettings`）不会把这里的配置盖掉。
  //
  // 默认路径按配置版本惰性构建：设置面（PUT /api/config）保存后，下一次角色调用
  // 就吃到新接线；缺凭据也不再在构造期抛——它落在 run 里成 `missing_credential`
  // 终态，那正是这个失败分类存在的意义。注入的替身永远直用，不参与重建。
  let cached: { runner: Runner; version: number } | null = null;
  const traces = new Map<string, TraceCollector>();
  let traceSequence = 0;
  const runnerWithTrace = (config: ConstructorParameters<typeof Runner>[0]): Runner => {
    const runner = new Runner(config);
    installRunnerTraceHooks(runner, traces);
    return runner;
  };
  const runnerFor = (): Runner => {
    if (modelProvider) {
      cached ??= {
        runner: runnerWithTrace({ modelProvider, tracingDisabled: true, modelSettings: TRANSIENT_RETRY }),
        version: -1,
      };
      return cached.runner;
    }
    const version = modelConfigVersion();
    if (cached === null || cached.version !== version) {
      cached = {
        runner: runnerWithTrace({
          modelProvider: qwenModelProvider(),
          tracingDisabled: true,
          modelSettings: TRANSIENT_RETRY,
        }),
        version,
      };
    }
    return cached.runner;
  };
  return async ({ runId, taskId, role, task, agent, input, timeoutMs, onUsage, onTrace }) => {
    const signal = AbortSignal.timeout(timeoutMs);
    const traceId = `${taskId ?? `${runId}:${role}`}:${++traceSequence}`;
    let traceWriteError: unknown = null;
    const trace = new TraceCollector(
      {
        traceId,
        role,
        agent,
        task: task ?? role,
        input,
      },
      (event) => {
        if (!onTrace) return;
        try {
          onTrace(event);
        } catch (error) {
          traceWriteError ??= error;
        }
      },
    );
    const reportCallbackError = (callback: "onUsage" | "onComplete", error: unknown): void => {
      const errorType = error instanceof Error && error.name.length > 0 ? error.name : typeof error;
      if (!onTrace) {
        console.error(`executor ${callback} callback failed`, errorType);
        return;
      }
      const previousTraceWriteError = traceWriteError;
      trace.callbackError(callback, errorType);
      // `onTrace` 是唯一的持久化接缝；它自己也可能失败。此时仍保留 stderr 诊断，
      // 但不把已经成功的模型结果改判成失败。
      if (traceWriteError !== previousTraceWriteError) {
        console.error(`executor ${callback} callback diagnostic failed`, errorType);
      }
    };
    traces.set(traceId, trace);
    let runner: Runner;
    try {
      runner = runnerFor();
      if (traceWriteError) {
        throw new StageError("runtime_error", "run trace persistence failed", { cause: traceWriteError });
      }
    } catch (error) {
      trace.ended("failed", error instanceof Error ? error.name : "runner_setup_failed", traceUsageOf(null, null));
      traces.delete(traceId);
      throw error;
    }
    // `outputType` 校验失败时 SDK 不给异常挂 state：`runner/turnResolution.mjs` 直接
    // `new ModelBehaviorError(message)`，而 `attachRunStateToError` 只补 ToolCallError，
    // 于是 `usageOf` 在这条最常见的失败路径上永远读回 null。SDK 自己留了观测口 ——
    // `errorHandlers.invalidFinalOutput` 收到的 `runData.state` 就是那一次 run 的状态，
    // 用量此刻已经累加完（`run.mjs` 每收到一次模型响应就 `state._context.usage.add`）。
    // 处理器返回 undefined 表示不接管，SDK 照常抛原来的错误：这里只观测，不改语义。
    const observed: { usage: StageUsage | null } = { usage: null };
    const providerResponses: ModelResponse[] = [];
    let result;
    try {
      result = await observeQwenResponses(providerResponses, () =>
        runner.run(agent, input, {
          context: { trace_id: traceId },
          maxTurns: maxTurnsFor(role),
          signal,
          errorHandlers: {
            invalidFinalOutput: ({ context, runData }) => {
              observed.usage =
                stageUsageOf(runData.state as UsageSource) ??
                stageUsageOf({
                  usage: context.usage,
                  _generatedItems: runData.newItems,
                  _modelResponses: runData.rawResponses,
                });
              return undefined;
            },
          },
        }),
      );
    } catch (error) {
      // 先记账再分类：下面每条分支都会抛，记账写进分支就会漏掉其中几条。
      // 记账本身失败绝不拖垮 Attempt —— 少一条用量事件，远好过因为记账把 Run 打死。
      const rejectedUsage =
        error instanceof QwenResponseStatusError
          ? stageUsageOf({
              usage: {
                requests: providerResponses.length,
                inputTokens: providerResponses.reduce((total, response) => total + response.usage.inputTokens, 0),
                outputTokens: providerResponses.reduce((total, response) => total + response.usage.outputTokens, 0),
                totalTokens: providerResponses.reduce((total, response) => total + response.usage.totalTokens, 0),
              },
              _modelResponses: providerResponses,
            })
          : null;
      if (rejectedUsage) rejectedUsage.toolCalls = trace.toolCalls;
      const spent = rejectedUsage ?? usageOf(error) ?? observed.usage;
      trace.ended(
        "failed",
        error instanceof Error ? error.name : "unknown_error",
        traceUsageOf(spent, trace.toolCalls),
      );
      traces.delete(traceId);
      if (traceWriteError) {
        throw new StageError("runtime_error", "run trace persistence failed", { cause: traceWriteError });
      }
      if (spent) {
        try {
          onComplete?.({ runId, role, ...spent, outcome: "failed" });
        } catch (callbackError) {
          // 记账是旁路，不改写原始失败分类，但失败本身必须进入 trace/stderr。
          reportCallbackError("onComplete", callbackError);
        }
      }
      // 抛出去的是新造的分类异常，用量必须挂在**它**身上：上层看不见这里的原始 error。
      const fail = <E extends Error>(classified: E): never => {
        if (spent) (classified as { usage?: typeof spent }).usage = spent;
        throw classified;
      };
      // 执行层失败不给纠错机会：换个提示词重发一次也不会让超时或 provider 报错消失。
      if (signal.aborted) {
        fail(new StageError("deadline_exceeded", `${role} exceeded the Attempt deadline`, { cause: error }));
      }
      // SDK 把「模型没按约定输出」和「provider 坏了」分成了不同的错误类，这里必须跟着分：
      // ModelBehaviorError（含 outputType 校验失败）是模型写错了，该给一次纠错机会；
      // 全都归成 provider_error 会让这类失败一次机会都没有就终止 Attempt。
      if (error instanceof ModelBehaviorError || error instanceof ModelRefusalError) {
        fail(new ContractError(`${role} 的输出不符合约定：${error.message}`, { cause: error }));
      }
      // 模型一直调用工具却不交最终答案，是 Agent 没完成，不是 provider 宕机。
      if (error instanceof MaxTurnsExceededError) {
        fail(new StageError("invalid_output", `${role} reached the Agent turn limit`, { cause: error }));
      }
      // 上下文超长必须在 provider_error 兜底之前认出来，否则它就永远混在兜底里。
      if (isContextOverflow(providerDetail(error))) {
        fail(
          new StageError(
            "context_overflow",
            `${role} exceeded the model context window: ${error instanceof Error ? error.message : String(error)}`,
            { cause: error },
          ),
        );
      }
      if (error instanceof QwenResponseStatusError) fail(error);
      // 走到这里的瞬时故障已经退避重试过（`TRANSIENT_RETRY`）并且仍然失败，或者
      // 判据认定它根本不瞬时（4xx 语义错误）。两种都是终态：`provider_error` 的语义
      // 因此从「provider 报错了」收紧为「provider 报错且重试救不回来」。
      return fail(
        new StageError(
          "provider_error",
          `${role} provider call failed: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        ),
      );
    }
    if (result.finalOutput === undefined) {
      trace.ended("failed", "missing_final_output", traceUsageOf(null, trace.toolCalls));
      traces.delete(traceId);
      if (traceWriteError) {
        throw new StageError("runtime_error", "run trace persistence failed", { cause: traceWriteError });
      }
      throw new StageError("provider_error", `${role} returned no final output`);
    }
    const usage = result.runContext.usage;
    const spent = stageUsageOf({ usage, _generatedItems: result.newItems, _modelResponses: result.rawResponses });
    trace.ended("completed", "final_output", traceUsageOf(spent, spent?.toolCalls ?? null));
    traces.delete(traceId);
    if (traceWriteError) {
      throw new StageError("runtime_error", "run trace persistence failed", { cause: traceWriteError });
    }
    // 成功也要记账，而且要落到与失败同一条通路上：`onUsage` 把用量交还给 runTask，
    // 由它按 Attempt 累加、再由 harness 落成唯一一条 `sdk.usage`。
    // `onComplete` 只是进程内遥测（canary 报告），不写库 —— 两者不重复记账。
    if (!spent) return result.finalOutput;
    try {
      onUsage?.(spent);
    } catch (error) {
      reportCallbackError("onUsage", error);
    }
    try {
      onComplete?.({ runId, role, ...spent, outcome: "completed" });
    } catch (error) {
      reportCallbackError("onComplete", error);
    }
    return result.finalOutput;
  };
}

function traceUsageOf(usage: StageUsage | null, toolCalls: number | null): TraceUsage {
  return {
    requests: usage?.requests ?? null,
    input_tokens: usage?.incomplete ? null : (usage?.inputTokens ?? null),
    output_tokens: usage?.incomplete ? null : (usage?.outputTokens ?? null),
    total_tokens: usage?.incomplete ? null : (usage?.totalTokens ?? null),
    tool_calls: usage?.toolCalls ?? (usage ? toolCalls : null),
  };
}
