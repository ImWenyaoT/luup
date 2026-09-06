/** Run 数据的公共投影。
 *
 * 浏览器是不可信边界。客户端拿到的每个字段都要经过这里，白名单之外的一律留在 Harness 内部。
 */

import { z } from "zod";

import {
  evidenceReviewSchema,
  hypothesisCandidateSchema,
  hypothesisComparisonSchema,
  researchPlanSchema,
  researchSchema,
  reviewSchema,
  roleSchema,
} from "../agent/contracts.ts";
import { ATTEMPT_STATUSES, RUN_STATUSES } from "../store/schema.ts";

type DisplayScalar = string | number | boolean | null;

const EVENT_PAYLOAD_FIELDS: Record<string, readonly string[]> = {
  "run.created": [],
  "harness.queued": [],
  "harness.dispatched": [],
  "harness.stop_requested": [],
  "harness.instruction_queued": ["instruction_id", "role"],
  "harness.instruction_applied": ["instruction_id", "role", "attempt_id"],
  "harness.instruction_discarded": ["instruction_id", "role"],
  "tool.evidence_recorded": ["tool_name", "status", "result_count"],
  "tool.evidence_dropped": ["tool_name", "status", "reason"],
  "artifact.published": ["artifact_type"],
  "attempt.failed": ["failure_code"],
  "run.failed": ["failure_code"],
  "run.review_rejected": ["failure_code"],
  "run.completed": ["final_artifact_id"],
  "attempt.started": ["role", "ordinal"],
  "attempt.transition_rejected": ["action", "attempt_status", "run_status"],
  "run.transition_rejected": ["action", "requested_status", "run_status", "reason"],
  "subagent.started": ["subagent_id", "parent_run_id", "role", "ordinal"],
  "subagent.ended": ["subagent_id", "role", "status", "failure_code"],
  "feedback.received": [
    "source",
    "feedback_source",
    "target",
    "round",
    "action",
    "feedback_count",
    "feedback_artifact_id",
    "feedback_id",
    "feedback",
    "retry_reason",
    "stop_reason",
    "rollback_reason",
  ],
  "revision.applied": ["round", "source", "feedback_source", "from_artifact_id", "to_artifact_id", "changed_fields"],
  "evaluation.round": [
    "evaluator",
    "target",
    "sample",
    "sample_size",
    "rubric_version",
    "scientific_rationale",
    "round",
    "phase",
    "action",
    "feedback_source",
    "feedback_artifact_id",
    "feedback_count",
    "raw_plan_artifact_id",
    "raw_review_artifact_id",
    "plan_artifact_id",
    "review_artifact_id",
    "changed_fields",
    "score_before_total",
    "score_after_total",
    "score_delta_total",
    "round_cost_tokens",
    "cost_delta_tokens",
    "limitations_before_count",
    "limitations_after_count",
    "limitation_delta_count",
    "stop_reason",
    "retry_reason",
    "rollback_reason",
  ],
  // ADR-0012 F1：证据审查后的候选晋升硬闸。自选与实际晋升可分叉（Propose≠Select）；
  // artifact id 是溯源标量，可出网。
  "evaluation.candidate_gate": [
    "selected_candidate_id",
    "selected_verdict",
    "promoted_candidate_id",
    "verdict",
    "promoted",
    "selection_overridden",
    "supports_count",
    "evidence_review_artifact_id",
    "hypothesis_artifact_id",
  ],
  // 终局引用验收的计分板。逐条 checks 是数组，即使写进白名单也过不了类型闸，
  // 明细留在库内供报告引用，界面只拿到「查了几条、过没过」。
  "verification.references": [
    "ok",
    "reference_count",
    "frozen_sources",
    "arxiv_checked",
    "doi_checked",
    "membership_only",
    "failed_count",
    "infra_error",
  ],
  // 开局注入了几条战役记录。它是消融生效门的事实来源，也是界面上「这个 run 带着
  // 多少历史开跑」的唯一说明；注入内容本身不出网，只放行条数。
  "campaign.prior_attempts": ["question_id", "count"],
  "campaign.memory_degraded": ["phase", "status", "reason"],
  // 代码用冻结事实覆写了模型转述的某个字段。放行「哪份产物的哪个字段被覆写」，
  // 转录类字段再加两向计数 —— 它们是纯标量，也是 queries 权威改由台账持有之后
  // 新增的机制指标。before/after 与 missing/invented 的 ID 列表是模型写的原文，
  // 与 sdk.output_rejected 的 reason 同类，只作排障材料留在库内。
  "artifact.field_overwritten": ["artifact_type", "field", "missing_count", "invented_count"],
  // reason 不进公共投影：它是校验器的内部错误信息，只用于排障和调门槛。
  "sdk.structured_correction": ["corrections"],
  "sdk.usage": ["agent", "input_tokens", "output_tokens", "total_tokens"],
  // RunTrace 是脱敏的 Runner 生命周期事实：输入只出长度/hash/字段名，工具只出名字和状态，
  // usage 缺失保持 null，绝不把 unknown 伪造成 0。
  "sdk.trace.started": [
    "trace_id",
    "role",
    "agent",
    "model",
    "task",
    "input_encoding",
    "input_chars",
    "input_sha256",
    "input_fields",
    "structured_constraint",
    "available_tools",
  ],
  "sdk.trace.agent_started": ["trace_id", "agent", "turn", "input_items"],
  "sdk.trace.agent_ended": ["trace_id", "agent", "turn"],
  "sdk.trace.tool_started": ["trace_id", "agent", "tool", "ordinal"],
  "sdk.trace.tool_ended": ["trace_id", "agent", "tool", "ordinal", "status", "duration_ms"],
  "sdk.trace.ended": [
    "trace_id",
    "role",
    "outcome",
    "stop_reason",
    "usage_requests",
    "usage_input_tokens",
    "usage_output_tokens",
    "usage_total_tokens",
    "usage_tool_calls",
    "trace_events",
    "truncated",
  ],
  "sdk.trace.callback_error": ["trace_id", "role", "callback", "error_type"],
};

