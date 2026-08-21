import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { parseArgs } from "node:util";

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
  /** 仅由 api/projection.ts 白名单构造；不含 prompt、内部 rationale 或工具原文。 */
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
  /** 首轮/二轮之外的公开上下文，用于展示候选比较和证据缺口。 */
  public_artifacts: {
    research: RepresentativeCasePublicArtifact[];
    hypothesis: RepresentativeCasePublicArtifact[];
    evidence_review: RepresentativeCasePublicArtifact[];
  };
  /** 每条实际检索来源的可核验说明；不含 tool output、prompt 或 rationale。 */
  source_ledger: RepresentativeCaseSourceLedger;
  rounds: { round1: RepresentativeCaseRound; round2: RepresentativeCaseRound };
  verification: RepresentativeCaseVerification;
  trace: RepresentativeCaseTrace;
  usage: RepresentativeCaseUsage;
  /** Strict submission readiness result; present only when `--strict` was requested. */
  strict?: RepresentativeCaseStrictReport;
  /** Stable, non-sensitive diagnostics for absent, malformed, or incomplete facts. */
  unknown_reasons: string[];
};

export type RepresentativeCaseStrictReport = {
  passed: boolean;
  reasons: string[];
};

/** Read-only store seam used by both the normal exporter and offline readiness. */
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
  /** Fail closed on the official Science-125 representative-case requirements. */
  strict?: boolean;
  /** Test and embedding seam; production CLI opens dbPath itself. */
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
  /** 一个检索事件的 durable ID；同一事件的多条 citation 各有一行。 */
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
  /** 直接从候选的 supporting/opposing_evidence_ids join，不从正文推断。 */
  hypothesis_roles: Array<{
    artifact_id: string;
    candidate_id: string;
    role: "supporting" | "opposing";
  }>;
  /** 只暴露 Artifact ID、类型和结构化关系，不暴露 rationale 或原始 payload。 */
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
  /** 仅记录由检索通路/状态决定的限制；不冒充 citation 原文的科学限制。 */
  limitations: string[];
  unknown_reasons: string[];
};

export type RepresentativeCaseSourceLedger = {
  status: FactStatus;
  records: RepresentativeCaseSourceLedgerEntry[];
  unknown_records: number;
  unknown_reasons: string[];
};

/** Build a representative-case package from durable facts only.
 *
 * Artifact bodies, tool output, prompt/input text, provider errors, and credentials
 * are deliberately not part of this projection. Unknown or malformed facts become
 * stable reason codes instead of being guessed or silently dropped.
 */
