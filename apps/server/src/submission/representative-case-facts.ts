import type { Role } from "../agent/contracts.ts";

import {
  nonNegativeIntSchema,
  isRecord,
  lastEvent,
  parseChangedFieldsList,
  parseNullableId,
  parseNullableInt,
  parseNullableNonNegativeInt,
  parseReasonCode,
  parseSafeId,
  unique,
} from "./representative-case-parsing.ts";
import { readPublicArtifact } from "./representative-case-public-artifacts.ts";
import {
  REPRESENTATIVE_CASE_FORMAT,
  REPRESENTATIVE_CASE_VERSION,
  ROLE_SET,
  type CaseEvent,
  type EvaluationAction,
  type FactStatus,
  type FeedbackSource,
  type RepresentativeCaseExport,
  type RepresentativeCaseReadSource,
  type RepresentativeCaseRound,
  type RepresentativeCaseTrace,
  type RepresentativeCaseUsage,
  type RepresentativeCaseVerification,
} from "./representative-case-types.ts";

export function buildRound(
  round: 1 | 2,
  store: RepresentativeCaseReadSource,
  events: readonly CaseEvent[],
  artifacts: RepresentativeCaseExport["artifacts"],
  rootReasons: string[],
): RepresentativeCaseRound {
  const reasons: string[] = [];
  const evaluation = lastEvent(events, "evaluation.round", round);
  const feedbackEvent = lastEvent(events, "feedback.received", round);
  const revisionEvent = lastEvent(events, "revision.applied", round);
  if (evaluation === null) reasons.push(`round${round}_evaluation_missing`);
  const evaluationPayload = evaluation?.payload ?? {};
  const feedbackPayload = feedbackEvent?.payload ?? evaluationPayload;
  const revisionPayload = revisionEvent?.payload ?? evaluationPayload;
  const present = evaluation !== null;
  const rawPlan =
    parseSafeId(evaluationPayload.raw_plan_artifact_id) ?? (round === 1 ? (artifacts.research_plan[0] ?? null) : null);
  const rawReview =
    parseSafeId(evaluationPayload.raw_review_artifact_id) ?? (round === 1 ? (artifacts.review[0] ?? null) : null);
  const plan = parseSafeId(evaluationPayload.plan_artifact_id);
  const review = parseSafeId(evaluationPayload.review_artifact_id);

  const fbSource = feedbackPayload.feedback_source;
  const feedbackSource: FeedbackSource =
    fbSource === "auto" || fbSource === "human" ? fbSource : (reasons.push("feedback_source_unknown"), "unknown");
  const fbActor = feedbackPayload.source ?? evaluationPayload.evaluator;
  const feedbackActor: "model_reviewer" | "human" | "unknown" =
    fbActor === "model_reviewer" || fbActor === "human" ? fbActor : (reasons.push("feedback_actor_unknown"), "unknown");

  const actionVal = evaluationPayload.action ?? feedbackPayload.action;
  const action: EvaluationAction =
    actionVal === "accept" || actionVal === "revise" || actionVal === "stop"
      ? actionVal
      : (reasons.push("evaluation_action_unknown"), "unknown");

  const changedFields = parseChangedFieldsList(revisionPayload.changed_fields, reasons);
  const fromArtifactId = parseSafeId(revisionPayload.from_artifact_id);
  const toArtifactId = parseSafeId(revisionPayload.to_artifact_id);
  const stopReason = parseReasonCode(evaluationPayload.stop_reason, reasons, "stop_reason_unknown");
  const retryReason = parseReasonCode(evaluationPayload.retry_reason, reasons, "retry_reason_unknown");
  const rollbackReason = parseReasonCode(evaluationPayload.rollback_reason, reasons, "rollback_reason_unknown");

  const phaseVal = evaluationPayload.phase;
  const phase: RepresentativeCaseRound["phase"] =
    phaseVal === "raw" || phaseVal === "revision" ? phaseVal : (reasons.push("evaluation_phase_unknown"), "unknown");

  const publicOutputs = {
    plan: readPublicArtifact(store, plan, reasons, `round${round}_plan`),
    review: readPublicArtifact(store, review, reasons, `round${round}_review`),
  };

  const output: RepresentativeCaseRound = {
    present,
    phase,
    action,
    raw_artifact_ids: { plan: rawPlan, review: rawReview },
    plan_artifact_id: plan,
    review_artifact_id: review,
    feedback: {
      source: feedbackActor,
      feedback_source: feedbackSource,
      action:
        feedbackPayload.action === "accept" || feedbackPayload.action === "revise" || feedbackPayload.action === "stop"
          ? feedbackPayload.action
          : action,
      count: parseNullableNonNegativeInt(feedbackPayload.feedback_count, reasons, "feedback_count_unknown"),
      artifact_id: parseNullableId(feedbackPayload.feedback_artifact_id),
    },
    revision: {
      from_artifact_id: fromArtifactId,
      to_artifact_id: toArtifactId,
      changed_fields: changedFields,
    },
    score: {
      before: parseNullableNonNegativeInt(evaluationPayload.score_before_total, reasons, "score_before_unknown"),
      after: parseNullableNonNegativeInt(evaluationPayload.score_after_total, reasons, "score_after_unknown"),
      delta: parseNullableInt(evaluationPayload.score_delta_total, reasons, "score_delta_unknown"),
    },
    cost_tokens: {
      round: parseNullableNonNegativeInt(evaluationPayload.round_cost_tokens, reasons, "round_cost_unknown"),
      delta: parseNullableInt(evaluationPayload.cost_delta_tokens, reasons, "cost_delta_unknown"),
    },
    limitations: {
      before: parseNullableNonNegativeInt(
        evaluationPayload.limitations_before_count,
        reasons,
        "limitations_before_unknown",
      ),
      after: parseNullableNonNegativeInt(
        evaluationPayload.limitations_after_count,
        reasons,
        "limitations_after_unknown",
      ),
      delta: parseNullableInt(evaluationPayload.limitation_delta_count, reasons, "limitation_delta_unknown"),
    },
    stop_reason: stopReason,
    retry_reason: retryReason,
    rollback_reason: rollbackReason,
    public_outputs: publicOutputs,
    unknown_reasons: unique(reasons),
  };
  rootReasons.push(...output.unknown_reasons);
  return output;
}