// sdk.output_rejected 带的是校验器内部错误信息，只用于排障，不该出网。
const HIDDEN_EVENT_KINDS: ReadonlySet<string> = new Set(["sdk.output_rejected"]);

const KNOWN_EVENT_KINDS: ReadonlySet<string> = new Set([...Object.keys(EVENT_PAYLOAD_FIELDS), ...HIDDEN_EVENT_KINDS]);

// 这里写当前真正会落库的工具名。名字漏掉时后端不会报错，只会让 UI 静默少一条证据。
const PUBLIC_EVIDENCE_TOOLS: ReadonlySet<string> = new Set(["crossref_search", "arxiv_search"]);

const displayScalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

function isDisplayScalar(value: unknown): value is DisplayScalar {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function projectPayload(kind: string, value: unknown): Record<string, DisplayScalar> {
  // 事件名本身仍然公开，但未知事实不能伪装成「没有可展示字段」。否则 SDK 或 Harness
  // 新增事件后，浏览器会收到一条看似正常却无法解释的空 payload。
  if (!KNOWN_EVENT_KINDS.has(kind)) {
    return { diagnostic: "unsupported_event", unsupported: true };
  }
  // 数组的 typeof 也是 "object"，漏掉这道判断会让 payload 变成按下标取字段。
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const payload: Record<string, DisplayScalar> = {};
  const fields = EVENT_PAYLOAD_FIELDS[kind] ?? [];
  for (const field of kind.startsWith("sdk.trace.") ? [...fields, "attempt_id"] : fields) {
    const item = source[field];
    // 类型闸独立于字段白名单：嵌套对象/数组即使字段名被允许也要丢掉，
    // 否则一个被允许的字段名就能把整棵内部结构带出去。
    if (field in source && isDisplayScalar(item)) payload[field] = item;
  }
  return payload;
}

// 下面这些 schema **就是**公开白名单：声明了什么就放行什么。
//
// 这里必须是 zod 而不是 TS 的 interface：TS 类型只在编译期存在，对象上多出来的内部字段
// 运行时照样被 JSON.stringify 序列化出去。zod 的 parse 会真的构造一份只含声明字段的新对象，
// 这是「未声明字段被丢掉」唯一的实际执行者。
//
// 字段顺序与 SSE / JSON 输出顺序一致，改动顺序会改变线上报文的字节。

// Task 层已经不存在了：固定五阶段里 Task 和 Attempt 是 1:1 的，
// 顺序写在 harness 的控制流里而不是依赖图里，所以 Attempt 直接挂 Run + role。
const publicAttemptSchema = z.object({
  id: z.string(),
  role: roleSchema,
  ordinal: z.number(),
  status: z.enum(ATTEMPT_STATUSES),
  corrections: z.number(),
  failure_code: z.string().nullable(),
  started_at: z.string(),
  finished_at: z.string().nullable(),
});

const publicSubagentSchema = z.object({
  id: z.string(),
  parent_run_id: z.string(),
  role: roleSchema,
  ordinal: z.number(),
  mode: z.literal("one-shot"),
  tool_calls: z.number().int().nonnegative().nullable(),
  recent_activity: z.array(
    z.object({
      tool: z.string(),
      status: z.enum(["started", "completed", "unknown"]),
      created_at: z.string(),
    }),
  ),
  status: z.enum(ATTEMPT_STATUSES),
  stop_reason: z.string().nullable(),
  started_at: z.string(),
  finished_at: z.string().nullable(),
});

const publicCitationSchema = z.object({
  title: z.string(),
  locator: z.string(),
  url: z.string().nullable().default(null),
});

const publicEvidenceOutputSchema = z.object({
  result_summary: z.string().nullable().default(null),
  citations: z.array(publicCitationSchema).default([]),
});

const publicEvidenceSchema = z.object({
  id: z.string(),
  // 挂在哪次 Attempt 下。attempts[].id 本就出网，这是两个公开对象间的结构关联，
  // 轨迹视图按角色段分组靠它（2026-08-16 裁决，测试「证据行携带 attempt_id」看守）。
  attempt_id: z.string(),
  tool_name: z.string(),
  query: z.string(),
  status: z.string(),
  created_at: z.string(),
  // 缺 output 的证据行历史上没出现过，但真出现时不该把整个 snapshot 打成异常，
  // 界面少一段摘要比整页打不开好。
  output: publicEvidenceOutputSchema.default({ result_summary: null, citations: [] }),
});

// Artifact 正文不随 snapshot 出网，只给引用；正文走单独的 artifact 端点。
const publicArtifactReferenceSchema = z.object({
  id: z.string(),
  type: z.string(),
});

const publicAssessmentSchema = z.object({
  // 历史 Evidence Review 没有 candidate_id；新 run 必须有，但旧工件仍须可读。
  candidate_id: z.string().optional(),
  claim: z.string(),
  verdict: z.string(),
});

/** 候选假设的可核验字段对外公开：证据支持/反对、替代解释和不确定性不是内部思维，
 * 而是评审判断候选是否可检验所需的交付内容。研究 Artifact ID 仍留在内部 handoff。 */
const publicHypothesisCandidateSchema = hypothesisCandidateSchema.pick({
  candidate_id: true,
  claim_status: true,
  core_claim: true,
  basis: true,
  supporting_evidence_ids: true,
  opposing_evidence_ids: true,
  falsifiable_predictions: true,
  alternative_explanations: true,
  uncertainty: true,
  boundaries: true,
  validation_conditions: true,
});

const publicHypothesisComparisonSchema = hypothesisComparisonSchema.pick({
  criteria: true,
  evaluations: true,
  selected_candidate_id: true,
  selection_rationale: true,
});

// Artifact 详情也跨浏览器边界。每个角色只放 UI 真正展示的正文；Research 的原始
// queries/citations 与上游 Artifact ID 继续留在 store 内部，候选的证据关联则作为评审必需字段公开。
const publicArtifactContentSchema = z.discriminatedUnion("artifact_type", [
  researchSchema.pick({ artifact_type: true, research_framing: true, summary: true, claims: true, limitations: true }),
  z.object({
    artifact_type: z.literal("hypothesis"),
    question: z.string(),
    candidates: z.array(publicHypothesisCandidateSchema),
    comparison: publicHypothesisComparisonSchema,
    selection_status: z.literal("candidate_selected"),
  }),
  evidenceReviewSchema.pick({ artifact_type: true, gaps: true }).extend({
    // evidence_ids 和 rationale 都留在 Harness，UI 只展示判定本身。
    assessments: z.array(publicAssessmentSchema),
  }),
  researchPlanSchema.pick({
    artifact_type: true,
    problem_statement: true,
    rationale: true,
    technical_details: true,
    datasets: true,
    source: true,
    target: true,
    execution_plan: true,
    paper_title: true,
    paper_abstract: true,
    methods: true,
    experiments: true,
    results: true,
    references: true,
  }),
  reviewSchema.pick({
    artifact_type: true,
    accepted: true,
    independent_evidence_ids: true,
    scores: true,
    weaknesses: true,
    feedback: true,
  }),
]);

const publicArtifactSchema = z.object({
  id: z.string(),
  type: z.string(),
  content: publicArtifactContentSchema,
});

const publicRunEventSchema = z.object({
  id: z.number(),
  version: z.number(),
  kind: z.string(),
  payload: z.record(z.string(), displayScalarSchema),
  created_at: z.string(),
});

const publicRunSnapshotSchema = z.object({
  id: z.string(),
  question: z.string(),
  status: z.enum(RUN_STATUSES),
  current_role: roleSchema.nullable(),
  version: z.number(),
  error_code: z.string().nullable(),
  final_artifact_id: z.string().nullable(),
  attempts: z.array(publicAttemptSchema),
  subagents: z.array(publicSubagentSchema),
  tool_evidence: z.array(publicEvidenceSchema),
  omitted_evidence_count: z.number().int().nonnegative(),
  omitted_evidence_tools: z.array(z.string()),
  artifacts: z.array(publicArtifactReferenceSchema),
  recent_events: z.array(publicRunEventSchema),
});

export type PublicArtifact = z.infer<typeof publicArtifactSchema>;
export type PublicRunEvent = z.infer<typeof publicRunEventSchema>;
export type PublicRunSnapshot = z.infer<typeof publicRunSnapshotSchema>;

export function projectRunEvent(event: Record<string, unknown>): PublicRunEvent {
  return publicRunEventSchema.parse({
    id: event.id,
    version: event.version,
    kind: event.kind,
    payload: projectPayload(String(event.kind), event.payload),
    created_at: event.created_at,
  });
}

/** 从脱敏 trace 汇总观测值；不按角色猜关联，旧记录没有 Attempt 关联时保持未知。 */
function subagentActivity(attemptId: string, events: PublicRunEvent[]) {
  const calls = new Map<string, number>();
  const activity: { tool: string; status: "started" | "completed" | "unknown"; created_at: string }[] = [];
  for (const event of events) {
    const payload = event.payload;
    if (payload.attempt_id !== attemptId || typeof payload.trace_id !== "string") continue;
    const traceId = payload.trace_id;
    if (event.kind === "sdk.trace.started") calls.set(traceId, calls.get(traceId) ?? 0);
    if (event.kind === "sdk.trace.tool_started") calls.set(traceId, (calls.get(traceId) ?? 0) + 1);
    // 完整汇总可补齐中途被 trace 条数上界截断的工具事件。
    if (event.kind === "sdk.trace.ended" && typeof payload.usage_tool_calls === "number") {
      calls.set(traceId, Math.max(calls.get(traceId) ?? 0, payload.usage_tool_calls));
    }
    if (
      typeof payload.tool === "string" &&
      (event.kind === "sdk.trace.tool_started" || event.kind === "sdk.trace.tool_ended")
    ) {
      activity.push({
        tool: payload.tool,
        status:
          event.kind === "sdk.trace.tool_started"
            ? "started"
            : payload.status === "completed"
              ? "completed"
              : "unknown",
        created_at: event.created_at,
      });
    }
  }
  return {
    tool_calls: calls.size === 0 ? null : [...calls.values()].reduce((total, count) => total + count, 0),
    recent_activity: activity.slice(-5),
  };
}

/** 挑字段交给 publicRunSnapshotSchema，这里只做它表达不了的**按行**过滤。
 *
 * schema 能声明「哪些字段可以出去」，声明不了「哪些行不该出现」——
 * 非公开工具的证据、Harness 内部事件，都要在进 schema 之前就筛掉。
 */
export function projectRunSnapshot(snapshot: Record<string, unknown>): PublicRunSnapshot {
  const runId = String(snapshot.id);
  const events = (snapshot.recent_events as Record<string, unknown>[])
    .filter((event) => !HIDDEN_EVENT_KINDS.has(String(event.kind)))
    .map((event) => projectRunEvent(event));
  const attempts = snapshot.attempts as Record<string, unknown>[];
  const subagents = attempts.map((attempt) => ({
    id: attempt.id,
    parent_run_id: runId,
    role: attempt.role,
    ordinal: attempt.ordinal,
    mode: "one-shot",
    ...subagentActivity(String(attempt.id), events),
    status: attempt.status,
    stop_reason:
      attempt.status === "completed" ? "completed" : attempt.status === "failed" ? attempt.failure_code : null,
    started_at: attempt.started_at,
    finished_at: attempt.finished_at,
  }));
  const allEvidence = snapshot.tool_evidence as Record<string, unknown>[];
  const omittedEvidence = allEvidence.filter((row) => !PUBLIC_EVIDENCE_TOOLS.has(String(row.tool_name)));
  const evidence = allEvidence.filter((row) => PUBLIC_EVIDENCE_TOOLS.has(String(row.tool_name)));
  const omittedEvidenceTools = [...new Set(omittedEvidence.map((row) => String(row.tool_name)))];
  // 事件载荷按 kind 白名单，比字段声明更细：同一个 payload 字段在这个事件里
  // 能出去、在那个事件里不能。projectRunEvent 负责这一层。
  return publicRunSnapshotSchema.parse({
    ...snapshot,
    subagents,
    tool_evidence: evidence,
    omitted_evidence_count: omittedEvidence.length,
    omitted_evidence_tools: omittedEvidenceTools,
    recent_events: events,
  });
}

export function projectArtifact(artifact: Record<string, unknown>): PublicArtifact {
  return publicArtifactSchema.parse(artifact);
}

/** 返回一个 SSE 帧；事件该留在 Harness 内部时返回 null。 */
export function projectSseFrame(event: Record<string, unknown>): string | null {
  if (HIDDEN_EVENT_KINDS.has(String(event.kind))) return null;
  const data = JSON.stringify(projectRunEvent(event));
  return `id: ${String(event.version)}\nevent: ${String(event.kind)}\ndata: ${data}\n\n`;
}