export function buildRepresentativeCase(
  store: RepresentativeCaseReadSource,
  runId: string,
  generatedAt = new Date().toISOString(),
): RepresentativeCaseExport {
  const safeRunId = safeId(runId);
  const snapshot = store.snapshot(runId);
  if (snapshot === null) return unknownCase(safeRunId, generatedAt, "run_not_found");

  const rootReasons: string[] = [];
  const runStatus = safeRunStatus(snapshot.status);
  if (runStatus === "unknown") rootReasons.push("run_status_unknown");
  const science125Id = safeScience125Id(snapshot.science125_id, rootReasons);
  const question = redactSensitiveText(safeText(snapshot.question));
  if (question === null) rootReasons.push("question_unknown");
  const errorCode = safeErrorCode(snapshot.error_code, rootReasons);
  const finalArtifactId = safeId(snapshot.final_artifact_id);
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

/**
 * Check the stricter representative-case submission contract without changing
 * the default diagnostic projection. Every failure is a stable reason code so
 * the CLI can fail closed while leaving the generated case available for audit.
 */
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
      const from = safeId(event.payload.from_artifact_id);
      const to = safeId(event.payload.to_artifact_id);
      const fields = parseChangedFields(event.payload.changed_fields, []);
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

/** Write the machine-readable package and a human-readable Markdown rendering. */
export function exportRepresentativeCase(options: ExportRepresentativeCaseOptions): RepresentativeCaseExport {
  const store = options.store ?? new SqliteStore(options.dbPath);
  try {
    const result = buildRepresentativeCase(store, options.runId, options.generatedAt);
    const strict = options.strict ? checkRepresentativeCaseStrict(store, result) : null;
    const output = strict === null ? result : { ...result, strict };
    writeJson(options.jsonPath, output);
    const markdownPath = options.markdownPath ?? defaultMarkdownPath(options.jsonPath);
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
        `- knowledge gap: ${escapeMarkdown(content.research_framing.knowledge_gap)}`,
        `- limitations: ${content.limitations.map(escapeMarkdown).join("；")}`,
        "",
      ];
    case "hypothesis":
      return [
        `#### ${label}`,
        `- artifact: ${artifact.id}`,
        `- selected candidate: ${escapeMarkdown(content.comparison.selected_candidate_id)}`,
        "- candidates:",
        ...content.candidates.map(
          (candidate) =>
            `  - ${escapeMarkdown(candidate.candidate_id)}: ${escapeMarkdown(candidate.core_claim)}；支持 ${candidate.supporting_evidence_ids.length}，反对 ${candidate.opposing_evidence_ids.length}，不确定性 ${candidate.uncertainty.length}`,
        ),
        "- comparison:",
        ...content.comparison.evaluations.map(
          (evaluation) =>
            `  - rank ${evaluation.rank}: ${escapeMarkdown(evaluation.candidate_id)}；优点：${evaluation.strengths.map(escapeMarkdown).join("；")}；限制：${evaluation.weaknesses.map(escapeMarkdown).join("；")}`,
        ),
        "",
      ];
    case "evidence-review":
      return [
        `#### ${label}`,
        `- artifact: ${artifact.id}`,
        `- gaps: ${content.gaps.map(escapeMarkdown).join("；") || "none"}`,
        ...content.assessments.map(
          (assessment) => `- assessment: ${escapeMarkdown(assessment.claim)} → ${escapeMarkdown(assessment.verdict)}`,
        ),
        "",
      ];
    case "research-plan":
      return [
        `#### ${label}`,
        `- artifact: ${artifact.id}`,
        `- title: ${escapeMarkdown(content.paper_title)}`,
        `- problem: ${escapeMarkdown(content.problem_statement)}`,
        `- target: ${escapeMarkdown(content.target)}`,
        "- predictions:",
        ...content.execution_plan.predictions.map(
          (prediction) =>
            `  - [${escapeMarkdown(prediction.candidate_id)}] ${escapeMarkdown(prediction.prediction)}；证伪：${escapeMarkdown(prediction.falsification_criterion)}`,
        ),
        "- data and conditions:",
        ...content.execution_plan.data_requirements.map(
          (requirement) =>
            `  - ${escapeMarkdown(requirement.source)}；变量：${requirement.variables.map(escapeMarkdown).join("、")}；条件：${requirement.conditions.map(escapeMarkdown).join("；")}`,
        ),
        "- steps:",
        ...content.execution_plan.steps.map(
          (step) => `  - ${step.order}. ${escapeMarkdown(step.action)} → ${escapeMarkdown(step.expected_output)}`,
        ),
        "- analysis:",
        ...content.execution_plan.analysis.map(
          (analysis) =>
            `  - ${escapeMarkdown(analysis.method)}；输入：${analysis.inputs.map(escapeMarkdown).join("、")}；规则：${escapeMarkdown(analysis.decision_rule)}`,
        ),
        "- result interpretations:",
        ...content.execution_plan.result_interpretations.map(
          (interpretation) =>
            `  - ${escapeMarkdown(interpretation.observed_result)} → ${escapeMarkdown(interpretation.meaning)}`,
        ),
        `- stop: ${content.execution_plan.stop_conditions.map(escapeMarkdown).join("；")}`,
        `- rollback: ${content.execution_plan.rollback_conditions.map(escapeMarkdown).join("；")}`,
        `- supplement evidence: ${content.execution_plan.supplement_evidence_conditions.map(escapeMarkdown).join("；")}`,
        "",
      ];
    case "review":
      return [
        `#### ${label}`,
        `- artifact: ${artifact.id}`,
        `- accepted: ${content.accepted}`,
        `- scores: scientific_value=${content.scores.scientific_value}, technical_depth=${content.scores.technical_depth}, application_potential=${content.scores.application_potential}`,
        `- weaknesses: ${content.weaknesses.map(escapeMarkdown).join("；") || "none"}`,
        "- feedback:",
        ...content.feedback.map((feedback) => `  - ${escapeMarkdown(feedback)}`),
        "",
      ];
  }
}

