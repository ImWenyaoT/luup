import { FAILURE_CODES } from "../agent/failures.ts";
import type { Role } from "../agent/contracts.ts";
import type { PublicArtifact } from "../api/projection.ts";
import type { StoredArtifact } from "../store/store.ts";

export const REPRESENTATIVE_CASE_FORMAT = "luup.representative-case" as const;
export const REPRESENTATIVE_CASE_VERSION = 3 as const;

export type CaseStatus = "running" | "completed" | "review_rejected" | "failed" | "unknown";
export type FactStatus = "known" | "partial" | "unknown";
export type FeedbackSource = "auto" | "human" | "unknown";
export type EvaluationAction = "accept" | "revise" | "stop" | "unknown";

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

const ROLES: readonly Role[] = ["researcher", "hypothesis-generation", "evidence-review", "research-plan", "reviewer"];
export const ROLE_SET = new Set<string>(ROLES);
export const FAILURE_CODE_SET = new Set<string>([...FAILURE_CODES, "review_rejected"]);
export const RUN_STATUS_SET = new Set<string>(["running", "completed", "review_rejected", "failed"]);
export const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
export const FIELD_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]{0,100}$/;

export type UnknownRecord = Record<string, unknown>;
export type CaseEvent = { kind: string; payload: UnknownRecord };

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

export type HypothesisRole = RepresentativeCaseSourceLedgerEntry["hypothesis_roles"][number];
export type SourceLedgerUse = RepresentativeCaseSourceLedgerEntry["artifact_uses"][number];
export type SourceLedgerRelations = {
  artifactUses: SourceLedgerUse[];
  hypothesisRoles: HypothesisRole[];
};