export function buildVerification(events: readonly CaseEvent[], rootReasons: string[]): RepresentativeCaseVerification {
  const reasons: string[] = [];
  const event = lastEvent(events, "verification.references");
  if (event === null) {
    reasons.push("verification_missing");
    rootReasons.push(...reasons);
    return {
      status: "unknown",
      ok: null,
      reference_count: null,
      frozen_sources: null,
      arxiv_checked: null,
      doi_checked: null,
      membership_only: null,
      failed_count: null,
      infra_error: null,
      check_count: null,
      passed_check_count: null,
      failed_check_count: null,
      unknown_reasons: reasons,
    };
  }
  const payload = event.payload;
  const ok = typeof payload.ok === "boolean" ? payload.ok : (reasons.push("verification_ok_unknown"), null);
  const checks = Array.isArray(payload.checks) ? payload.checks : (reasons.push("verification_checks_unknown"), null);
  let passedCheckCount: number | null = null;
  let failedCheckCount: number | null = null;
  if (checks !== null) {
    let passed = 0;
    let failed = 0;
    for (const check of checks) {
      if (!isRecord(check) || typeof check.pass !== "boolean") reasons.push("verification_check_malformed");
      else if (check.pass) passed += 1;
      else failed += 1;
    }
    passedCheckCount = passed;
    failedCheckCount = failed;
  }
  const failedCount = parseNullableNonNegativeInt(payload.failed_count, reasons, "verification_failed_count_unknown");
  const infraError =
    typeof payload.infra_error === "boolean"
      ? payload.infra_error
      : (reasons.push("verification_infra_error_unknown"), null);
  const referenceCount = parseNullableNonNegativeInt(
    payload.reference_count,
    reasons,
    "verification_reference_count_unknown",
  );
  const frozenSources = parseNullableNonNegativeInt(
    payload.frozen_sources,
    reasons,
    "verification_frozen_sources_unknown",
  );
  const arxivChecked = parseNullableNonNegativeInt(
    payload.arxiv_checked,
    reasons,
    "verification_arxiv_checked_unknown",
  );
  const doiChecked = parseNullableNonNegativeInt(payload.doi_checked, reasons, "verification_doi_checked_unknown");
  const membershipOnly = parseNullableNonNegativeInt(
    payload.membership_only,
    reasons,
    "verification_membership_only_unknown",
  );
  const checkCount = checks !== null ? checks.length : null;

  const status = ok === true ? "passed" : ok === false ? "failed" : "unknown";
  const output: RepresentativeCaseVerification = {
    status,
    ok,
    reference_count: referenceCount,
    frozen_sources: frozenSources,
    arxiv_checked: arxivChecked,
    doi_checked: doiChecked,
    membership_only: membershipOnly,
    failed_count: failedCount,
    infra_error: infraError,
    check_count: checkCount,
    passed_check_count: passedCheckCount,
    failed_check_count: failedCheckCount,
    unknown_reasons: unique(reasons),
  };
  rootReasons.push(...output.unknown_reasons);
  return output;
}