export function main(argv: string[] = process.argv.slice(2)): number {
  let values: { db?: string; "run-id"?: string; out?: string; markdown?: string; strict?: boolean };
  try {
    values = parseArgs({
      args: argv,
      options: {
        db: { type: "string" },
        "run-id": { type: "string" },
        out: { type: "string" },
        markdown: { type: "string" },
        strict: { type: "boolean", default: false },
      },
      strict: true,
    }).values;
  } catch (error) {
    process.stderr.write(`[submission:case] ${describe(error)}\n`);
    return 2;
  }
  if (!values["run-id"] || !values.out) {
    process.stderr.write(
      "用法：bun run submission:case -- --run-id <run-id> --out <case.json> [--markdown <case.md>] [--db <runs.db>] [--strict]\n",
    );
    return 2;
  }
  const dbPath = values.db || process.env.LUUP_DATABASE || "outputs/runtime/typescript-runs.db";
  try {
    const result = exportRepresentativeCase({
      dbPath,
      runId: values["run-id"],
      jsonPath: values.out,
      markdownPath: values.markdown,
      strict: values.strict,
    });
    process.stdout.write(
      `[submission:case] status=${result.run.status} science125_id=${display(result.run.science125_id)} ` +
        `run=${display(result.run_id)} out=${resolve(values.out)}\n`,
    );
    if (result.strict !== undefined && !result.strict.passed) {
      process.stderr.write(`[submission:case] strict gate failed: ${result.strict.reasons.join(", ")}\n`);
      return 1;
    }
    return result.run.status === "unknown" ? 1 : 0;
  } catch (error) {
    process.stderr.write(`[submission:case] ${describe(error)}\n`);
    return 2;
  }
}

