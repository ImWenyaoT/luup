import { z } from "zod";

import { reviewFoundationChecksSchema } from "./review-foundations.ts";

export const roleSchema = z.enum([
  "researcher",
  "hypothesis-generation",
  "evidence-review",
  "research-plan",
  "reviewer",
]);
export type Role = z.infer<typeof roleSchema>;

/** Crossref 工具在领域合同里属于 web 来源。
 *
 * 百炼/Qwen live 会照着工具名写成 `crossref`，即使纠错提示已明确要求 `web`。
 * 这个字段随后还会由 EvidenceLedger 覆写，所以这里只做一个已验证必要的输入别名，
 * 对外和落库仍保持简单的 `web | arxiv` 两类。
 */
const sourceTypeSchema = z.preprocess((value) => (value === "crossref" ? "web" : value), z.enum(["web", "arxiv"]));
export type SourceType = z.infer<typeof sourceTypeSchema>;

/** 同一个字段发给模型时的写法：三个值的朴素枚举，没有 preprocess。
 *
 * `z.preprocess` 的输入端是 `unknown`，转成 JSON Schema 后该字段会掉出 `required`，
 * strict 化时再被补成 nullable —— 于是模型被允许写 null，每次都要多花一个 turn 纠正。
 * 别名直接写进枚举，模型侧只剩一个平铺的合法值集合；`crossref → web` 的归一
 * 仍由 `sourceTypeSchema` 在落库前完成，而且这个字段最终一律被台账整条覆写。
 */
const proposedSourceTypeSchema = z.enum(["web", "arxiv", "crossref"]);

/** 一次检索的结局。八个值与 Python 期 `app/models.py`（ADR-0004 已删）的 EvidenceStatus 逐字对齐，
 *  两边审计口径才能比对。 */
const evidenceStatusSchema = z.enum([
  "succeeded",
  "empty",
  "partial",
  "failed",
  "timeout",
  "rate_limited",
  "source_unavailable",
  "refused",
]);
export type EvidenceStatus = z.infer<typeof evidenceStatusSchema>;

/** 模型能写的引用字段。
 *
 * 与 `citationSchema` 的差别是来源元数据和摘要：这些字段由代码从台账覆写，
 * 模型不能改写，所以不能出现在发给模型的上报 JSON Schema 里
 * （见 `researchProposalSchema`）。
 */
const proposedCitationSchema = z.object({
  evidence_id: z.string().min(1),
  source_type: proposedSourceTypeSchema,
  title: z.string().min(1),
  locator: z.string().min(1),
  url: z.string().url().nullable(),
});

const citationSchema = proposedCitationSchema.extend({
  source_type: sourceTypeSchema,
  // 检索台账登记的 arXiv 元数据，供终局引用验收（B4）比对。声明在这里只是为了不被
  // zod 的 strip 丢掉 —— 值由 canonicalizeResearch 从台账整条覆写，模型写什么都不作数。
  authors: z.array(z.string()).optional(),
  year: z.number().int().nullable().optional(),
  // 原来源摘要由检索工具冻结；模型不填写，缺失不推定为已读原文。
  abstract: z.string().min(1).optional(),
});

/** 科学问题的结构化 framing。
 *
 * 这不是 summary 的同义改写，而是把评审需要核验的中间事实单独冻结：研究对象与范围、
 * 变量的操作化、已有认识、争议、未知和知识缺口。没有这组字段，后续候选假设和计划
 * 无法证明自己是在回答哪个缺口，也无法区分事实、争议与模型推断。
 */
const researchVariableSchema = z.object({
  name: z.string().min(1),
  role: z.enum(["independent", "dependent", "control", "confounder", "observed"]),
  operationalization: z.string().min(1),
});

const researchFramingSchema = z.object({
  research_object: z.string().min(1),
  scope: z.string().min(1),
  variables: z.array(researchVariableSchema).min(1),
  known: z.array(z.string().min(1)).min(1),
  controversies: z.array(z.string().min(1)).min(1),
  unknowns: z.array(z.string().min(1)).min(1),
  knowledge_gap: z.string().min(1),
  constraints: z.array(z.string().min(1)).min(1),
});

