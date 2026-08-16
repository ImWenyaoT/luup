/**
 * 后端公共投影的形状，手写。
 *
 * 以前这里是从 FastAPI 的 OpenAPI schema 生成的（`pnpm generate:api` → `api-schema.ts`）。
 * 后端换成 TypeScript 之后那条链没有意义了：契约的权威是 `src/api/projection.ts` 里的
 * zod schema，中间再过一道 OpenAPI 只会多一层能漂移的东西。
 *
 * 这份文件必须和 projection.ts 的 `public*Schema` 对齐 —— 那边字段变了这边不改，
 * 界面上会静默少一块内容。
 */

export type RunStatus = "running" | "completed" | "review_rejected" | "failed";

export type Role =
  | "researcher"
  | "hypothesis-generation"
  | "evidence-review"
  | "research-plan"
  | "reviewer";

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

export type Citation = {
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

export type ArtifactReference = { id: string; type: string };

export type RunEvent = {
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
  tool_evidence: Evidence[];
  artifacts: ArtifactReference[];
  recent_events: RunEvent[];
};

type Grounded = { name: string; evidence_id: string };

export type ArtifactContent =
  | {
    artifact_type: "research";
    summary: string;
    claims: { statement: string; evidence_ids: string[] }[];
    limitations: string[];
  }
  | {
    artifact_type: "hypothesis";
    hypothesis: string;
    falsifiable_predictions: string[];
    boundaries: string[];
  }
  | {
    artifact_type: "evidence-review";
    assessments: { claim: string; verdict: string }[];
    gaps: string[];
  }
  | {
    artifact_type: "research-plan";
    problem_statement: string;
    target: string;
    methods: string;
    experiments: { baselines: Grounded[]; metrics: Grounded[]; design: string };
    results: { expected_outcomes: { metric: string; statement: string }[] };
    references: string[];
  }
  | {
    artifact_type: "review";
    accepted: boolean;
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
  "researcher": "检索证据",
  "hypothesis-generation": "生成假设",
  "evidence-review": "审查证据",
  "research-plan": "研究计划",
  "reviewer": "独立评审",
};

export const TERMINAL: ReadonlySet<RunStatus> = new Set(["completed", "review_rejected", "failed"]);