function readEvents(value: unknown, reasons: string[]): CaseEvent[] {
  if (!Array.isArray(value)) {
    reasons.push("events_unknown");
    return [];
  }
  const events: CaseEvent[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.kind !== "string") {
      reasons.push("malformed_event");
      continue;
    }
    events.push({ kind: item.kind, payload: isRecord(item.payload) ? item.payload : {} });
    if (!isRecord(item.payload)) reasons.push("malformed_event_payload");
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
    const id = safeId(item.id);
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

type SourceLedgerUse = RepresentativeCaseSourceLedgerEntry["artifact_uses"][number];
type HypothesisRole = RepresentativeCaseSourceLedgerEntry["hypothesis_roles"][number];
type SourceLedgerRelations = { artifactUses: SourceLedgerUse[]; hypothesisRoles: HypothesisRole[] };

/**
 * Build the P4 source ledger from two durable seams:
 *
 * - `tool_evidence` is the retrieval fact (tool/query/status/citation metadata);
 * - frozen Artifact bodies are the only authority for how an evidence ID was used.
 *
 * This intentionally does not read `result_summary`, abstracts, rationale, or any raw
 * tool payload. A failed search remains a known unavailable retrieval, while malformed
 * rows become partial/unknown rather than being turned into a fake source.
 */
function buildSourceLedger(
  value: unknown,
  store: RepresentativeCaseReadSource,
  artifacts: RepresentativeCaseExport["artifacts"],
  rootReasons: string[],
): RepresentativeCaseSourceLedger {
  const relations = new Map<string, SourceLedgerRelations>();
  const addRelation = (evidenceId: string, use: SourceLedgerUse): void => {
    const existing = relations.get(evidenceId) ?? { artifactUses: [], hypothesisRoles: [] };
    const useKey = `${use.artifact_id}\u0000${use.relation}\u0000${use.candidate_id ?? ""}`;
    if (
      !existing.artifactUses.some(
        (item) => `${item.artifact_id}\u0000${item.relation}\u0000${item.candidate_id ?? ""}` === useKey,
      )
    ) {
      existing.artifactUses.push(use);
    }
    relations.set(evidenceId, existing);
  };
  const addHypothesisRole = (evidenceId: string, role: HypothesisRole): void => {
    const existing = relations.get(evidenceId) ?? { artifactUses: [], hypothesisRoles: [] };
    const roleKey = `${role.artifact_id}\u0000${role.candidate_id}\u0000${role.role}`;
    if (
      !existing.hypothesisRoles.some(
        (item) => `${item.artifact_id}\u0000${item.candidate_id}\u0000${item.role}` === roleKey,
      )
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
    const evidenceId = safeId(row.id);
    if (evidenceId === null) {
      ledgerReasons.push("source_evidence_id_unknown");
      unknownRecords += 1;
      continue;
    }
    const rowReasons: string[] = [];
    const attemptId = safeNullableId(row.attempt_id);
    if (row.attempt_id !== null && row.attempt_id !== undefined && attemptId === null) {
      rowReasons.push("source_attempt_id_unknown");
    }
    const tool = safeToolName(row.tool_name);
    if (tool === null) rowReasons.push("source_tool_unknown");
    const query = safeRedactedSourceText(row.query);
    if (query === null) rowReasons.push("source_query_unknown");
    const evidenceStatus = safeEvidenceStatus(row.status);
    if (evidenceStatus === null) rowReasons.push("source_status_unknown");
    const output = isRecord(row.output) ? row.output : null;
    if (output === null) rowReasons.push("source_output_unknown");

    const citations = output === null ? [] : readSourceCitations(output.citations, rowReasons);
    const sourceRows = citations.length === 0 ? [null] : citations;
    if (citations.length === 0 && evidenceStatus !== null && evidenceStatus === "succeeded") {
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
      const evidenceId = safeId(item);
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
        if (!isRecord(candidate)) {
          reasons.push("source_hypothesis_candidate_unknown");
          continue;
        }
        const candidateId = safeRedactedSourceText(candidate.candidate_id);
        if (candidateId === null) {
          reasons.push("source_hypothesis_candidate_id_unknown");
          continue;
        }
        for (const [field, role] of [
          ["supporting_evidence_ids", "supporting"],
          ["opposing_evidence_ids", "opposing"],
        ] as const) {
          if (!Array.isArray(candidate[field])) {
            reasons.push(`source_hypothesis_${role}_unknown`);
            continue;
          }
          for (const value of candidate[field]) {
            const evidenceId = safeId(value);
            if (evidenceId === null) {
              reasons.push("source_hypothesis_evidence_id_unknown");
              continue;
            }
            addHypothesisRole(evidenceId, { artifact_id: artifactId, candidate_id: candidateId, role });
            addRelation(evidenceId, {
              artifact_id: artifactId,
              artifact_type: artifactType,
              relation: role === "supporting" ? "hypothesis_supporting" : "hypothesis_opposing",
              candidate_id: candidateId,
            });
          }
        }
      }
      const comparison = isRecord(content.comparison) ? content.comparison : null;
      const evaluations = comparison && Array.isArray(comparison.evaluations) ? comparison.evaluations : [];
      for (const evaluation of evaluations) {
        if (!isRecord(evaluation)) continue;
        const candidateId = safeRedactedSourceText(evaluation.candidate_id);
        addIds(evaluation.evidence_ids, "hypothesis_comparison", candidateId);
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
      for (const field of ["baselines", "metrics"] as const) {
        const items = experiments && Array.isArray(experiments[field]) ? experiments[field] : [];
        for (const item of items) {
          if (isRecord(item)) addIds(item.evidence_id === undefined ? undefined : [item.evidence_id], "plan_grounding");
        }
      }
      addIds(content.verification_evidence_ids, "plan_verification");
      break;
    }
    case "review":
      addIds(content.independent_evidence_ids, "review_independent");
      break;
  }
}

function readSourceCitations(value: unknown, reasons: string[]): UnknownRecord[] {
  if (!Array.isArray(value)) {
    reasons.push("source_citations_unknown");
    return [];
  }
  return value.filter((item): item is UnknownRecord => {
    if (!isRecord(item)) {
      reasons.push("source_citation_malformed");
      return false;
    }
    return true;
  });
}

function sourceFromCitation(citation: UnknownRecord): {
  source: RepresentativeCaseSourceLedgerEntry["source"];
  reasons: string[];
} {
  const reasons: string[] = [];
  const sourceType = citation.source_type === "web" || citation.source_type === "arxiv" ? citation.source_type : null;
  if (sourceType === null) reasons.push("source_type_unknown");
  const title = safeRedactedSourceText(citation.title);
  if (title === null) reasons.push("source_title_unknown");
  const locator = safeRedactedSourceText(citation.locator);
  if (locator === null) reasons.push("source_locator_unknown");
  const url = safeSourceUrl(citation.url);
  if (citation.url !== null && citation.url !== undefined && url === null) reasons.push("source_url_unknown");
  return { source: { source_type: sourceType, title, locator, url }, reasons };
}

function sourceLimitations(
  tool: string | null,
  status: string | null,
  source: RepresentativeCaseSourceLedgerEntry["source"],
): string[] {
  const limitations: string[] = [];
  if (tool === "arxiv_search" || tool === "crossref_search" || (source !== null && source.source_type !== null)) {
    limitations.push("metadata_only_no_full_text_verification", "no_causal_validity_verification");
  }
  if (status === null) limitations.push("retrieval_status_unknown");
  else if (status !== "succeeded") limitations.push(`retrieval_status_${status}`);
  if (source === null) limitations.push("no_citable_source_returned");
  return [...new Set(limitations)];
}

function availabilityStatus(status: string | null): RepresentativeCaseSourceLedgerEntry["availability"]["status"] {
  if (status === "succeeded") return "available";
  if (status === "partial") return "partial";
  if (
    status === "empty" ||
    status === "failed" ||
    status === "timeout" ||
    status === "rate_limited" ||
    status === "source_unavailable" ||
    status === "refused"
  ) {
    return "unavailable";
  }
  return "unknown";
}

function safeToolName(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z][A-Za-z0-9_.-]{0,100}$/.test(value) ? value : null;
}

function safeEvidenceStatus(value: unknown): string | null {
  const statuses = new Set([
    "succeeded",
    "empty",
    "partial",
    "failed",
    "timeout",
    "rate_limited",
    "source_unavailable",
    "refused",
  ]);
  return typeof value === "string" && statuses.has(value) ? value : null;
}

function safeRedactedSourceText(value: unknown): string | null {
  const text = safeText(value);
  return text === null ? null : redactSensitiveText(text);
}

function safeSourceUrl(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = safeRedactedSourceText(value);
  if (text === null) return null;
  try {
    const parsed = new URL(text);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? text : null;
  } catch {
    return null;
  }
}

function compareHypothesisRole(left: HypothesisRole, right: HypothesisRole): number {
  return `${left.candidate_id}\u0000${left.role}\u0000${left.artifact_id}`.localeCompare(
    `${right.candidate_id}\u0000${right.role}\u0000${right.artifact_id}`,
  );
}

function compareSourceUse(left: SourceLedgerUse, right: SourceLedgerUse): number {
  return `${left.artifact_type}\u0000${left.relation}\u0000${left.artifact_id}\u0000${left.candidate_id ?? ""}`.localeCompare(
    `${right.artifact_type}\u0000${right.relation}\u0000${right.artifact_id}\u0000${right.candidate_id ?? ""}`,
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
  label: string,
): RepresentativeCasePublicArtifact[] {
  return ids.flatMap((id) => {
    const artifact = readPublicArtifact(store, id, rootReasons, `${label}_${id}`);
    return artifact === null ? [] : [artifact];
  });
}

/** Load an Artifact only through the same public projection used by the API. */
function readPublicArtifact(
  store: RepresentativeCaseReadSource,
  artifactId: string | null,
  reasons: string[],
  label: string,
): RepresentativeCasePublicArtifact | null {
  if (artifactId === null) return null;
  let stored;
  try {
    stored = store.artifact(artifactId);
  } catch {
    reasons.push(`${label}_projection_unavailable`);
    return null;
  }
  if (stored === null) {
    reasons.push(`${label}_artifact_missing`);
    return null;
  }
  try {
    return toSubmissionPublicArtifact(projectArtifact(stored));
  } catch {
    reasons.push(`${label}_projection_unavailable`);
    return null;
  }
}

/** Narrow the public API projection again for submission: no rationale or input/tool internals. */
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
            criteria: artifact.content.comparison.criteria.map(({ criterion }) => ({ criterion })),
            evaluations: artifact.content.comparison.evaluations.map(
              ({ candidate_id, rank, strengths, weaknesses, evidence_ids }) => ({
                candidate_id,
                rank,
                strengths,
                weaknesses,
                evidence_ids,
              }),
            ),
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
    safeId(evaluationPayload.raw_plan_artifact_id) ?? (round === 1 ? (artifacts.research_plan[0] ?? null) : null);
  const rawReview =
    safeId(evaluationPayload.raw_review_artifact_id) ?? (round === 1 ? (artifacts.review[0] ?? null) : null);
  const plan = safeId(evaluationPayload.plan_artifact_id);
  const review = safeId(evaluationPayload.review_artifact_id);
  const feedbackSource = safeFeedbackSource(feedbackPayload.feedback_source, reasons);
  const feedbackActor = safeFeedbackActor(feedbackPayload.source ?? evaluationPayload.evaluator, reasons);
  const action = safeAction(evaluationPayload.action ?? feedbackPayload.action, reasons);
  const changedFields = parseChangedFields(revisionPayload.changed_fields, reasons);
  const fromArtifactId = safeId(revisionPayload.from_artifact_id);
  const toArtifactId = safeId(revisionPayload.to_artifact_id);
  const stopReason = safeReasonCode(evaluationPayload.stop_reason, reasons, "stop_reason_unknown");
  const retryReason = safeReasonCode(evaluationPayload.retry_reason, reasons, "retry_reason_unknown");
  const rollbackReason = safeReasonCode(evaluationPayload.rollback_reason, reasons, "rollback_reason_unknown");
  const publicOutputs = {
    plan: readPublicArtifact(store, plan, reasons, `round${round}_plan`),
    review: readPublicArtifact(store, review, reasons, `round${round}_review`),
  };
  const output: RepresentativeCaseRound = {
    present,
    phase: safePhase(evaluationPayload.phase, reasons),
    action,
    raw_artifact_ids: { plan: rawPlan, review: rawReview },
    plan_artifact_id: plan,
    review_artifact_id: review,
    feedback: {
      source: feedbackActor,
      feedback_source: feedbackSource,
      action: safeAction(feedbackPayload.action ?? evaluationPayload.action, reasons),
      count: safeNullableNonNegativeInteger(feedbackPayload.feedback_count, reasons, "feedback_count_unknown"),
      artifact_id: safeNullableId(feedbackPayload.feedback_artifact_id),
    },
    revision: {
      from_artifact_id: fromArtifactId,
      to_artifact_id: toArtifactId,
      changed_fields: changedFields,
    },
    score: {
      before: safeNullableNonNegativeInteger(evaluationPayload.score_before_total, reasons, "score_before_unknown"),
      after: safeNullableNonNegativeInteger(evaluationPayload.score_after_total, reasons, "score_after_unknown"),
      delta: safeNullableInteger(evaluationPayload.score_delta_total, reasons, "score_delta_unknown"),
    },
    cost_tokens: {
      round: safeNullableNonNegativeInteger(evaluationPayload.round_cost_tokens, reasons, "round_cost_unknown"),
      delta: safeNullableInteger(evaluationPayload.cost_delta_tokens, reasons, "cost_delta_unknown"),
    },
    limitations: {
      before: safeNullableNonNegativeInteger(
        evaluationPayload.limitations_before_count,
        reasons,
        "limitations_before_unknown",
      ),
      after: safeNullableNonNegativeInteger(
        evaluationPayload.limitations_after_count,
        reasons,
        "limitations_after_unknown",
      ),
      delta: safeNullableInteger(evaluationPayload.limitation_delta_count, reasons, "limitation_delta_unknown"),
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
  const ok = typeof payload.ok === "boolean" ? payload.ok : null;
  if (ok === null) reasons.push("verification_ok_unknown");
  const checks = Array.isArray(payload.checks) ? payload.checks : null;
  if (checks === null) reasons.push("verification_checks_unknown");
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
  const failedCount = safeNullableNonNegativeInteger(
    payload.failed_count,
    reasons,
    "verification_failed_count_unknown",
  );
  const output: RepresentativeCaseVerification = {
    status: ok === true ? "passed" : ok === false ? "failed" : "unknown",
    ok,
    reference_count: safeNullableNonNegativeInteger(
      payload.reference_count,
      reasons,
      "verification_reference_count_unknown",
    ),
    frozen_sources: safeNullableNonNegativeInteger(
      payload.frozen_sources,
      reasons,
      "verification_frozen_sources_unknown",
    ),
    arxiv_checked: safeNullableNonNegativeInteger(payload.arxiv_checked, reasons, "verification_arxiv_count_unknown"),
    doi_checked: safeNullableNonNegativeInteger(payload.doi_checked, reasons, "verification_doi_count_unknown"),
    membership_only: safeNullableNonNegativeInteger(
      payload.membership_only,
      reasons,
      "verification_membership_count_unknown",
    ),
    failed_count: failedCount,
    infra_error: typeof payload.infra_error === "boolean" ? payload.infra_error : null,
    check_count: checks?.length ?? null,
    passed_check_count: passedCheckCount,
    failed_check_count: failedCheckCount,
    unknown_reasons: unique(reasons),
  };
  rootReasons.push(...output.unknown_reasons);
  return output;
}

function buildTrace(events: readonly CaseEvent[], rootReasons: string[]): RepresentativeCaseTrace {
  const reasons: string[] = [];
  const starts = events.filter((event) => event.kind === "sdk.trace.started");
  const ends = events.filter((event) => event.kind === "sdk.trace.ended");
  const traceIds = new Set<string>();
  const models = new Set<string>();
  for (const event of starts) {
    const model = safeText(event.payload.model);
    if (model === null) reasons.push("trace_model_unknown");
    else models.add(model);
  }
  for (const event of [...starts, ...ends]) {
    const traceId = safeId(event.payload.trace_id);
    if (traceId === null) reasons.push("trace_id_unknown");
    else traceIds.add(traceId);
  }
  const byRole = new Map<string, { traces: number; completed: number; failed: number; unknown: number }>();
  let completed = 0;
  let failed = 0;
  let unknown = 0;
  let traceEvents = 0;
  let toolCalls = 0;
  let traceEventsKnown = ends.length > 0;
  let toolCallsKnown = ends.length > 0;
  let truncated = 0;
  for (const event of ends) {
    const role = safeRole(event.payload.role) ?? "unknown";
    const bucket = byRole.get(role) ?? { traces: 0, completed: 0, failed: 0, unknown: 0 };
    bucket.traces += 1;
    const outcome =
      event.payload.outcome === "completed" ? "completed" : event.payload.outcome === "failed" ? "failed" : "unknown";
    if (outcome === "completed") {
      completed += 1;
      bucket.completed += 1;
    } else if (outcome === "failed") {
      failed += 1;
      bucket.failed += 1;
    } else {
      unknown += 1;
      bucket.unknown += 1;
      reasons.push("trace_outcome_unknown");
    }
    const eventCount = safeNonNegativeInteger(event.payload.trace_events);
    if (eventCount === null) traceEventsKnown = false;
    else traceEvents += eventCount;
    const callCount = safeNonNegativeInteger(event.payload.usage_tool_calls);
    if (callCount === null) toolCallsKnown = false;
    else toolCalls += callCount;
    if (typeof event.payload.truncated !== "boolean") reasons.push("trace_truncated_unknown");
    else if (event.payload.truncated) truncated += 1;
    byRole.set(role, bucket);
  }
  if (ends.length === 0) {
    if (starts.length > 0) reasons.push("trace_end_missing");
    else reasons.push("trace_missing");
  }
  const output: RepresentativeCaseTrace = {
    status: traceIds.size === 0 ? "unknown" : ends.length === 0 || reasons.length > 0 ? "partial" : "known",
    models: [...models].sort(),
    traces: traceIds.size,
    completed,
    failed,
    unknown,
    tool_started: events.filter((event) => event.kind === "sdk.trace.tool_started").length,
    tool_ended: events.filter((event) => event.kind === "sdk.trace.tool_ended").length,
    callback_errors: events.filter((event) => event.kind === "sdk.trace.callback_error").length,
    trace_events: traceEventsKnown ? traceEvents : null,
    tool_calls: toolCallsKnown ? toolCalls : null,
    truncated,
    by_role: [...byRole.entries()]
      .map(([role, counts]) => ({ role, ...counts }))
      .sort((left, right) => left.role.localeCompare(right.role)),
    unknown_reasons: unique(reasons),
  };
  rootReasons.push(...output.unknown_reasons);
  return output;
}

function buildUsage(events: readonly CaseEvent[], rootReasons: string[]): RepresentativeCaseUsage {
  const usageEvents = events.filter((event) => event.kind === "sdk.usage");
  const reasons: string[] = [];
  const byAgent = new Map<Role, { records: number; input: number; output: number; total: number; invalid: boolean }>();
  let input = 0;
  let output = 0;
  let total = 0;
  let validRecords = 0;
  for (const event of usageEvents) {
    const agent = safeRole(event.payload.agent);
    const inputTokens = safeNonNegativeInteger(event.payload.input_tokens);
    const outputTokens = safeNonNegativeInteger(event.payload.output_tokens);
    const totalTokens = safeNonNegativeInteger(event.payload.total_tokens);
    if (agent === null || inputTokens === null || outputTokens === null || totalTokens === null) {
      reasons.push("usage_payload_invalid");
      if (agent !== null) {
        const existing = byAgent.get(agent) ?? { records: 0, input: 0, output: 0, total: 0, invalid: false };
        existing.invalid = true;
        byAgent.set(agent, existing);
      }
      continue;
    }
    validRecords += 1;
    input += inputTokens;
    output += outputTokens;
    total += totalTokens;
    const existing = byAgent.get(agent) ?? { records: 0, input: 0, output: 0, total: 0, invalid: false };
    existing.records += 1;
    existing.input += inputTokens;
    existing.output += outputTokens;
    existing.total += totalTokens;
    byAgent.set(agent, existing);
  }
  if (usageEvents.length === 0) reasons.push("usage_missing");
  const outputValue: RepresentativeCaseUsage = {
    status: usageEvents.length === 0 ? "unknown" : validRecords === usageEvents.length ? "known" : "partial",
    records: usageEvents.length,
    valid_records: validRecords,
    unknown_records: usageEvents.length - validRecords,
    input_tokens: validRecords > 0 ? input : null,
    output_tokens: validRecords > 0 ? output : null,
    total_tokens: validRecords > 0 ? total : null,
    by_agent: [...byAgent.entries()]
      .map(([agent, values]) => ({
        agent,
        records: values.records,
        input_tokens: values.records > 0 ? values.input : null,
        output_tokens: values.records > 0 ? values.output : null,
        total_tokens: values.records > 0 ? values.total : null,
      }))
      .sort((left, right) => left.agent.localeCompare(right.agent)),
    unknown_reasons: unique(reasons),
  };
  rootReasons.push(...outputValue.unknown_reasons);
  return outputValue;
}

function unknownCase(runId: string | null, generatedAt: string, reason: string): RepresentativeCaseExport {
  const round = (roundNumber: 1 | 2): RepresentativeCaseRound => ({
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
    unknown_reasons: [`round${roundNumber}_evaluation_missing`],
  });
  return {
    format: REPRESENTATIVE_CASE_FORMAT,
    version: REPRESENTATIVE_CASE_VERSION,
    generated_at: generatedAt,
    run_id: runId,
    run: { science125_id: null, status: "unknown", question: null, error_code: null, final_artifact_id: null },
    artifacts: { research: [], hypothesis: [], evidence_review: [], research_plan: [], review: [], unknown: [] },
    public_artifacts: { research: [], hypothesis: [], evidence_review: [] },
    source_ledger: {
      status: "unknown",
      records: [],
      unknown_records: 0,
      unknown_reasons: ["source_ledger_unknown"],
    },
    rounds: { round1: round(1), round2: round(2) },
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
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!;
    if (event.kind !== kind) continue;
    if (round !== undefined && event.payload.round !== round) continue;
    return event;
  }
  return null;
}

function safeRunStatus(value: unknown): CaseStatus {
  return typeof value === "string" && RUN_STATUS_SET.has(value) ? (value as Exclude<CaseStatus, "unknown">) : "unknown";
}

function safeErrorCode(value: unknown, reasons: string[]): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && FAILURE_CODE_SET.has(value)) return value;
  reasons.push("error_code_unknown");
  return null;
}

function safeScience125Id(value: unknown, reasons: string[]): number | null {
  if (value === null || value === undefined) return null;
  if (safeNonNegativeInteger(value) !== null && Number(value) >= 1) return Number(value);
  reasons.push("science125_id_unknown");
  return null;
}

function safeFeedbackSource(value: unknown, reasons: string[]): FeedbackSource {
  if (value === "auto" || value === "human") return value;
  reasons.push("feedback_source_unknown");
  return "unknown";
}

function safeFeedbackActor(value: unknown, reasons: string[]): "model_reviewer" | "human" | "unknown" {
  if (value === "model_reviewer" || value === "human") return value;
  reasons.push("feedback_actor_unknown");
  return "unknown";
}

function safeAction(value: unknown, reasons: string[]): EvaluationAction {
  if (value === "accept" || value === "revise" || value === "stop") return value;
  reasons.push("evaluation_action_unknown");
  return "unknown";
}

function safePhase(value: unknown, reasons: string[]): RepresentativeCaseRound["phase"] {
  if (value === "raw" || value === "revision") return value;
  reasons.push("evaluation_phase_unknown");
  return "unknown";
}

function safeReasonCode(value: unknown, reasons: string[], reason: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && /^[A-Za-z][A-Za-z0-9_.-]{0,100}$/.test(value)) return value;
  reasons.push(reason);
  return null;
}