export const researchSchema = z.object({
  artifact_type: z.literal("research"),
  question: z.string().min(1),
  research_framing: researchFramingSchema,
  summary: z.string().min(1),
  claims: z
    .array(
      z.object({
        statement: z.string().min(1),
        evidence_ids: z
          .array(z.string().min(1))
          .min(1)
          .describe(
            "Copy frozen search evidence_id values (ev_...), never paper locators such as arxiv:... or doi:...",
          ),
      }),
    )
    .min(1)
    .max(8),
  /** 检索台账的实录，由 `canonicalizeResearch` 整条填充，模型写什么都不作数。
   *
   * **没有条数上限**，这是刻意的：条数由 harness 跑了几次检索决定，模型无从灌水，
   * 所以一个上限在这里只可能把「查得多」判死，不可能挡住任何滥用。
   * 曾经写的是 `.max(12)`（照抄模型可写子集的那个值），而 v2 实测一个 Attempt
   * 最多跑了 20 次检索、21 题里有 5 个 Attempt 超过 12 次——百炼会在同一 turn 并发
   * 调用检索工具，`parallelToolCalls: false` 并不总被遵守，SDK 的 maxTurns 因此
   * 不是检索次数的上界。`.min(1)` 留着：一次都没检索就发布是另一道门，在这之前就判死。 */
  queries: z
    .array(
      z.object({
        evidence_id: z.string().min(1),
        source_type: sourceTypeSchema,
        query: z.string().min(1),
        status: evidenceStatusSchema,
        result_summary: z.string().min(1),
      }),
    )
    .min(1),
  citations: z.array(citationSchema).min(1).max(15),
  limitations: z.array(z.string().min(1)).min(1).max(5),
});

/** Researcher 交作业时必须匹配的形状 —— 也就是 `structured_output` 工具的参数 schema。
 *
 * 它是 `researchSchema` 的模型可写子集：去掉代码拥有的 arXiv 元数据、把来源类型摊平成
 * 朴素枚举。发给模型的合同就是这一份，所以工具调用参数写错时，SDK 把 zod 的逐条 issue
 * 当作工具错误回灌，模型在同一个 turn 里自己改；不需要另起一次调用。
 */
export const researchProposalSchema = researchSchema.extend({
  queries: z
    .array(
      z.object({
        evidence_id: z.string().min(1),
        source_type: proposedSourceTypeSchema,
        query: z.string().min(1),
        status: evidenceStatusSchema,
        result_summary: z.string().min(1),
      }),
    )
    .min(1)
    .max(12),
  citations: z.array(proposedCitationSchema).min(1).max(15),
});

/** 一个候选假设，而不是已证实结论。
 *
 * 这里把“支持”和“反对”拆成两个字段，并保留替代解释与不确定性。这样即使证据
 * 冲突或不足，Artifact 也只能表达“候选待检验”，不能用一个 `supported: true`
 * 把模型推断伪装成事实。
 */
export const hypothesisCandidateSchema = z.object({
  candidate_id: z.string().min(1),
  claim_status: z.literal("candidate"),
  core_claim: z.string().min(1),
  basis: z.string().min(1),
  supporting_evidence_ids: z.array(z.string().min(1)).max(30),
  opposing_evidence_ids: z.array(z.string().min(1)).max(30),
  falsifiable_predictions: z.array(z.string().min(1)).min(1).max(5),
  alternative_explanations: z.array(z.string().min(1)).min(1).max(5),
  uncertainty: z.array(z.string().min(1)).min(1).max(5),
  boundaries: z.array(z.string().min(1)).min(1).max(5),
  validation_conditions: z.array(z.string().min(1)).min(1).max(5),
});

const hypothesisComparisonCriterionSchema = z.object({
  criterion: z.string().min(1),
  rationale: z.string().min(1),
});

const hypothesisCandidateEvaluationSchema = z.object({
  candidate_id: z.string().min(1),
  rank: z.number().int().min(1),
  strengths: z.array(z.string().min(1)).min(1).max(5),
  weaknesses: z.array(z.string().min(1)).min(1).max(5),
  evidence_ids: z.array(z.string().min(1)).max(30),
  rationale: z.string().min(1),
});

export const hypothesisComparisonSchema = z.object({
  criteria: z.array(hypothesisComparisonCriterionSchema).min(1).max(8),
  evaluations: z.array(hypothesisCandidateEvaluationSchema).min(2).max(6),
  selected_candidate_id: z.string().min(1),
  selection_rationale: z.string().min(1),
});

