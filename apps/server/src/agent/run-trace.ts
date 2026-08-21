import { createHash } from "node:crypto";
import type { Agent, RunContext, Runner } from "@openai/agents";

import type { Role } from "./contracts.ts";

/** 单次 Runner 调用的脱敏输入摘要。
 *
 * 不把 prompt、问题正文或工具输出抄进 trace。hash 只用于把两次调用的输入
 * 对上，不能被当成输入内容；字段名是控制面传给执行层的可审计形状。
 */
export type TraceInputSummary = {
  encoding: "text";
  chars: number;
  sha256: string;
  top_level_fields: string[];
};

export type TraceUsage = {
  requests: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  tool_calls: number | null;
};

export type RunTraceEvent =
  | {
      kind: "started";
      trace_id: string;
      role: Role;
      agent: string;
      model: string | null;
      task: string;
      input_summary: TraceInputSummary;
      structured_constraint: string | null;
      available_tools: string[];
    }
  | {
      kind: "agent_started";
      trace_id: string;
      agent: string;
      turn: number;
      input_items: number | null;
    }
  | {
      kind: "agent_ended";
      trace_id: string;
      agent: string;
      turn: number;
    }
  | {
      kind: "tool_started";
      trace_id: string;
      agent: string;
      tool: string;
      ordinal: number;
    }
  | {
      kind: "tool_ended";
      trace_id: string;
      agent: string;
      tool: string;
      ordinal: number;
      status: "completed" | "unknown";
      duration_ms: number | null;
    }
  | {
      kind: "ended";
      trace_id: string;
      role: Role;
      outcome: "completed" | "failed" | "unknown";
      stop_reason: string;
      usage: TraceUsage;
      trace_events: number;
      truncated: boolean;
    }
  | {
      kind: "callback_error";
      trace_id: string;
      role: Role;
      callback: "onUsage" | "onComplete";
      error_type: string;
    };

type TraceContext = {
  trace_id: string;
};

const MAX_TRACE_EVENTS = 64;
const MAX_TEXT_LENGTH = 160;

/** Runner hooks 属于 SDK 执行层；这个 sink 是唯一向控制面回传事实的窄接缝。 */
type TraceSink = (event: RunTraceEvent) => void;

export function summarizeInput(input: string): TraceInputSummary {
  let topLevelFields: string[] = [];
  try {
    const parsed: unknown = JSON.parse(input);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      topLevelFields = Object.keys(parsed as Record<string, unknown>).sort();
    }
  } catch {
    // 非 JSON 输入仍然是可观测的；只是不声称知道它的字段结构。
  }
  return {
    encoding: "text",
    chars: input.length,
    sha256: createHash("sha256").update(input).digest("hex"),
    top_level_fields: topLevelFields,
  };
}

function boundedText(value: string): string {
  const normalized = value.split(/\s+/).filter(Boolean).join(" ");
  return normalized.length <= MAX_TEXT_LENGTH ? normalized : `${normalized.slice(0, MAX_TEXT_LENGTH)}…`;
}

function modelName(agent: Agent<any, any>): string | null {
  return typeof agent.model === "string" && agent.model.length > 0 ? agent.model : null;
}

function structuredConstraint(agent: Agent<any, any>): string | null {
  const schemaName = agent.outputSchemaName;
  return typeof schemaName === "string" && schemaName.length > 0 ? schemaName : null;
}

function toolName(tool: { name?: unknown }): string {
  return typeof tool.name === "string" && tool.name.length > 0 ? tool.name : "unknown";
}

