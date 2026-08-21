/**
 * 后端公共投影的形状，手写。
 *
 * 以前这里是从 FastAPI 的 OpenAPI schema 生成的；现在公共契约直接由后端 zod 投影定义。
 * 后端换成 TypeScript 之后那条链没有意义了：契约的权威是 `src/api/projection.ts` 里的
 * zod schema，中间再过一道 OpenAPI 只会多一层能漂移的东西。
 *
 * 这份文件必须和 projection.ts 的 `public*Schema` 对齐 —— 那边字段变了这边不改，
 * 界面上会静默少一块内容。
 */

export type RunStatus = "running" | "completed" | "review_rejected" | "failed";

export type Role = "researcher" | "hypothesis-generation" | "evidence-review" | "research-plan" | "reviewer";

export type Attempt = {
  id: string;
  role: Role;
  ordinal: number;
  status: "running" | "completed" | "failed";
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
  status: "running" | "completed" | "failed";
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

type RunEvent = {
  id: number;
  version: number;
  kind: string;
  payload: Record<string, string | number | boolean | null>;
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
  /** 后端因公共工具白名单省略的证据，缺失本身也是可审计事实。 */
  omitted_evidence_count?: number;
  omitted_evidence_tools?: string[];
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
      assessments: { claim: string; verdict: string }[];
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

export const ROLE_ORDER: Role[] = [
  "researcher",
  "hypothesis-generation",
  "evidence-review",
  "research-plan",
  "reviewer",
];

export const ROLE_LABEL: Record<Role, string> = {
  researcher: "检索证据",
  "hypothesis-generation": "生成假设",
  "evidence-review": "审查证据",
  "research-plan": "研究计划",
  reviewer: "独立评审",
};

export const TERMINAL: ReadonlySet<RunStatus> = new Set(["completed", "review_rejected", "failed"]);