export function buildTrace(events: readonly CaseEvent[], rootReasons: string[]): RepresentativeCaseTrace {
  const reasons: string[] = [];
  const started = events.filter((e) => e.kind === "sdk.trace.started");
  const ended = events.filter((e) => e.kind === "sdk.trace.ended");
  const models = new Set<string>();
  const byRole = new Map<string, { traces: number; completed: number; failed: number; unknown: number }>();
  let completed = 0;
  let failed = 0;
  let unknown = 0;
  let truncated = 0;
  let traceEventsTotal = 0;
  let toolCallsTotal = 0;

  for (const event of started) {
    const role =
      typeof event.payload.role === "string" && ROLE_SET.has(event.payload.role) ? event.payload.role : "unknown";
    const current = byRole.get(role) ?? { traces: 0, completed: 0, failed: 0, unknown: 0 };
    current.traces += 1;
    byRole.set(role, current);
    if (typeof event.payload.model === "string") models.add(event.payload.model);
  }

  for (const event of ended) {
    const role =
      typeof event.payload.role === "string" && ROLE_SET.has(event.payload.role) ? event.payload.role : "unknown";
    const current = byRole.get(role) ?? { traces: 0, completed: 0, failed: 0, unknown: 0 };
    const outcome = event.payload.outcome;
    if (outcome === "completed") {
      completed += 1;
      current.completed += 1;
    } else if (outcome === "failed") {
      failed += 1;
      current.failed += 1;
    } else {
      unknown += 1;
      current.unknown += 1;
    }
    byRole.set(role, current);

    if (event.payload.truncated === true) truncated += 1;
    if (typeof event.payload.trace_events === "number") traceEventsTotal += event.payload.trace_events;
    if (typeof event.payload.usage_tool_calls === "number") toolCallsTotal += event.payload.usage_tool_calls;
  }

  const toolStarted = events.filter((e) => e.kind === "tool.evidence_recorded").length;
  const toolEnded = toolStarted;
  const callbackErrors = events.filter((e) => e.kind === "sdk.output_rejected").length;
  const traces = Math.max(started.length, ended.length);
  const status: FactStatus = traces === 0 ? "unknown" : reasons.length === 0 ? "known" : "partial";

  const output: RepresentativeCaseTrace = {
    status,
    models: [...models].sort(),
    traces,
    completed,
    failed,
    unknown,
    tool_started: toolStarted,
    tool_ended: toolEnded,
    callback_errors: callbackErrors,
    trace_events: traces > 0 ? traceEventsTotal : null,
    tool_calls: traces > 0 ? toolCallsTotal : null,
    truncated,
    by_role: [...byRole.entries()]
      .map(([role, stats]) => ({ role, ...stats }))
      .sort((a, b) => a.role.localeCompare(b.role)),
    unknown_reasons: unique(reasons),
  };
  rootReasons.push(...output.unknown_reasons);
  return output;
}

export function buildUsage(
  events: readonly CaseEvent[],
  rootReasons: string[],
  attempts: unknown,
): RepresentativeCaseUsage {
  const reasons: string[] = [];
  const usageEvents = events.filter((e) => e.kind === "sdk.usage");
  let validRecords = 0;
  let unknownRecords = 0;
  let inputTotal = 0;
  let outputTotal = 0;
  let totalTotal = 0;
  const byAgent = new Map<
    Role,
    { records: number; input_tokens: number; output_tokens: number; total_tokens: number }
  >();

  for (const event of usageEvents) {
    const p = event.payload;
    const agent = typeof p.agent === "string" && ROLE_SET.has(p.agent) ? (p.agent as Role) : null;
    const input = nonNegativeIntSchema.safeParse(p.input_tokens);
    const output = nonNegativeIntSchema.safeParse(p.output_tokens);
    const total = nonNegativeIntSchema.safeParse(p.total_tokens);

    if (agent && input.success && output.success && total.success) {
      validRecords += 1;
      inputTotal += input.data;
      outputTotal += output.data;
      totalTotal += total.data;
      const current = byAgent.get(agent) ?? { records: 0, input_tokens: 0, output_tokens: 0, total_tokens: 0 };
      current.records += 1;
      current.input_tokens += input.data;
      current.output_tokens += output.data;
      current.total_tokens += total.data;
      byAgent.set(agent, current);
    } else {
      unknownRecords += 1;
      reasons.push("usage_record_malformed");
    }
  }

  // sdk.usage 只在已知用量时写入；必须对照 Attempt 事实，不能把其余角色的小计当作总成本。
  const reportedByRole = new Map<string, number>();
  for (const event of usageEvents) {
    const role = event.payload.agent;
    if (typeof role === "string") reportedByRole.set(role, (reportedByRole.get(role) ?? 0) + 1);
  }
  if (!Array.isArray(attempts)) {
    unknownRecords += 1;
    reasons.push("usage_attempts_unknown");
  } else {
    for (const attempt of attempts) {
      const role = isRecord(attempt) && typeof attempt.role === "string" ? attempt.role : null;
      const available = role === null ? 0 : (reportedByRole.get(role) ?? 0);
      if (available > 0 && role !== null) reportedByRole.set(role, available - 1);
      else {
        unknownRecords += 1;
        reasons.push("usage_record_missing");
      }
    }
  }
  const records = validRecords + unknownRecords;
  const status: FactStatus = usageEvents.length === 0 ? "unknown" : unknownRecords === 0 ? "known" : "partial";
  const output: RepresentativeCaseUsage = {
    status,
    records,
    valid_records: validRecords,
    unknown_records: unknownRecords,
    input_tokens: status === "known" ? inputTotal : null,
    output_tokens: status === "known" ? outputTotal : null,
    total_tokens: status === "known" ? totalTotal : null,
    by_agent: [...byAgent.entries()]
      .map(([agent, stats]) => ({ agent, ...stats }))
      .sort((a, b) => a.agent.localeCompare(b.agent)),
    unknown_reasons: unique(reasons),
  };
  rootReasons.push(...output.unknown_reasons);
  return output;
}

