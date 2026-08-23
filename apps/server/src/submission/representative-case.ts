import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";

import { FAILURE_CODES } from "../agent/failures.ts";
import type { Role } from "../agent/contracts.ts";
import { projectArtifact, type PublicArtifact } from "../api/projection.ts";
import { findQuestion, science125Integrity } from "../domain/science125.ts";
import { SqliteStore, type StoredArtifact } from "../store/store.ts";

export const REPRESENTATIVE_CASE_FORMAT = "luup.representative-case" as const;
export const REPRESENTATIVE_CASE_VERSION = 3 as const;

type CaseStatus = "running" | "completed" | "review_rejected" | "failed" | "unknown";
type FactStatus = "known" | "partial" | "unknown";
type FeedbackSource = "auto" | "human" | "unknown";
type EvaluationAction = "accept" | "revise" | "stop" | "unknown";

export type RepresentativeCaseRound = {
  present: boolean;
  phase: "raw" | "revision" | "unknown";
  action: EvaluationAction;
  raw_artifact_ids: { plan: string | null; review: string | null };
  plan_artifact_id: string | null;
  review_artifact_id: string | null;
  feedback: {
    source: "model_reviewer" | "human" | "unknown";
    feedback_source: FeedbackSource;
    action: EvaluationAction;
    count: number | null;
    artifact_id: string | null;
  };
  revision: {
    from_artifact_id: string | null;
    to_artifact_id: string | null;
    changed_fields: string[];
  };
  score: { before: number | null; after: number | null; delta: number | null };
  cost_tokens: { round: number | null; delta: number | null };
  limitations: { before: number | null; after: number | null; delta: number | null };
  stop_reason: string | null;
  retry_reason: string | null;
  rollback_reason: string | null;
  public_outputs: {
    plan: RepresentativeCasePublicArtifact | null;
    review: RepresentativeCasePublicArtifact | null;
  };
  unknown_reasons: string[];
};

export type RepresentativeCaseVerification = {
  status: "passed" | "failed" | "unknown";
  ok: boolean | null;
  reference_count: number | null;
  frozen_sources: number | null;
  arxiv_checked: number | null;
  doi_checked: number | null;
  membership_only: number | null;
  failed_count: number | null;
  infra_error: boolean | null;
  check_count: number | null;
  passed_check_count: number | null;
  failed_check_count: number | null;
  unknown_reasons: string[];
};

export type RepresentativeCaseTrace = {
  status: FactStatus;
  models: string[];
  traces: number;
  completed: number;
  failed: number;
  unknown: number;
  tool_started: number;
  tool_ended: number;
  callback_errors: number;
  trace_events: number | null;
  tool_calls: number | null;
  truncated: number;
  by_role: Array<{ role: string; traces: number; completed: number; failed: number; unknown: number }>;
  unknown_reasons: string[];
};

export type RepresentativeCaseUsage = {
  status: FactStatus;
  records: number;
  valid_records: number;
  unknown_records: number;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  by_agent: Array<{
    agent: Role;
    records: number;
    input_tokens: number | null;
    output_tokens: number | null;
    total_tokens: number | null;
  }>;
  unknown_reasons: string[];
};

export type RepresentativeCaseExport = {
  format: typeof REPRESENTATIVE_CASE_FORMAT;
  version: typeof REPRESENTATIVE_CASE_VERSION;
  generated_at: string;
  run_id: string | null;
  run: {
    science125_id: number | null;
    status: CaseStatus;
    question: string | null;
    error_code: string | null;
    final_artifact_id: string | null;
  };
  artifacts: {
    research: string[];
    hypothesis: string[];
    evidence_review: string[];
    research_plan: string[];
    review: string[];
    unknown: string[];
  };
  public_artifacts: {
    research: RepresentativeCasePublicArtifact[];
    hypothesis: RepresentativeCasePublicArtifact[];
    evidence_review: RepresentativeCasePublicArtifact[];
  };
  source_ledger: RepresentativeCaseSourceLedger;
  rounds: { round1: RepresentativeCaseRound; round2: RepresentativeCaseRound };
  verification: RepresentativeCaseVerification;
  trace: RepresentativeCaseTrace;
  usage: RepresentativeCaseUsage;
  strict?: RepresentativeCaseStrictReport;
  unknown_reasons: string[];
};

export type RepresentativeCaseStrictReport = {
  passed: boolean;
  reasons: string[];
};

export type RepresentativeCaseReadSource = {
  snapshot(runId: string): Record<string, unknown> | null;
  artifact(artifactId: string): StoredArtifact | null;
};

export type ExportRepresentativeCaseOptions = {
  dbPath: string;
  runId: string;
  jsonPath: string;
  markdownPath?: string;
  generatedAt?: string;
  strict?: boolean;
  store?: SqliteStore;
};

const ROLES: readonly Role[] = ["researcher", "hypothesis-generation", "evidence-review", "research-plan", "reviewer"];
const ROLE_SET = new Set<string>(ROLES);
const FAILURE_CODE_SET = new Set<string>([...FAILURE_CODES, "review_rejected"]);
const RUN_STATUS_SET = new Set<string>(["running", "completed", "review_rejected", "failed"]);
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const FIELD_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]{0,100}$/;

type UnknownRecord = Record<string, unknown>;
type CaseEvent = { kind: string; payload: UnknownRecord };

type PublicResearchContent = Extract<PublicArtifact["content"], { artifact_type: "research" }>;
type PublicHypothesisContent = Extract<PublicArtifact["content"], { artifact_type: "hypothesis" }>;
type PublicEvidenceReviewContent = Extract<PublicArtifact["content"], { artifact_type: "evidence-review" }>;
type PublicResearchPlanContent = Extract<PublicArtifact["content"], { artifact_type: "research-plan" }>;
type PublicReviewContent = Extract<PublicArtifact["content"], { artifact_type: "review" }>;

type SubmissionHypothesisComparison = {
  criteria: Array<{ criterion: string }>;
  evaluations: Array<{
    candidate_id: string;
    rank: number;
    strengths: string[];
    weaknesses: string[];
    evidence_ids: string[];
  }>;
  selected_candidate_id: string;
};