function toolCallId(details: unknown): string | null {
  if (typeof details !== "object" || details === null || !("toolCall" in details)) return null;
  const toolCall = (details as { toolCall?: unknown }).toolCall;
  if (typeof toolCall !== "object" || toolCall === null || !("callId" in toolCall)) return null;
  const value = (toolCall as { callId?: unknown }).callId;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function traceContextOf(context: RunContext<unknown>): TraceContext | null {
  const value = context.context;
  if (typeof value !== "object" || value === null || !("trace_id" in value)) return null;
  const traceId = (value as { trace_id?: unknown }).trace_id;
  return typeof traceId === "string" ? { trace_id: traceId } : null;
}

/** 给一个 Runner 安装一次全局 hooks；通过 context.trace_id 做并发隔离。
 *
 * Runner 是缓存且可并发复用的，不能每个 stage 直接覆盖同一组 listener。
 * 这里的 listener 只负责把 SDK 生命周期映射成当前 trace 的回调，不决定下一步。
 */
export function installRunnerTraceHooks(runner: Pick<Runner, "on">, traces: Map<string, TraceCollector>): void {
  runner.on("agent_start", (context: RunContext<unknown>, agent: Agent<any, any>, turnInput?: unknown[]) => {
    const trace = traceFor(context, traces);
    trace?.agentStarted(agent.name, turnInput?.length ?? null);
  });
  runner.on("agent_end", (context: RunContext<unknown>, agent: Agent<any, any>) => {
    const trace = traceFor(context, traces);
    trace?.agentEnded(agent.name);
  });
  runner.on("agent_tool_start", (context, agent, tool, details) => {
    const trace = traceFor(context, traces);
    trace?.toolStarted(agent.name, toolName(tool), toolCallId(details));
  });
  runner.on("agent_tool_end", (context, agent, tool, _result, details) => {
    const trace = traceFor(context, traces);
    trace?.toolEnded(agent.name, toolName(tool), toolCallId(details));
  });
}

function traceFor(context: RunContext<unknown>, traces: Map<string, TraceCollector>): TraceCollector | null {
  const traceContext = traceContextOf(context);
  return traceContext ? (traces.get(traceContext.trace_id) ?? null) : null;
}

export class TraceCollector {
  readonly #sink: TraceSink;
  readonly #traceId: string;
  readonly #role: Role;
  #eventCount = 0;
  #dropped = 0;
  #toolOrdinal = 0;
  #turn = 0;
  #openTools = new Map<string, { agent: string; tool: string; ordinal: number; startedAt: number }>();
  #closed = false;

  constructor(
    request: {
      traceId: string;
      role: Role;
      agent: Agent<any, any>;
      task: string;
      input: string;
    },
    sink: TraceSink,
  ) {
    this.#sink = sink;
    this.#traceId = request.traceId;
    this.#role = request.role;
    this.emit({
      kind: "started",
      trace_id: request.traceId,
      role: request.role,
      agent: request.agent.name,
      model: modelName(request.agent),
      task: boundedText(request.task),
      input_summary: summarizeInput(request.input),
      structured_constraint: structuredConstraint(request.agent),
      available_tools: request.agent.tools.map((tool) => toolName(tool)).sort(),
    });
  }

  agentStarted(agent: string, inputItems: number | null): void {
    this.#turn += 1;
    this.emit({ kind: "agent_started", trace_id: this.#traceId, agent, turn: this.#turn, input_items: inputItems });
  }

  agentEnded(agent: string): void {
    this.emit({ kind: "agent_ended", trace_id: this.#traceId, agent, turn: this.#turn });
  }

  toolStarted(agent: string, tool: string, callId: string | null): void {
    const ordinal = ++this.#toolOrdinal;
    if (callId !== null) this.#openTools.set(callId, { agent, tool, ordinal, startedAt: Date.now() });
    this.emit({ kind: "tool_started", trace_id: this.#traceId, agent, tool, ordinal });
  }

  toolEnded(agent: string, tool: string, callId: string | null): void {
    const open = callId === null ? undefined : this.#openTools.get(callId);
    const ordinal = open?.ordinal ?? this.#toolOrdinal;
    const duration = open ? Math.max(0, Date.now() - open.startedAt) : null;
    if (callId !== null && open) this.#openTools.delete(callId);
    this.emit({
      kind: "tool_ended",
      trace_id: this.#traceId,
      agent,
      tool,
      ordinal,
      status: open ? "completed" : "unknown",
      duration_ms: duration,
    });
  }

  ended(outcome: "completed" | "failed" | "unknown", stopReason: string, usage: TraceUsage): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const open of this.#openTools.values()) {
      this.emit({
        kind: "tool_ended",
        trace_id: this.#traceId,
        agent: open.agent,
        tool: open.tool,
        ordinal: open.ordinal,
        status: "unknown",
        duration_ms: null,
      });
    }
    this.#openTools.clear();
    this.#sink({
      kind: "ended",
      trace_id: this.#traceId,
      role: this.#role,
      outcome,
      stop_reason: boundedText(stopReason),
      usage,
      trace_events: this.#eventCount,
      truncated: this.#dropped > 0,
    });
  }

  /** 成功结果已经产生后，记账/遥测旁路失败也必须有可审计事实。 */
  callbackError(callback: "onUsage" | "onComplete", errorType: string): void {
    this.#sink({
      kind: "callback_error",
      trace_id: this.#traceId,
      role: this.#role,
      callback,
      error_type: errorType,
    });
  }

  get toolCalls(): number {
    return this.#toolOrdinal > 0 ? this.#toolOrdinal : 0;
  }

  private emit(event: RunTraceEvent): void {
    if (this.#eventCount >= MAX_TRACE_EVENTS) {
      this.#dropped += 1;
      return;
    }
    this.#eventCount += 1;
    this.#sink(event);
  }
}

export const TRACE_EVENT_LIMIT = MAX_TRACE_EVENTS;