export const hypothesisSchema = z
  .object({
    artifact_type: z.literal("hypothesis"),
    question: z.string().min(1),
    /** 至少两条可区分候选；选中只表示进入研究计划，不表示已被证实。 */
    candidates: z.array(hypothesisCandidateSchema).min(2).max(6),
    comparison: hypothesisComparisonSchema,
    selection_status: z.literal("candidate_selected"),
    research_artifact_ids: z.array(z.string().min(1)).min(1),
  })
  .superRefine((value, ctx) => {
    const candidateIds = value.candidates.map((candidate) => candidate.candidate_id);
    const uniqueCandidateIds = new Set(candidateIds);
    if (uniqueCandidateIds.size !== candidateIds.length) {
      ctx.addIssue({ code: "custom", path: ["candidates"], message: "candidate_id 必须唯一" });
    }
    const normalizedClaims = value.candidates.map((candidate) => candidate.core_claim.trim().replace(/\s+/g, " "));
    if (new Set(normalizedClaims).size !== normalizedClaims.length) {
      ctx.addIssue({ code: "custom", path: ["candidates"], message: "候选的 core_claim 必须实质可区分" });
    }

    const evaluationIds = value.comparison.evaluations.map((evaluation) => evaluation.candidate_id);
    const candidateIdSet = new Set(candidateIds);
    const missingEvaluations = candidateIds.filter((id) => !evaluationIds.includes(id));
    const unknownEvaluations = evaluationIds.filter((id) => !candidateIdSet.has(id));
    if (missingEvaluations.length > 0 || unknownEvaluations.length > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["comparison", "evaluations"],
        message: `每条候选必须恰好有比较记录；缺少 ${missingEvaluations.join(",") || "无"}，未知 ${unknownEvaluations.join(",") || "无"}`,
      });
    }
    if (new Set(evaluationIds).size !== evaluationIds.length) {
      ctx.addIssue({
        code: "custom",
        path: ["comparison", "evaluations"],
        message: "比较记录不能重复 candidate_id",
      });
    }
    if (!candidateIdSet.has(value.comparison.selected_candidate_id)) {
      ctx.addIssue({
        code: "custom",
        path: ["comparison", "selected_candidate_id"],
        message: "selected_candidate_id 必须指向候选集中的 candidate_id",
      });
    }
  });

export const evidenceReviewSchema = z.object({
  artifact_type: z.literal("evidence-review"),
  hypothesis_artifact_id: z.string().min(1),
  research_artifact_ids: z.array(z.string().min(1)).min(1),
  assessments: z
    .array(
      z.object({
        candidate_id: z.string().min(1),
        claim: z.string().min(1),
        verdict: z.enum(["supports", "contradicts", "uncertain"]),
        rationale: z.string().min(1),
        evidence_ids: z.array(z.string().min(1)),
      }),
    )
    .min(1),
  gaps: z.array(z.string().min(1)).max(4),
  supported: z.boolean(),
});

const cjk = /[㐀-䶿一-鿿]/;

/** 必须是简体中文正文的字段。
 *
 * 约束下沉到 schema：解析当场就报，且能指出具体字段路径，比等到后置门禁再逐条挑更早。
 * 注意这挡不住模型第一次写错 —— refine 不会出现在发给模型的 JSON Schema 里，
 * 所以 instructions 那边仍要把字段语义讲清楚，两边分工不同。
 */
const chineseProse = z
  .string()
  .min(1)
  .refine((text) => cjk.test(text), {
    message: "必须使用简体中文书写正文",
  });

/** 一个实验项和它的出处，绑在同一个对象里。
 *
 * 这里原本是 `baselines: string[]` 外加一张独立的 `experiment_grounding: [{item, evidence_id}]`，
 * 要求模型把 baseline 的名字在两处逐字重复、由代码做精确匹配。live 跑批证明这守不住：
 * 模型想表达绑定关系，就把整个结构序列化成字符串塞进了 `baselines`，两处再也对不上。
 *
 * 能用 schema 表达的约束就不要留给提示词和后置精确匹配 —— 绑定关系写进类型，
 * 模型没有「把它写在别处」的选项，那条脆弱的逐字匹配也就不需要了。
 */
const groundedItemSchema = z.object({
  name: chineseProse,
  evidence_id: z.string().min(1),
});

const researchPredictionSchema = z.object({
  candidate_id: z.string().min(1),
  prediction: chineseProse,
  falsification_criterion: chineseProse,
});

const researchDataRequirementSchema = z.object({
  source: z.string().min(1),
  variables: z.array(z.string().min(1)).min(1),
  conditions: z.array(chineseProse).min(1),
});

const researchStepSchema = z.object({
  order: z.number().int().min(1),
  action: chineseProse,
  expected_output: chineseProse,
});

const researchAnalysisSchema = z.object({
  method: chineseProse,
  inputs: z.array(z.string().min(1)).min(1),
  decision_rule: chineseProse,
});

const resultInterpretationSchema = z.object({
  observed_result: chineseProse,
  meaning: chineseProse,
});