type SubmissionPublicContent =
  | Pick<PublicResearchContent, "artifact_type" | "research_framing" | "summary" | "claims" | "limitations">
  | (Pick<PublicHypothesisContent, "artifact_type" | "question" | "candidates" | "selection_status"> & {
      comparison: SubmissionHypothesisComparison;
    })
  | Pick<PublicEvidenceReviewContent, "artifact_type" | "gaps" | "assessments">
  | Pick<
      PublicResearchPlanContent,
      | "artifact_type"
      | "problem_statement"
      | "technical_details"
      | "datasets"
      | "source"
      | "target"
      | "execution_plan"
      | "paper_title"
      | "paper_abstract"
      | "methods"
      | "experiments"
      | "results"
      | "references"
    >
  | Pick<PublicReviewContent, "artifact_type" | "accepted" | "scores" | "weaknesses" | "feedback">;

export type RepresentativeCasePublicArtifact = {
  id: string;
  type: string;
  content: SubmissionPublicContent;
};

export type RepresentativeCaseSourceLedgerEntry = {
  evidence_id: string;
  attempt_id: string | null;
  evidence_status: string | null;
  acquisition: {
    method: "search_tool" | "unknown";
    tool: string | null;
    query: string | null;
  };
  availability: {
    status: "available" | "partial" | "unavailable" | "unknown";
    evidence_status: string | null;
  };
  source: {
    source_type: "web" | "arxiv" | null;
    title: string | null;
    locator: string | null;
    url: string | null;
  } | null;
  hypothesis_roles: Array<{
    artifact_id: string;
    candidate_id: string;
    role: "supporting" | "opposing";
  }>;
  artifact_uses: Array<{
    artifact_id: string;
    artifact_type: "research" | "hypothesis" | "evidence-review" | "research-plan" | "review";
    relation:
      | "research_query"
      | "research_claim"
      | "hypothesis_supporting"
      | "hypothesis_opposing"
      | "hypothesis_comparison"
      | "evidence_review"
      | "plan_grounding"
      | "plan_verification"
      | "review_independent";
    candidate_id: string | null;
  }>;
  limitations: string[];
  unknown_reasons: string[];
};

export type RepresentativeCaseSourceLedger = {
  status: FactStatus;
  records: RepresentativeCaseSourceLedgerEntry[];
  unknown_records: number;
  unknown_reasons: string[];
};

type HypothesisRole = RepresentativeCaseSourceLedgerEntry["hypothesis_roles"][number];
type SourceLedgerUse = RepresentativeCaseSourceLedgerEntry["artifact_uses"][number];
type SourceLedgerRelations = {
  artifactUses: SourceLedgerUse[];
  hypothesisRoles: HypothesisRole[];
};

// ---------------------------------------------------------------------------
// Zod parser schemas & helpers
// ---------------------------------------------------------------------------

const safeIdSchema = z.string().regex(ID_PATTERN);
const safeReasonCodeSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,100}$/);
const nonNegativeIntSchema = z.number().int().min(0);

