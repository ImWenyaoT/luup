/** Run 数据的公共投影。
 *
 * 浏览器是不可信边界。客户端拿到的每个字段都要经过这里，白名单之外的一律留在 Harness 内部。
 */

import { z } from "zod";

import {
  evidenceReviewSchema,
  hypothesisSchema,
  researchPlanSchema,
  researchSchema,
  reviewSchema,
  roleSchema,
} from "../agent/contracts.ts";
import { ATTEMPT_STATUSES, RUN_STATUSES } from "../store/schema.ts";

export type DisplayScalar = string | number | boolean | null;

const EVENT_PAYLOAD_FIELDS: Record<string, readonly string[]> = {
  "run.created": [],
  "tool.evidence_recorded": ["tool_name", "status", "result_count"],
  "artifact.published": ["artifact_type"],
  "attempt.failed": ["failure_code"],
  "run.failed": ["failure_code"],
  "run.review_rejected": ["failure_code"],
  "run.completed": ["final_artifact_id"],
  "attempt.started": ["role", "ordinal"],
  // 终局引用验收的计分板。逐条 checks 是数组，即使写进白名单也过不了类型闸，
  // 明细留在库内供报告引用，界面只拿到「查了几条、过没过」。
  "verification.references": [
    "ok",
    "reference_count",
    "frozen_sources",
    "arxiv_checked",
    "membership_only",
    "failed_count",
    "infra_error",
  ],
  // 开局注入了几条战役记录。它是消融生效门的事实来源，也是界面上「这个 run 带着
  // 多少历史开跑」的唯一说明；注入内容本身不出网，只放行条数。
  "campaign.prior_attempts": ["question_id", "count"],
  // 代码用冻结事实覆写了模型转述的某个字段。放行「哪份产物的哪个字段被覆写」，
  // 转录类字段再加两向计数 —— 它们是纯标量，也是 queries 权威改由台账持有之后
  // 新增的机制指标。before/after 与 missing/invented 的 ID 列表是模型写的原文，
  // 与 sdk.output_rejected 的 reason 同类，只作排障材料留在库内。
  "artifact.field_overwritten": ["artifact_type", "field", "missing_count", "invented_count"],
  // reason 不进公共投影：它是校验器的内部错误信息，只用于排障和调门槛。
  "sdk.structured_correction": ["corrections"],
  "sdk.usage": ["agent", "input_tokens", "output_tokens", "reasoning_tokens", "total_tokens"],
};

// sdk.output_rejected 带的是校验器内部错误信息，只用于排障，不该出网。
const HIDDEN_EVENT_KINDS: ReadonlySet<string> = new Set(["sdk.output_rejected"]);

// 这里写当前真正会落库的工具名。名字漏掉时后端不会报错，只会让 UI 静默少一条证据。
const PUBLIC_EVIDENCE_TOOLS: ReadonlySet<string> = new Set(["crossref_search", "arxiv_search"]);

const displayScalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

function isDisplayScalar(value: unknown): value is DisplayScalar {
  return value === null
    || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function projectPayload(kind: string, value: unknown): Record<string, DisplayScalar> {
  // 数组的 typeof 也是 "object"，漏掉这道判断会让 payload 变成按下标取字段。
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const payload: Record<string, DisplayScalar> = {};
  for (const field of EVENT_PAYLOAD_FIELDS[kind] ?? []) {
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
export const publicAttemptSchema = z.object({
  id: z.string(),
  role: roleSchema,
  ordinal: z.number(),
  status: z.enum(ATTEMPT_STATUSES),
  corrections: z.number(),
  failure_code: z.string().nullable(),
  started_at: z.string(),
  finished_at: z.string().nullable(),
});

export const publicCitationSchema = z.object({
  title: z.string(),
  locator: z.string(),
  url: z.string().nullable().default(null),
});

export const publicEvidenceOutputSchema = z.object({
  result_summary: z.string().nullable().default(null),
  citations: z.array(publicCitationSchema).default([]),
});

export const publicEvidenceSchema = z.object({
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
export const publicArtifactReferenceSchema = z.object({
  id: z.string(),
  type: z.string(),
});

const publicAssessmentSchema = z.object({
  claim: z.string(),
  verdict: z.string(),
});

// Artifact 详情也跨浏览器边界。每个角色只放 UI 真正展示的正文，证据 ID、上游 Artifact ID、
// 原始 queries/citations 等审计字段继续留在 store 内部。
export const publicArtifactContentSchema = z.discriminatedUnion("artifact_type", [
  researchSchema.pick({ artifact_type: true, summary: true, claims: true, limitations: true }),
  hypothesisSchema.pick({
    artifact_type: true,
    hypothesis: true,
    falsifiable_predictions: true,
    boundaries: true,
  }),
  evidenceReviewSchema.pick({ artifact_type: true, gaps: true }).extend({
    // evidence_ids 和 rationale 都留在 Harness，UI 只展示判定本身。
    assessments: z.array(publicAssessmentSchema),
  }),
  researchPlanSchema.pick({
    artifact_type: true,
    problem_statement: true,
    target: true,
    methods: true,
    experiments: true,
    results: true,
    references: true,
  }),
  reviewSchema.pick({
    artifact_type: true,
    accepted: true,
    scores: true,
    weaknesses: true,
    feedback: true,
  }),
]);

export const publicArtifactSchema = z.object({
  id: z.string(),
  type: z.string(),
  content: publicArtifactContentSchema,
});

export const publicRunEventSchema = z.object({
  id: z.number(),
  version: z.number(),
  kind: z.string(),
  payload: z.record(z.string(), displayScalarSchema),
  created_at: z.string(),
});

export const publicRunSnapshotSchema = z.object({
  id: z.string(),
  question: z.string(),
  status: z.enum(RUN_STATUSES),
  current_role: roleSchema.nullable(),
  version: z.number(),
  error_code: z.string().nullable(),
  final_artifact_id: z.string().nullable(),
  attempts: z.array(publicAttemptSchema),
  tool_evidence: z.array(publicEvidenceSchema),
  artifacts: z.array(publicArtifactReferenceSchema),
  recent_events: z.array(publicRunEventSchema),
});

export type PublicAttempt = z.infer<typeof publicAttemptSchema>;
export type PublicCitation = z.infer<typeof publicCitationSchema>;
export type PublicEvidence = z.infer<typeof publicEvidenceSchema>;
export type PublicArtifactReference = z.infer<typeof publicArtifactReferenceSchema>;
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

/** 挑字段交给 publicRunSnapshotSchema，这里只做它表达不了的**按行**过滤。
 *
 * schema 能声明「哪些字段可以出去」，声明不了「哪些行不该出现」——
 * 非公开工具的证据、Harness 内部事件，都要在进 schema 之前就筛掉。
 */
export function projectRunSnapshot(snapshot: Record<string, unknown>): PublicRunSnapshot {
  const evidence = (snapshot.tool_evidence as Record<string, unknown>[])
    .filter((row) => PUBLIC_EVIDENCE_TOOLS.has(String(row.tool_name)));
  // 事件载荷按 kind 白名单，比字段声明更细：同一个 payload 字段在这个事件里
  // 能出去、在那个事件里不能。projectRunEvent 负责这一层。
  const events = (snapshot.recent_events as Record<string, unknown>[])
    .filter((event) => !HIDDEN_EVENT_KINDS.has(String(event.kind)))
    .map((event) => projectRunEvent(event));
  return publicRunSnapshotSchema.parse({ ...snapshot, tool_evidence: evidence, recent_events: events });
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