/** 可执行计划的最小闭环：预测—数据/条件—步骤/分析—不同结果含义—停止、回退、补证。
 *
 * 旧版只有 methods/design/expected_outcomes 三段 prose，无法核验“下一步具体做什么”
 * 以及结果出现分叉时如何处理；这里让每个分支都成为结构化字段，仍保留旧字段供提交模板使用。
 */
const executableResearchPlanSchema = z.object({
  predictions: z.array(researchPredictionSchema).min(1),
  data_requirements: z.array(researchDataRequirementSchema).min(1),
  steps: z.array(researchStepSchema).min(2),
  analysis: z.array(researchAnalysisSchema).min(1),
  result_interpretations: z.array(resultInterpretationSchema).min(2),
  stop_conditions: z.array(chineseProse).min(1),
  rollback_conditions: z.array(chineseProse).min(1),
  supplement_evidence_conditions: z.array(chineseProse).min(1),
});

export const researchPlanSchema = z.object({
  artifact_type: z.literal("research-plan"),
  problem_statement: chineseProse,
  rationale: chineseProse,
  technical_details: chineseProse,
  /** 上游材料标识，保持原名不翻译。 */
  datasets: z.array(z.string().min(1)).min(1),
  /** 上游材料标识，保持原名不翻译。 */
  source: z.string().min(1),
  /** 研究目标的中文叙述 —— 要达成什么，不是「目标数据集/目标域」的英文名。 */
  target: chineseProse,
  execution_plan: executableResearchPlanSchema,
  paper_title: chineseProse,
  paper_abstract: chineseProse,
  methods: chineseProse,
  experiments: z.object({
    baselines: z.array(groundedItemSchema).min(2),
    metrics: z.array(groundedItemSchema).min(2),
    design: chineseProse,
  }),
  results: z.object({
    status: z.literal("pending_verification"),
    validation_basis: z.literal("formula_derivation"),
    feasibility_argument: chineseProse,
    expected_outcomes: z
      .array(
        z.object({
          metric: z.string().min(1),
          statement: chineseProse,
        }),
      )
      .min(1),
  }),
  references: z.array(z.string().min(1)).min(1),
  input_artifact_ids: z.array(z.string().min(1)).min(3),
  verification_evidence_ids: z.array(z.string().min(1)),
});

export const reviewSchema = z.object({
  foundation_checks: reviewFoundationChecksSchema,
  artifact_type: z.literal("review"),
  research_plan_artifact_id: z.string().min(1),
  evidence_review_artifact_id: z.string().min(1),
  independent_evidence_ids: z.array(z.string().min(1)).min(1),
  scores: z.object({
    scientific_value: z.number().int().min(1).max(5),
    technical_depth: z.number().int().min(1).max(5),
    application_potential: z.number().int().min(1).max(5),
  }),
  weaknesses: z.array(z.string()),
  feedback: z.array(z.string()),
  suggested_successor_roles: z.array(roleSchema),
  accepted: z.boolean(),
});

export type Research = z.infer<typeof researchSchema>;
type Hypothesis = z.infer<typeof hypothesisSchema>;
export type EvidenceReview = z.infer<typeof evidenceReviewSchema>;
export type ResearchPlan = z.infer<typeof researchPlanSchema>;
export type Review = z.infer<typeof reviewSchema>;
export type DomainArtifact = Research | Hypothesis | EvidenceReview | ResearchPlan | Review;

/** 一个 Task 执行时看到的冻结上下文。 */
export type TaskContext = {
  runId: string;
  taskId: string;
  role: Role;
  goal: string;
  question: string;
  inputArtifactIds: string[];
  inputArtifacts: StoredInput[];
  /** 同题最近几次 run 的确定性战役记录。消融臂与无题号 run 为空。 */
  priorAttempts?: readonly string[];
  /** Harness 证据闸实际晋升的候选；planner 不得用模型自选覆盖它。 */
  promotedCandidateId?: string;
  /** 本 Attempt 启动前消费并冻结的用户指令。 */
  userInstruction?: string;
};

/** 哪个 build 产出了这个 Run —— 模型无从知道也无从上报的事实。 */
export type SourceIdentity = { gitCommit: string; treeDirty: boolean };

/** 这个 Run 属于消融实验的哪一臂。批跑之外的 run 不属于任何一臂，记 null。 */
export type MemoryArm = "on" | "off";

/** 一次业务 Attempt 真实发生过的用量。失败路径上只有「已发生」的那部分，不补零也不猜。 */
export type UsageFacts = {
  agent: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** Only a known subtotal is available; consumers must not treat it as the Attempt total. */
  incomplete?: true;
};

/** 冻结输入里的一条 Artifact。 */
export type StoredInput = {
  id: string;
  type: string;
  content: Record<string, unknown>;
};
