import type {
  RepresentativeCaseExport,
  RepresentativeCasePublicArtifact,
  RepresentativeCaseRound,
  RepresentativeCaseSourceLedger,
} from "./representative-case-types.ts";

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
function display(value: unknown): string {
  if (value === null || value === undefined || value === "") return "unknown";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return "unknown";
}

function escapeMarkdown(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("|", "\\|").replaceAll("\n", " ");
}