export function unknownCase(runId: string | null, generatedAt: string, reason: string): RepresentativeCaseExport {
  return {
    format: REPRESENTATIVE_CASE_FORMAT,
    version: REPRESENTATIVE_CASE_VERSION,
    generated_at: generatedAt,
    run_id: runId,
    run: {
      science125_id: null,
      status: "unknown",
      question: null,
      error_code: null,
      final_artifact_id: null,
    },
    artifacts: { research: [], hypothesis: [], evidence_review: [], research_plan: [], review: [], unknown: [] },
    public_artifacts: { research: [], hypothesis: [], evidence_review: [] },
    source_ledger: { status: "unknown", records: [], unknown_records: 0, unknown_reasons: [reason] },
    rounds: {
      round1: {
        present: false,
        phase: "unknown",
        action: "unknown",
        raw_artifact_ids: { plan: null, review: null },
        plan_artifact_id: null,
        review_artifact_id: null,
        feedback: { source: "unknown", feedback_source: "unknown", action: "unknown", count: null, artifact_id: null },
        revision: { from_artifact_id: null, to_artifact_id: null, changed_fields: [] },
        score: { before: null, after: null, delta: null },
        cost_tokens: { round: null, delta: null },
        limitations: { before: null, after: null, delta: null },
        stop_reason: null,
        retry_reason: null,
        rollback_reason: null,
        public_outputs: { plan: null, review: null },
        unknown_reasons: ["round1_evaluation_missing"],
      },
      round2: {
        present: false,
        phase: "unknown",
        action: "unknown",
        raw_artifact_ids: { plan: null, review: null },
        plan_artifact_id: null,
        review_artifact_id: null,
        feedback: { source: "unknown", feedback_source: "unknown", action: "unknown", count: null, artifact_id: null },
        revision: { from_artifact_id: null, to_artifact_id: null, changed_fields: [] },
        score: { before: null, after: null, delta: null },
        cost_tokens: { round: null, delta: null },
        limitations: { before: null, after: null, delta: null },
        stop_reason: null,
        retry_reason: null,
        rollback_reason: null,
        public_outputs: { plan: null, review: null },
        unknown_reasons: ["round2_evaluation_missing"],
      },
    },
    verification: {
      status: "unknown",
      ok: null,
      reference_count: null,
      frozen_sources: null,
      arxiv_checked: null,
      doi_checked: null,
      membership_only: null,
      failed_count: null,
      infra_error: null,
      check_count: null,
      passed_check_count: null,
      failed_check_count: null,
      unknown_reasons: ["verification_missing"],
    },
    trace: {
      status: "unknown",
      models: [],
      traces: 0,
      completed: 0,
      failed: 0,
      unknown: 0,
      tool_started: 0,
      tool_ended: 0,
      callback_errors: 0,
      trace_events: null,
      tool_calls: null,
      truncated: 0,
      by_role: [],
      unknown_reasons: ["trace_missing"],
    },
    usage: {
      status: "unknown",
      records: 0,
      valid_records: 0,
      unknown_records: 0,
      input_tokens: null,
      output_tokens: null,
      total_tokens: null,
      by_agent: [],
      unknown_reasons: ["usage_missing"],
    },
    unknown_reasons: unique([
      reason,
      "round1_evaluation_missing",
      "round2_evaluation_missing",
      "verification_missing",
      "trace_missing",
      "usage_missing",
    ]),
  };
}