function parseChangedFields(value: unknown, reasons: string[]): string[] {
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

function safeRole(value: unknown): Role | null {
  return typeof value === "string" && ROLE_SET.has(value) ? (value as Role) : null;
}

function safeId(value: unknown): string | null {
  return typeof value === "string" && ID_PATTERN.test(value) ? value : null;
}

function safeNullableId(value: unknown): string | null {
  return value === null || value === undefined ? null : safeId(value);
}

function safeText(value: unknown): string | null {
  return typeof value === "string" && value.length <= 4_000 ? value : null;
}

function safeNonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function safeNullableNonNegativeInteger(value: unknown, reasons: string[], reason: string): number | null {
  if (value === null || value === undefined) return null;
  const parsed = safeNonNegativeInteger(value);
  if (parsed === null) reasons.push(reason);
  return parsed;
}

function safeNullableInteger(value: unknown, reasons: string[], reason: string): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  reasons.push(reason);
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
  if (typeof value === "string") return redactSensitiveText(value) as T;
  if (Array.isArray(value)) return value.map((item) => sanitizePublic(item)) as T;
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizePublic(item)])) as T;
  }
  return value;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function display(value: unknown): string {
  if (value === null || value === undefined || value === "") return "unknown";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return "unknown";
}

function escapeMarkdown(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("|", "\\|").replaceAll("\n", " ");
}

function defaultMarkdownPath(jsonPath: string): string {
  return extname(jsonPath).toLowerCase() === ".json" ? `${jsonPath.slice(0, -5)}.md` : `${jsonPath}.md`;
}

function writeJson(path: string, value: RepresentativeCaseExport): void {
  mkdirSync(dirname(resolve(path)), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeText(path: string, value: string): void {
  mkdirSync(dirname(resolve(path)), { recursive: true });
  writeFileSync(path, value, "utf8");
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === import.meta.filename) {
  process.exitCode = main();
}
