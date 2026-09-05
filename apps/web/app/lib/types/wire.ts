/**
 * 手写 wire types，对齐 `apps/server/src/api/projection.ts` 的 public*Schema。
 * 不 import server —— 字段变更须与此文件与契约测试同步。
 */

export type RunStatus = "running" | "completed" | "review_rejected" | "failed";

export type Role = "researcher" | "hypothesis-generation" | "evidence-review" | "research-plan" | "reviewer";

type AttemptStatus = "running" | "completed" | "failed";

export type Attempt = {
  id: string;
  role: Role;
  ordinal: number;
  status: AttemptStatus;
  corrections: number;
  failure_code: string | null;
  started_at: string;
  finished_at: string | null;
};

type Subagent = {
  id: string;
  parent_run_id: string;
  role: Role;
  ordinal: number;
  mode: "one-shot";
  status: AttemptStatus;
  stop_reason: string | null;
  started_at: string;
  finished_at: string | null;
};

type Citation = {
  title: string;
  locator: string;
  url: string | null;
};

export type Evidence = {
  id: string;
  attempt_id: string;
  tool_name: string;
  query: string;
  status: string;
  created_at: string;
  output: { result_summary: string | null; citations: Citation[] };
};

type ArtifactReference = { id: string; type: string };

type DisplayScalar = string | number | boolean | null;

export type RunEvent = {
  id: number;
  version: number;
  kind: string;
  payload: Record<string, DisplayScalar>;
  created_at: string;
};

export type Snapshot = {
  id: string;
  question: string;
  status: RunStatus;
  current_role: Role | null;
  version: number;
  error_code: string | null;
  final_artifact_id: string | null;
  attempts: Attempt[];
  subagents: Subagent[];
  tool_evidence: Evidence[];
  omitted_evidence_count: number;
  omitted_evidence_tools: string[];
  artifacts: ArtifactReference[];
  recent_events: RunEvent[];
};

type Grounded = { name: string; evidence_id: string };

type ResearchFraming = {
  research_object: string;
  scope: string;
  variables: {
    name: string;
    role: "independent" | "dependent" | "control" | "confounder" | "observed";
    operationalization: string;
  }[];
  known: string[];
  controversies: string[];
  unknowns: string[];
  knowledge_gap: string;
  constraints: string[];
};

type ExecutionPlan = {
  predictions: { candidate_id: string; prediction: string; falsification_criterion: string }[];
  data_requirements: { source: string; variables: string[]; conditions: string[] }[];
  steps: { order: number; action: string; expected_output: string }[];
  analysis: { method: string; inputs: string[]; decision_rule: string }[];
  result_interpretations: { observed_result: string; meaning: string }[];
  stop_conditions: string[];
  rollback_conditions: string[];
  supplement_evidence_conditions: string[];
};

export type ArtifactContent =
  | {
      artifact_type: "research";
      research_framing: ResearchFraming;
      summary: string;
      claims: { statement: string; evidence_ids: string[] }[];
      limitations: string[];
    }
  | {
      artifact_type: "hypothesis";
      question: string;
      candidates: {
        candidate_id: string;
        claim_status: "candidate";
        core_claim: string;
        basis: string;
        supporting_evidence_ids: string[];
        opposing_evidence_ids: string[];
        falsifiable_predictions: string[];
        alternative_explanations: string[];
        uncertainty: string[];
        boundaries: string[];
        validation_conditions: string[];
      }[];
      comparison: {
        criteria: { criterion: string; rationale: string }[];
        evaluations: {
          candidate_id: string;
          rank: number;
          strengths: string[];
          weaknesses: string[];
          evidence_ids: string[];
          rationale: string;
        }[];
        selected_candidate_id: string;
        selection_rationale: string;
      };
      selection_status: "candidate_selected";
    }
  | {
      artifact_type: "evidence-review";
      assessments: { candidate_id?: string; claim: string; verdict: string }[];
      gaps: string[];
    }
  | {
      artifact_type: "research-plan";
      problem_statement: string;
      rationale: string;
      technical_details: string;
      datasets: string[];
      source: string;
      target: string;
      execution_plan: ExecutionPlan;
      paper_title: string;
      paper_abstract: string;
      methods: string;
      experiments: { baselines: Grounded[]; metrics: Grounded[]; design: string };
      results: {
        status: "pending_verification";
        validation_basis: "formula_derivation";
        feasibility_argument: string;
        expected_outcomes: { metric: string; statement: string }[];
      };
      references: string[];
    }
  | {
      artifact_type: "review";
      accepted: boolean;
      independent_evidence_ids: string[];
      scores: { scientific_value: number; technical_depth: number; application_potential: number };
      weaknesses: string[];
      feedback: string[];
    };

export type Artifact = {
  id: string;
  type: string;
  content: ArtifactContent;
};

export type ConfigStatus = {
  runtime: "live" | "deterministic";
  credential: "override" | "environment" | "absent";
  model_id: string;
  base_url: string;
};

export type Science125Question = {
  id: number;
  domain: string;
  question: string;
};

export type Science125Data = {
  source: string;
  retrievedAt: string;
  total: number;
  domains: { domain: string; count: number; questions: Science125Question[] }[];
};

/** RFC 9457 Problem Details 子集 + 兼容 detail 字段 */
export type ApiErrorBody = {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  code?: string;
  resolution?: string;
  instance?: string;
};

export type FeedbackQueued = {
  status: "queued";
  feedback_id: string;
  round: 1;
};