function parseSafeId(value: unknown): string | null {
  const parsed = safeIdSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function parseNullableId(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return parseSafeId(value);
}

function parseReasonCode(value: unknown, reasons: string[], reason: string): string | null {
  if (value === null || value === undefined) return null;
  const parsed = safeReasonCodeSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  reasons.push(reason);
  return null;
}

function parseNullableNonNegativeInt(value: unknown, reasons: string[], reason: string): number | null {
  if (value === null || value === undefined) return null;
  const parsed = nonNegativeIntSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  reasons.push(reason);
  return null;
}

function parseNullableInt(value: unknown, reasons: string[], reason: string): number | null {
  if (value === null || value === undefined) return null;
  const parsed = z.number().int().safeParse(value);
  if (parsed.success) return parsed.data;
  reasons.push(reason);
  return null;
}

function parseChangedFieldsList(value: unknown, reasons: string[]): string[] {
  if (value === null || value === undefined || value === "") return [];
  if (typeof value !== "string") {
    reasons.push("changed_fields_unknown");
    return [];
  }
  const fields = value
    .split(",")
    .map((field) => field.trim())
    .filter(Boolean);
  const valid = fields.filter((field) => FIELD_PATTERN.test(field));
  if (valid.length !== fields.length) reasons.push("changed_fields_unknown");
  return [...new Set(valid)].sort();
}

export function buildRepresentativeCase(
  store: RepresentativeCaseReadSource,
  runId: string,
  generatedAt = new Date().toISOString(),
): RepresentativeCaseExport {
  const safeRunId = parseSafeId(runId);
  const snapshot = store.snapshot(runId);
  if (snapshot === null) return unknownCase(safeRunId, generatedAt, "run_not_found");

  const rootReasons: string[] = [];
  const statusStr =
    typeof snapshot.status === "string" && RUN_STATUS_SET.has(snapshot.status) ? snapshot.status : "unknown";
  const runStatus: CaseStatus = statusStr as CaseStatus;
  if (runStatus === "unknown") rootReasons.push("run_status_unknown");

  let science125Id: number | null = null;
  if (snapshot.science125_id !== null && snapshot.science125_id !== undefined) {
    const parsed = z.number().int().min(1).safeParse(snapshot.science125_id);
    if (parsed.success) science125Id = parsed.data;
    else rootReasons.push("science125_id_unknown");
  }

  const question =
    typeof snapshot.question === "string" && snapshot.question.length <= 4000
      ? redactSensitiveText(snapshot.question)
      : null;
  if (question === null) rootReasons.push("question_unknown");

  let errorCode: string | null = null;
  if (snapshot.error_code !== null && snapshot.error_code !== undefined) {
    if (typeof snapshot.error_code === "string" && FAILURE_CODE_SET.has(snapshot.error_code)) {
      errorCode = snapshot.error_code;
    } else {
      rootReasons.push("error_code_unknown");
    }
  }

  const finalArtifactId = parseSafeId(snapshot.final_artifact_id);
  if (snapshot.final_artifact_id !== null && finalArtifactId === null) rootReasons.push("final_artifact_id_unknown");

  const events = readEvents(snapshot.recent_events, rootReasons);
  const artifacts = readArtifacts(snapshot.artifacts, rootReasons);
  const publicArtifacts = buildPublicArtifacts(store, artifacts, rootReasons);
  const sourceLedger = buildSourceLedger(snapshot.tool_evidence, store, artifacts, rootReasons);
  const round1 = buildRound(1, store, events, artifacts, rootReasons);
  const round2 = buildRound(2, store, events, artifacts, rootReasons);
  const verification = buildVerification(events, rootReasons);
  const trace = buildTrace(events, rootReasons);
  const usage = buildUsage(events, rootReasons);

  return {
    format: REPRESENTATIVE_CASE_FORMAT,
    version: REPRESENTATIVE_CASE_VERSION,
    generated_at: generatedAt,
    run_id: safeRunId,
    run: {
      science125_id: science125Id,
      status: runStatus,
      question,
      error_code: errorCode,
      final_artifact_id: finalArtifactId,
    },
    artifacts,
    public_artifacts: publicArtifacts,
    source_ledger: sourceLedger,
    rounds: { round1, round2 },
    verification,
    trace,
    usage,
    unknown_reasons: unique(rootReasons),
  };
}

export function checkRepresentativeCaseStrict(
  store: RepresentativeCaseReadSource,
  value: RepresentativeCaseExport,
): RepresentativeCaseStrictReport {
  const reasons: string[] = [];
  const catalog = science125Integrity();
  if (!catalog.ok) reasons.push("frozen_catalog_invalid");
  const science125Id = value.run.science125_id;
  if (science125Id === null || findQuestion(science125Id) === null) {
    reasons.push("science125_id_not_in_frozen_catalog");
  }
  if (value.run.status !== "completed") reasons.push("run_not_completed");
  if (!value.rounds.round1.present) reasons.push("round1_missing");
  if (!value.rounds.round2.present) reasons.push("round2_missing");
  if (
    value.source_ledger.status !== "known" ||
    value.source_ledger.records.length === 0 ||
    value.source_ledger.unknown_records > 0
  ) {
    reasons.push("source_ledger_missing_or_unknown");
  }

  const snapshot = value.run_id === null ? null : store.snapshot(value.run_id);
  const events = snapshot === null ? [] : readEvents(snapshot.recent_events, []);
  if (!events.some((event) => event.kind === "feedback.received")) reasons.push("feedback_missing");

  const revisions = events.filter((event) => event.kind === "revision.applied");
  if (revisions.length === 0) {
    reasons.push("revision_missing");
  } else {
    const hasAuditableRevision = revisions.some((event) => {
      const from = parseSafeId(event.payload.from_artifact_id);
      const to = parseSafeId(event.payload.to_artifact_id);
      const fields = parseChangedFieldsList(event.payload.changed_fields, []);
      return from !== null && to !== null && fields.length > 0;
    });
    if (!hasAuditableRevision) reasons.push("revision_facts_incomplete");
  }

  const verificationEvent = lastEvent(events, "verification.references");
  if (verificationEvent === null) {
    reasons.push("verification_missing");
    reasons.push(
      "verification_b1_missing",
      "verification_b2_missing",
      "verification_b3_missing",
      "verification_b4_missing",
    );
  } else {
    if (verificationEvent.payload.ok !== true) reasons.push("verification_not_passed");
    const checks = Array.isArray(verificationEvent.payload.checks) ? verificationEvent.payload.checks : [];
    for (const family of ["b1", "b2", "b3", "b4"] as const) {
      const familyChecks = checks.filter(
        (check): check is UnknownRecord =>
          isRecord(check) && typeof check.id === "string" && check.id.toLowerCase().startsWith(`${family}.`),
      );
      if (familyChecks.length === 0) reasons.push(`verification_${family}_missing`);
      else if (familyChecks.some((check) => check.pass !== true)) reasons.push(`verification_${family}_failed`);
    }
  }

  if (
    value.usage.status !== "known" ||
    value.usage.records === 0 ||
    value.usage.unknown_records !== 0 ||
    value.usage.total_tokens === null
  ) {
    reasons.push("usage_missing_or_unknown");
  }
  return { passed: reasons.length === 0, reasons: unique(reasons) };
}

export function exportRepresentativeCase(options: ExportRepresentativeCaseOptions): RepresentativeCaseExport {
  const store = options.store ?? new SqliteStore(options.dbPath);
  try {
    const output = buildRepresentativeCase(store, options.runId, options.generatedAt);
    if (options.strict) {
      output.strict = checkRepresentativeCaseStrict(store, output);
    }
    writeText(options.jsonPath, JSON.stringify(output, null, 2) + "\n");
    const markdownPath = options.markdownPath ?? options.jsonPath.replace(/\.json$/i, ".md");
    writeText(markdownPath, renderRepresentativeCaseMarkdown(output));
    return output;
  } finally {
    if (!options.store) store.close();
  }
}

export function renderRepresentativeCaseMarkdown(value: RepresentativeCaseExport): string {
  const round = (label: string, item: RepresentativeCaseRound): string => {
    const changed = item.revision.changed_fields.length > 0 ? item.revision.changed_fields.join(", ") : "unknown";
    return [
      `### ${label}`,
      `- present: ${item.present}`,
      `- action: ${item.action}`,
      `- raw plan artifact: ${display(item.raw_artifact_ids.plan)}`,
      `- raw review artifact: ${display(item.raw_artifact_ids.review)}`,
      `- feedback source: ${item.feedback.source} / ${item.feedback.feedback_source}`,
      `- feedback count: ${display(item.feedback.count)}`,
      `- changed fields: ${escapeMarkdown(changed)}`,
      `- score: ${display(item.score.before)} → ${display(item.score.after)} (score delta ${display(item.score.delta)})`,
      `- cost tokens: ${display(item.cost_tokens.round)} (cost delta ${display(item.cost_tokens.delta)})`,
      `- limitations: ${display(item.limitations.before)} → ${display(item.limitations.after)} (limitation delta ${display(item.limitations.delta)})`,
      `- stop/retry/rollback: ${escapeMarkdown([item.stop_reason, item.retry_reason, item.rollback_reason].map(display).join(" / "))}`,
      `- unknown: ${item.unknown_reasons.length > 0 ? item.unknown_reasons.join(", ") : "none"}`,
      ...renderPublicArtifactMarkdown(`${label} 公开研究计划`, item.public_outputs.plan),
      ...renderPublicArtifactMarkdown(`${label} 公开评审反馈`, item.public_outputs.review),
      "",
    ].join("\n");
  };

  const strictSection =
    value.strict === undefined
      ? []
      : [
          "",
          "## Strict 交付门",
          "",
          `- passed: ${value.strict.passed}`,
          `- reasons: ${value.strict.reasons.length > 0 ? value.strict.reasons.join(", ") : "none"}`,
        ];

  return [
    "# Luup 代表性案例",
    "",
    `- format: ${value.format} v${value.version}`,
    `- generated_at: ${escapeMarkdown(value.generated_at)}`,
    `- run_id: ${display(value.run_id)}`,
    `- science125_id: ${display(value.run.science125_id)}`,
    `- status: ${value.run.status}`,
    `- question: ${escapeMarkdown(display(value.run.question))}`,
    `- error_code: ${display(value.run.error_code)}`,
    "",
    "## 两轮评价与修订",
    "",
    round("Round 1（原始）", value.rounds.round1),
    round("Round 2（修订）", value.rounds.round2),
    "## 候选假设与比较",
    "",
    ...value.public_artifacts.hypothesis.flatMap((artifact) => renderPublicArtifactMarkdown("候选假设", artifact)),
    ...(value.public_artifacts.hypothesis.length === 0 ? ["- public hypothesis projection: unknown", ""] : []),
    "## 证据来源台账",
    "",
    `- status: ${value.source_ledger.status}; records: ${value.source_ledger.records.length}; unknown records: ${value.source_ledger.unknown_records}`,
    ...renderSourceLedgerMarkdown(value.source_ledger),
    "## Verification",
    "",
    `- status: ${value.verification.status}`,
    `- references: ${display(value.verification.reference_count)}; frozen sources: ${display(value.verification.frozen_sources)}`,
    `- arXiv / DOI: ${display(value.verification.arxiv_checked)} / ${display(value.verification.doi_checked)}`,
    `- checks: ${display(value.verification.passed_check_count)} passed, ${display(value.verification.failed_check_count)} failed, ${display(value.verification.check_count)} total`,
    `- infrastructure error: ${display(value.verification.infra_error)}`,
    `- unknown: ${value.verification.unknown_reasons.length > 0 ? value.verification.unknown_reasons.join(", ") : "none"}`,
    "",
    "## Trace / Usage",
    "",
    `- trace status: ${value.trace.status}; traces: ${value.trace.traces}; completed: ${value.trace.completed}; failed: ${value.trace.failed}; unknown: ${value.trace.unknown}`,
    `- models: ${value.trace.models.join(", ") || "unknown"}`,
    `- tool lifecycle: ${value.trace.tool_started} started / ${value.trace.tool_ended} ended; callback errors: ${value.trace.callback_errors}`,
    `- trace events / tool calls: ${display(value.trace.trace_events)} / ${display(value.trace.tool_calls)}; truncated: ${value.trace.truncated}`,
    `- usage status: ${value.usage.status}; records: ${value.usage.valid_records}/${value.usage.records}; unknown records: ${value.usage.unknown_records}`,
    `- tokens input/output/total: ${display(value.usage.input_tokens)} / ${display(value.usage.output_tokens)} / ${display(value.usage.total_tokens)}`,
    "",
    "## Artifact 索引",
    "",
    `- research: ${value.artifacts.research.join(", ") || "unknown"}`,
    `- hypothesis: ${value.artifacts.hypothesis.join(", ") || "unknown"}`,
    `- evidence-review: ${value.artifacts.evidence_review.join(", ") || "unknown"}`,
    `- research-plan: ${value.artifacts.research_plan.join(", ") || "unknown"}`,
    `- review: ${value.artifacts.review.join(", ") || "unknown"}`,
    `- unknown types: ${value.artifacts.unknown.join(", ") || "none"}`,
    "",
    "## Export 边界",
    "",
    "本导出包含可审计状态、Artifact ID、计数、确定性验收摘要，以及经公共投影白名单脱敏的候选假设、研究计划和评审反馈；不复制 prompt、内部 rationale、工具原始返回、内部错误正文、API key 或其他凭证。unknown/failed 事实保留并显式标注。",
    "",
    `- unknown reasons: ${value.unknown_reasons.length > 0 ? value.unknown_reasons.join(", ") : "none"}`,
    ...strictSection,
    "",
  ].join("\n");
}

function renderSourceLedgerMarkdown(ledger: RepresentativeCaseSourceLedger): string[] {
  if (ledger.records.length === 0) {
    return ["- sources: unknown", `- unknown: ${ledger.unknown_reasons.join(", ") || "none"}`, ""];
  }
  return [
    ...ledger.records.flatMap((record) => [
      `### ${escapeMarkdown(display(record.source?.title))}`,
      `- evidence: ${escapeMarkdown(record.evidence_id)}`,
      `- source: ${escapeMarkdown(display(record.source?.locator))}`,
      `- URL: ${escapeMarkdown(display(record.source?.url))}`,
      `- acquisition: ${escapeMarkdown(display(record.acquisition.tool))} / ${escapeMarkdown(display(record.acquisition.query))}`,
      `- availability: ${record.availability.status} (${escapeMarkdown(display(record.evidence_status))})`,
      `- hypothesis roles: ${record.hypothesis_roles.length > 0 ? record.hypothesis_roles.map((item) => `${escapeMarkdown(item.candidate_id)}:${item.role}`).join(", ") : "none"}`,
      `- limitations: ${record.limitations.map(escapeMarkdown).join("；") || "unknown"}`,
      `- unknown: ${record.unknown_reasons.join(", ") || "none"}`,
      "",
    ]),
    `- ledger unknown reasons: ${ledger.unknown_reasons.join(", ") || "none"}`,
    "",
  ];
}

function renderPublicArtifactMarkdown(label: string, artifact: RepresentativeCasePublicArtifact | null): string[] {
  if (artifact === null) return [`#### ${label}`, "", "- public projection: unknown", ""];
  const content = artifact.content;
  switch (content.artifact_type) {
    case "research":
      return [
        `#### ${label}`,
        `- artifact: ${artifact.id}`,
        `- summary: ${escapeMarkdown(content.summary)}`,
        `- research framing: ${escapeMarkdown(content.research_framing.research_object)} (${escapeMarkdown(content.research_framing.scope)})`,
        `- claims: ${content.claims.map((claim) => escapeMarkdown(claim.statement)).join("；") || "unknown"}`,
        `- limitations: ${content.limitations.map(escapeMarkdown).join("；") || "none"}`,
        "",
      ];
    case "hypothesis":
      return [
        `#### ${label}`,
        `- artifact: ${artifact.id}`,
        `- selected candidate: ${content.comparison.selected_candidate_id}`,
        `- selection status: ${content.selection_status}`,
        ...content.candidates.flatMap((candidate) => [
          `##### Candidate ${candidate.candidate_id}`,
          `- core claim: ${escapeMarkdown(candidate.core_claim)}`,
          `- falsifiable predictions: ${candidate.falsifiable_predictions.map(escapeMarkdown).join("；") || "unknown"}`,
          `- uncertainty: ${candidate.uncertainty.map(escapeMarkdown).join("；") || "unknown"}`,
          `- boundaries: ${candidate.boundaries.map(escapeMarkdown).join("；") || "unknown"}`,
          `- validation: ${candidate.validation_conditions.map(escapeMarkdown).join("；") || "unknown"}`,
          "",
        ]),
      ];
    case "evidence-review":
      return [
        `#### ${label}`,
        `- artifact: ${artifact.id}`,
        `- gaps: ${content.gaps.map(escapeMarkdown).join("；") || "none"}`,
        `- assessments: ${content.assessments.map((item) => `${escapeMarkdown(item.claim)} (${item.verdict})`).join("；") || "none"}`,
        "",
      ];
    case "research-plan":
      return [
        `#### ${label}`,
        `- artifact: ${artifact.id}`,
        `- problem: ${escapeMarkdown(content.problem_statement)}`,
        `- technical details: ${escapeMarkdown(content.technical_details)}`,
        `- execution steps: ${content.execution_plan.steps.map((step) => `${step.order}. ${escapeMarkdown(step.action)}`).join(" / ")}`,
        `- results status: ${content.results.status} (${content.results.validation_basis})`,
        "",
      ];
    case "review":
      return [
        `#### ${label}`,
        `- artifact: ${artifact.id}`,
        `- accepted: ${content.accepted}`,
        `- scores: scientific_value=${content.scores.scientific_value}, technical_depth=${content.scores.technical_depth}, application_potential=${content.scores.application_potential}`,
        `- weaknesses: ${content.weaknesses.map(escapeMarkdown).join("；") || "none"}`,
        `- feedback: ${content.feedback.map(escapeMarkdown).join("；") || "none"}`,
        "",
      ];
  }
}

export function main(argv: string[] = process.argv.slice(2)): number {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        db: { type: "string" },
        "run-id": { type: "string" },
        out: { type: "string" },
        markdown: { type: "string" },
        strict: { type: "boolean", default: false },
      },
      strict: true,
    });
  } catch (error) {
    process.stdout.write(`[submission:case] ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
  const dbPath = parsed.values.db || process.env.LUUP_DATABASE || "outputs/runtime/typescript-runs.db";
  const runId = parsed.values["run-id"];
  const outPath = parsed.values.out;
  if (!runId || !outPath) {
    process.stdout.write(
      "[submission:case] 用法：submission:case --db <path> --run-id <id> --out <path.json> [--markdown <path.md>] [--strict]\n",
    );
    return 2;
  }
  const result = exportRepresentativeCase({
    dbPath,
    runId,
    jsonPath: outPath,
    markdownPath: parsed.values.markdown,
    strict: parsed.values.strict,
  });
  if (result.strict && !result.strict.passed) {
    process.stdout.write(`[submission:case] strict 校验未通过：${result.strict.reasons.join(", ")}\n`);
    return 1;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readEvents(value: unknown, reasons: string[]): CaseEvent[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) {
    reasons.push("events_malformed");
    return [];
  }
  const events: CaseEvent[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.kind !== "string") {
      reasons.push("event_malformed");
      continue;
    }
    const payload = isRecord(item.payload) ? item.payload : {};
    events.push({ kind: item.kind, payload });
  }
  return events;
}

function readArtifacts(value: unknown, reasons: string[]): RepresentativeCaseExport["artifacts"] {
  const result: RepresentativeCaseExport["artifacts"] = {
    research: [],
    hypothesis: [],
    evidence_review: [],
    research_plan: [],
    review: [],
    unknown: [],
  };
  if (!Array.isArray(value)) {
    reasons.push("artifacts_unknown");
    return result;
  }
  for (const item of value) {
    if (!isRecord(item)) {
      reasons.push("malformed_artifact_metadata");
      continue;
    }
    const id = parseSafeId(item.id);
    const type = typeof item.type === "string" ? item.type : null;
    if (id === null || type === null) {
      reasons.push("malformed_artifact_metadata");
      continue;
    }
    const key = type === "evidence-review" ? "evidence_review" : type === "research-plan" ? "research_plan" : type;
    if (
      key === "research" ||
      key === "hypothesis" ||
      key === "evidence_review" ||
      key === "research_plan" ||
      key === "review"
    ) {
      result[key].push(id);
    } else {
      result.unknown.push(id);
    }
  }
  for (const key of ["research", "hypothesis", "evidence_review", "research_plan", "review"] as const) {
    result[key].sort();
  }
  result.unknown.sort();
  return result;
}

function buildSourceLedger(
  value: unknown,
  store: RepresentativeCaseReadSource,
  artifacts: RepresentativeCaseExport["artifacts"],
  rootReasons: string[],
): RepresentativeCaseSourceLedger {
  const relations = new Map<string, SourceLedgerRelations>();
  const addRelation = (evidenceId: string, use: SourceLedgerUse): void => {
    const existing = relations.get(evidenceId) ?? { artifactUses: [], hypothesisRoles: [] };
    const useKey = `${use.artifact_id}\0${use.relation}\0${use.candidate_id ?? ""}`;
    if (
      !existing.artifactUses.some(
        (item) => `${item.artifact_id}\0${item.relation}\0${item.candidate_id ?? ""}` === useKey,
      )
    ) {
      existing.artifactUses.push(use);
    }
    relations.set(evidenceId, existing);
  };
  const addHypothesisRole = (evidenceId: string, role: HypothesisRole): void => {
    const existing = relations.get(evidenceId) ?? { artifactUses: [], hypothesisRoles: [] };
    const roleKey = `${role.artifact_id}\0${role.candidate_id}\0${role.role}`;
    if (
      !existing.hypothesisRoles.some((item) => `${item.artifact_id}\0${item.candidate_id}\0${item.role}` === roleKey)
    ) {
      existing.hypothesisRoles.push(role);
    }
    relations.set(evidenceId, existing);
  };

  const relationReasonStart = rootReasons.length;
  collectSourceRelations(store, artifacts, addRelation, addHypothesisRole, rootReasons);
  const relationReasons = rootReasons.slice(relationReasonStart);
  if (!Array.isArray(value)) {
    rootReasons.push("source_ledger_unknown");
    return {
      status: "unknown",
      records: [],
      unknown_records: 0,
      unknown_reasons: unique([...relationReasons, "source_ledger_unknown"]),
    };
  }

  const records: RepresentativeCaseSourceLedgerEntry[] = [];
  const ledgerReasons: string[] = [...relationReasons];
  const observedEvidenceIds = new Set<string>();
  let unknownRecords = relationReasons.length;

  for (const row of value) {
    if (!isRecord(row)) {
      ledgerReasons.push("source_evidence_row_malformed");
      unknownRecords += 1;
      continue;
    }
    const evidenceId = parseSafeId(row.id);
    if (evidenceId === null) {
      ledgerReasons.push("source_evidence_id_unknown");
      unknownRecords += 1;
      continue;
    }
    const rowReasons: string[] = [];
    const attemptId = parseNullableId(row.attempt_id);
    if (row.attempt_id !== null && row.attempt_id !== undefined && attemptId === null) {
      rowReasons.push("source_attempt_id_unknown");
    }
    const tool =
      typeof row.tool_name === "string" && (row.tool_name === "arxiv_search" || row.tool_name === "crossref_search")
        ? row.tool_name
        : null;
    if (tool === null) rowReasons.push("source_tool_unknown");
    const query = typeof row.query === "string" && row.query.length <= 4000 ? redactSensitiveText(row.query) : null;
    if (query === null) rowReasons.push("source_query_unknown");
    const evidenceStatus = typeof row.status === "string" ? row.status : null;
    if (evidenceStatus === null) rowReasons.push("source_status_unknown");
    const output = isRecord(row.output) ? row.output : null;
    if (output === null) rowReasons.push("source_output_unknown");

    const citations = output === null ? [] : readSourceCitations(output.citations, rowReasons);
    const sourceRows = citations.length === 0 ? [null] : citations;
    if (citations.length === 0 && evidenceStatus === "succeeded") {
      rowReasons.push("succeeded_without_citation");
    }

    for (const citation of sourceRows) {
      observedEvidenceIds.add(evidenceId);
      const citationResult = citation === null ? { source: null, reasons: [] } : sourceFromCitation(citation);
      const reasons = unique([
        ...rowReasons,
        ...citationResult.reasons,
        ...(citation === null ? ["no_citable_source"] : []),
      ]);
      const relationsForEvidence = relations.get(evidenceId) ?? { artifactUses: [], hypothesisRoles: [] };
      const entry: RepresentativeCaseSourceLedgerEntry = {
        evidence_id: evidenceId,
        attempt_id: attemptId,
        evidence_status: evidenceStatus,
        acquisition: {
          method: tool !== null && query !== null ? "search_tool" : "unknown",
          tool,
          query,
        },
        availability: {
          status: availabilityStatus(evidenceStatus),
          evidence_status: evidenceStatus,
        },
        source: citationResult.source,
        hypothesis_roles: [...relationsForEvidence.hypothesisRoles].sort(compareHypothesisRole),
        artifact_uses: [...relationsForEvidence.artifactUses].sort(compareSourceUse),
        limitations: sourceLimitations(tool, evidenceStatus, citationResult.source),
        unknown_reasons: reasons,
      };
      records.push(entry);
      if (reasons.some((reason) => reason !== "no_citable_source")) unknownRecords += 1;
    }
    ledgerReasons.push(...rowReasons.filter((reason) => reason !== "no_citable_source"));
  }

  for (const [evidenceId, sourceRelations] of relations) {
    if (observedEvidenceIds.has(evidenceId)) continue;
    const unknownReasons = ["evidence_missing"];
    records.push({
      evidence_id: evidenceId,
      attempt_id: null,
      evidence_status: null,
      acquisition: { method: "unknown", tool: null, query: null },
      availability: { status: "unknown", evidence_status: null },
      source: null,
      hypothesis_roles: [...sourceRelations.hypothesisRoles].sort(compareHypothesisRole),
      artifact_uses: [...sourceRelations.artifactUses].sort(compareSourceUse),
      limitations: ["evidence_not_found"],
      unknown_reasons: unknownReasons,
    });
    ledgerReasons.push(...unknownReasons);
    unknownRecords += 1;
  }

  const unknownReasons = unique(ledgerReasons);
  rootReasons.push(...unknownReasons);
  return {
    status: records.length === 0 ? "unknown" : unknownRecords === 0 ? "known" : "partial",
    records,
    unknown_records: unknownRecords,
    unknown_reasons: unknownReasons,
  };
}

function collectSourceRelations(
  store: RepresentativeCaseReadSource,
  artifacts: RepresentativeCaseExport["artifacts"],
  addRelation: (evidenceId: string, use: SourceLedgerUse) => void,
  addHypothesisRole: (evidenceId: string, role: HypothesisRole) => void,
  rootReasons: string[],
): void {
  const groups: Array<{
    artifactType: SourceLedgerUse["artifact_type"];
    ids: readonly string[];
  }> = [
    { artifactType: "research", ids: artifacts.research },
    { artifactType: "hypothesis", ids: artifacts.hypothesis },
    { artifactType: "evidence-review", ids: artifacts.evidence_review },
    { artifactType: "research-plan", ids: artifacts.research_plan },
    { artifactType: "review", ids: artifacts.review },
  ];
  for (const group of groups) {
    for (const artifactId of group.ids) {
      let stored;
      try {
        stored = store.artifact(artifactId);
      } catch {
        rootReasons.push(`source_${group.artifactType}_artifact_unavailable`);
        continue;
      }
      if (stored === null || !isRecord(stored.content)) {
        rootReasons.push(`source_${group.artifactType}_artifact_unknown`);
        continue;
      }
      collectArtifactRelations(
        group.artifactType,
        artifactId,
        stored.content,
        addRelation,
        addHypothesisRole,
        rootReasons,
      );
    }
  }
}

function collectArtifactRelations(
  artifactType: SourceLedgerUse["artifact_type"],
  artifactId: string,
  content: UnknownRecord,
  addRelation: (evidenceId: string, use: SourceLedgerUse) => void,
  addHypothesisRole: (evidenceId: string, role: HypothesisRole) => void,
  reasons: string[],
): void {
  const addIds = (value: unknown, relation: SourceLedgerUse["relation"], candidateId: string | null = null): void => {
    if (!Array.isArray(value)) {
      if (value !== undefined && value !== null) reasons.push(`source_${artifactType}_${relation}_unknown`);
      return;
    }
    for (const item of value) {
      const evidenceId = parseSafeId(item);
      if (evidenceId === null) {
        reasons.push(`source_${artifactType}_evidence_id_unknown`);
        continue;
      }
      addRelation(evidenceId, {
        artifact_id: artifactId,
        artifact_type: artifactType,
        relation,
        candidate_id: candidateId,
      });
    }
  };

  switch (artifactType) {
    case "research": {
      const queries = Array.isArray(content.queries) ? content.queries : [];
      for (const query of queries) {
        if (isRecord(query))
          addIds(query.evidence_id === undefined ? undefined : [query.evidence_id], "research_query");
      }
      const claims = Array.isArray(content.claims) ? content.claims : [];
      for (const claim of claims) {
        if (isRecord(claim)) addIds(claim.evidence_ids, "research_claim");
      }
      break;
    }
    case "hypothesis": {
      const candidates = Array.isArray(content.candidates) ? content.candidates : [];
      for (const candidate of candidates) {
        if (!isRecord(candidate)) continue;
        const candidateId = parseSafeId(candidate.candidate_id);
        addIds(candidate.supporting_evidence_ids, "hypothesis_supporting", candidateId);
        addIds(candidate.opposing_evidence_ids, "hypothesis_opposing", candidateId);
        if (candidateId !== null && Array.isArray(candidate.supporting_evidence_ids)) {
          for (const item of candidate.supporting_evidence_ids) {
            const evidenceId = parseSafeId(item);
            if (evidenceId !== null)
              addHypothesisRole(evidenceId, { artifact_id: artifactId, candidate_id: candidateId, role: "supporting" });
          }
        }
        if (candidateId !== null && Array.isArray(candidate.opposing_evidence_ids)) {
          for (const item of candidate.opposing_evidence_ids) {
            const evidenceId = parseSafeId(item);
            if (evidenceId !== null)
              addHypothesisRole(evidenceId, { artifact_id: artifactId, candidate_id: candidateId, role: "opposing" });
          }
        }
      }
      const comparison = isRecord(content.comparison) ? content.comparison : null;
      const evaluations = Array.isArray(comparison?.evaluations) ? comparison.evaluations : [];
      for (const evaluation of evaluations) {
        if (isRecord(evaluation)) {
          addIds(evaluation.evidence_ids, "hypothesis_comparison", parseSafeId(evaluation.candidate_id));
        }
      }
      break;
    }
    case "evidence-review": {
      const assessments = Array.isArray(content.assessments) ? content.assessments : [];
      for (const assessment of assessments) {
        if (isRecord(assessment)) addIds(assessment.evidence_ids, "evidence_review");
      }
      break;
    }
    case "research-plan": {
      const experiments = isRecord(content.experiments) ? content.experiments : null;
      const baselines = Array.isArray(experiments?.baselines) ? experiments.baselines : [];
      for (const baseline of baselines) {
        if (isRecord(baseline))
          addIds(baseline.evidence_id === undefined ? undefined : [baseline.evidence_id], "plan_grounding");
      }
      const metrics = Array.isArray(experiments?.metrics) ? experiments.metrics : [];
      for (const metric of metrics) {
        if (isRecord(metric))
          addIds(metric.evidence_id === undefined ? undefined : [metric.evidence_id], "plan_grounding");
      }
      addIds(content.verification_evidence_ids, "plan_verification");
      break;
    }
    case "review": {
      addIds(content.independent_evidence_ids, "review_independent");
      break;
    }
  }
}

function readSourceCitations(value: unknown, reasons: string[]): UnknownRecord[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) {
    reasons.push("citations_malformed");
    return [];
  }
  return value.filter(isRecord);
}

function sourceFromCitation(citation: UnknownRecord): {
  source: RepresentativeCaseSourceLedgerEntry["source"];
  reasons: string[];
} {
  const reasons: string[] = [];
  const sourceType = citation.source_type === "web" || citation.source_type === "arxiv" ? citation.source_type : null;
  if (sourceType === null) reasons.push("source_type_unknown");
  const title =
    typeof citation.title === "string" && citation.title.length <= 4000 ? redactSensitiveText(citation.title) : null;
  if (title === null) reasons.push("source_title_unknown");
  const locator =
    typeof citation.locator === "string" && citation.locator.length <= 4000
      ? redactSensitiveText(citation.locator)
      : null;
  if (locator === null) reasons.push("source_locator_unknown");
  const url =
    typeof citation.url === "string" && citation.url.length <= 4000 ? redactSensitiveText(citation.url) : null;

  return {
    source: { source_type: sourceType, title, locator, url },
    reasons,
  };
}

function sourceLimitations(
  tool: string | null,
  status: string | null,
  source: RepresentativeCaseSourceLedgerEntry["source"],
): string[] {
  const limitations: string[] = [];
  if (status && status !== "succeeded") limitations.push(`retrieval_status_${status}`);
  if (tool === "arxiv_search") limitations.push("metadata_only_no_full_text_verification");
  if (tool === "crossref_search") limitations.push("doi_registry_metadata_only");
  if (!source || (!source.locator && !source.url)) limitations.push("citation_missing_locator_and_url");
  return unique(limitations);
}

function availabilityStatus(status: string | null): RepresentativeCaseSourceLedgerEntry["availability"]["status"] {
  switch (status) {
    case "succeeded":
      return "available";
    case "partial":
      return "partial";
    case "source_unavailable":
    case "timeout":
    case "rate_limited":
    case "not_configured":
      return "unavailable";
    case null:
    default:
      return "unknown";
  }
}

function compareHypothesisRole(left: HypothesisRole, right: HypothesisRole): number {
  return (
    left.artifact_id.localeCompare(right.artifact_id) ||
    left.candidate_id.localeCompare(right.candidate_id) ||
    left.role.localeCompare(right.role)
  );
}

function compareSourceUse(left: SourceLedgerUse, right: SourceLedgerUse): number {
  return (
    left.artifact_id.localeCompare(right.artifact_id) ||
    left.artifact_type.localeCompare(right.artifact_type) ||
    left.relation.localeCompare(right.relation) ||
    (left.candidate_id ?? "").localeCompare(right.candidate_id ?? "")
  );
}

function buildPublicArtifacts(
  store: RepresentativeCaseReadSource,
  artifacts: RepresentativeCaseExport["artifacts"],
  rootReasons: string[],
): RepresentativeCaseExport["public_artifacts"] {
  return {
    research: publicArtifactList(store, artifacts.research, rootReasons, "research"),
    hypothesis: publicArtifactList(store, artifacts.hypothesis, rootReasons, "hypothesis"),
    evidence_review: publicArtifactList(store, artifacts.evidence_review, rootReasons, "evidence_review"),
  };
}

function publicArtifactList(
  store: RepresentativeCaseReadSource,
  ids: readonly string[],
  rootReasons: string[],
  kind: string,
): RepresentativeCasePublicArtifact[] {
  const result: RepresentativeCasePublicArtifact[] = [];
  for (const id of ids) {
    const item = readPublicArtifact(store, id, rootReasons, `${kind}_artifact`);
    if (item !== null) result.push(item);
  }
  return result;
}

function readPublicArtifact(
  store: RepresentativeCaseReadSource,
  artifactId: string | null,
  rootReasons: string[],
  diagnosticLabel: string,
): RepresentativeCasePublicArtifact | null {
  if (artifactId === null) return null;
  const stored = store.artifact(artifactId);
  if (stored === null) {
    rootReasons.push(`${diagnosticLabel}_missing`);
    return null;
  }
  try {
    const projected = projectArtifact(stored);
    return toSubmissionPublicArtifact(projected);
  } catch {
    rootReasons.push(`${diagnosticLabel}_malformed`);
    return null;
  }
}

function toSubmissionPublicArtifact(artifact: PublicArtifact): RepresentativeCasePublicArtifact {
  switch (artifact.content.artifact_type) {
    case "research":
      return {
        id: artifact.id,
        type: artifact.type,
        content: sanitizePublic({
          artifact_type: artifact.content.artifact_type,
          research_framing: artifact.content.research_framing,
          summary: artifact.content.summary,
          claims: artifact.content.claims,
          limitations: artifact.content.limitations,
        }),
      } as RepresentativeCasePublicArtifact;
    case "hypothesis":
      return {
        id: artifact.id,
        type: artifact.type,
        content: sanitizePublic({
          artifact_type: artifact.content.artifact_type,
          question: artifact.content.question,
          candidates: artifact.content.candidates,
          comparison: {
            criteria: artifact.content.comparison.criteria.map((item) => ({ criterion: item.criterion })),
            evaluations: artifact.content.comparison.evaluations.map((item) => ({
              candidate_id: item.candidate_id,
              rank: item.rank,
              strengths: item.strengths,
              weaknesses: item.weaknesses,
              evidence_ids: item.evidence_ids,
            })),
            selected_candidate_id: artifact.content.comparison.selected_candidate_id,
          },
          selection_status: artifact.content.selection_status,
        }),
      } as RepresentativeCasePublicArtifact;
    case "evidence-review":
      return {
        id: artifact.id,
        type: artifact.type,
        content: sanitizePublic({
          artifact_type: artifact.content.artifact_type,
          gaps: artifact.content.gaps,
          assessments: artifact.content.assessments,
        }),
      } as RepresentativeCasePublicArtifact;
    case "research-plan":
      return {
        id: artifact.id,
        type: artifact.type,
        content: sanitizePublic({
          artifact_type: artifact.content.artifact_type,
          problem_statement: artifact.content.problem_statement,
          technical_details: artifact.content.technical_details,
          datasets: artifact.content.datasets,
          source: artifact.content.source,
          target: artifact.content.target,
          execution_plan: artifact.content.execution_plan,
          paper_title: artifact.content.paper_title,
          paper_abstract: artifact.content.paper_abstract,
          methods: artifact.content.methods,
          experiments: artifact.content.experiments,
          results: artifact.content.results,
          references: artifact.content.references,
        }),
      } as RepresentativeCasePublicArtifact;
    case "review":
      return {
        id: artifact.id,
        type: artifact.type,
        content: sanitizePublic({
          artifact_type: artifact.content.artifact_type,
          accepted: artifact.content.accepted,
          scores: artifact.content.scores,
          weaknesses: artifact.content.weaknesses,
          feedback: artifact.content.feedback,
        }),
      } as RepresentativeCasePublicArtifact;
  }
}

function buildRound(
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

function buildVerification(events: readonly CaseEvent[], rootReasons: string[]): RepresentativeCaseVerification {
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

function buildTrace(events: readonly CaseEvent[], rootReasons: string[]): RepresentativeCaseTrace {
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

function buildUsage(events: readonly CaseEvent[], rootReasons: string[]): RepresentativeCaseUsage {
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

  const records = usageEvents.length;
  const status: FactStatus = records === 0 ? "unknown" : unknownRecords === 0 ? "known" : "partial";
  const output: RepresentativeCaseUsage = {
    status,
    records,
    valid_records: validRecords,
    unknown_records: unknownRecords,
    input_tokens: validRecords > 0 ? inputTotal : null,
    output_tokens: validRecords > 0 ? outputTotal : null,
    total_tokens: validRecords > 0 ? totalTotal : null,
    by_agent: [...byAgent.entries()]
      .map(([agent, stats]) => ({ agent, ...stats }))
      .sort((a, b) => a.agent.localeCompare(b.agent)),
    unknown_reasons: unique(reasons),
  };
  rootReasons.push(...output.unknown_reasons);
  return output;
}

function unknownCase(runId: string | null, generatedAt: string, reason: string): RepresentativeCaseExport {
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

function lastEvent(events: readonly CaseEvent[], kind: string, round?: number): CaseEvent | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]!;
    if (event.kind !== kind) continue;
    if (round !== undefined && event.payload.round !== round) continue;
    return event;
  }
  return null;
}

function redactSensitiveText(value: string | null): string | null {
  if (value === null) return null;
  return value.replace(
    /(?:[A-Za-z0-9]+[_-])?(?:api[_-]?key|secret|token|authorization|password)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
    "[redacted]",
  );
}

function sanitizePublic<T>(value: T): T {
  if (typeof value === "string") return redactSensitiveText(value) as unknown as T;
  if (Array.isArray(value)) return value.map((item) => sanitizePublic(item)) as unknown as T;
  if (isRecord(value)) {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (/prompt|internal_rationale|api_key|token/i.test(k)) continue;
      result[k] = sanitizePublic(v);
    }
    return result as unknown as T;
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unique(items: readonly string[]): string[] {
  return [...new Set(items)].sort();
}

function display(value: unknown): string {
  if (value === null || value === undefined || value === "") return "unknown";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return "unknown";
}

function escapeMarkdown(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("|", "\\|").replaceAll("\n", " ");
}

function writeText(filePath: string, content: string): void {
  mkdirSync(dirname(resolve(filePath)), { recursive: true });
  writeFileSync(filePath, content, "utf8");
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === import.meta.filename) {
  process.exitCode = main();
}
