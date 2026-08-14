import { z } from "zod";

import type { Failure } from "./failures.ts";

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
export const sourceTypeSchema = z.preprocess(
  (value) => value === "crossref" ? "web" : value,
  z.enum(["web", "arxiv"]),
);
export type SourceType = z.infer<typeof sourceTypeSchema>;

/** 同一个字段发给模型时的写法：三个值的朴素枚举，没有 preprocess。
 *
 * `z.preprocess` 的输入端是 `unknown`，转成 JSON Schema 后该字段会掉出 `required`，
 * strict 化时再被补成 nullable —— 于是模型被允许写 null，每次都要多花一个 turn 纠正。
 * 别名直接写进枚举，模型侧只剩一个平铺的合法值集合；`crossref → web` 的归一
 * 仍由 `sourceTypeSchema` 在落库前完成，而且这个字段最终一律被台账整条覆写。
 */
export const proposedSourceTypeSchema = z.enum(["web", "arxiv", "crossref"]);

/** 一次检索的结局。八个值与 backend/app/models.py 的 EvidenceStatus 逐字对齐，
 *  两边审计口径才能比对。 */
export const evidenceStatusSchema = z.enum([
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
 * 与 `citationSchema` 的差别只有 arXiv 元数据：那两个字段由代码从台账覆写，
 * 模型既写不动也看不见，所以不能出现在发给模型的 JSON Schema 里
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
});

export const researchSchema = z.object({
  artifact_type: z.literal("research"),
  question: z.string().min(1),
  summary: z.string().min(1),
  claims: z.array(z.object({
    statement: z.string().min(1),
    evidence_ids: z.array(z.string().min(1)).min(1),
  })).min(1).max(8),
  queries: z.array(z.object({
    evidence_id: z.string().min(1),
    source_type: sourceTypeSchema,
    query: z.string().min(1),
    status: evidenceStatusSchema,
    result_summary: z.string().min(1),
  })).min(1).max(12),
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
  queries: z.array(z.object({
    evidence_id: z.string().min(1),
    source_type: proposedSourceTypeSchema,
    query: z.string().min(1),
    status: evidenceStatusSchema,
    result_summary: z.string().min(1),
  })).min(1).max(12),
  citations: z.array(proposedCitationSchema).min(1).max(15),
});

export const hypothesisSchema = z.object({
  artifact_type: z.literal("hypothesis"),
  question: z.string().min(1),
  hypothesis: z.string().min(1),
  rationale: z.string().min(1),
  falsifiable_predictions: z.array(z.string().min(1)).min(1).max(5),
  boundaries: z.array(z.string().min(1)).min(1).max(5),
  research_artifact_ids: z.array(z.string().min(1)).min(1),
  evidence_ids: z.array(z.string().min(1)).min(1),
  validation_conditions: z.array(z.string().min(1)).min(1).max(5),
});

export const evidenceReviewSchema = z.object({
  artifact_type: z.literal("evidence-review"),
  hypothesis_artifact_id: z.string().min(1),
  research_artifact_ids: z.array(z.string().min(1)).min(1),
  assessments: z.array(z.object({
    claim: z.string().min(1),
    verdict: z.enum(["supports", "contradicts", "uncertain"]),
    rationale: z.string().min(1),
    evidence_ids: z.array(z.string().min(1)),
  })).min(1),
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
const chineseProse = z.string().min(1).refine((text) => cjk.test(text), {
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
    expected_outcomes: z.array(z.object({
      metric: z.string().min(1),
      statement: chineseProse,
    })).min(1),
  }),
  references: z.array(z.string().min(1)).min(1),
  input_artifact_ids: z.array(z.string().min(1)).min(3),
  verification_evidence_ids: z.array(z.string().min(1)),
});

export const reviewSchema = z.object({
  artifact_type: z.literal("review"),
  research_plan_artifact_id: z.string().min(1),
  evidence_review_artifact_id: z.string().min(1),
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
export type Hypothesis = z.infer<typeof hypothesisSchema>;
export type EvidenceReview = z.infer<typeof evidenceReviewSchema>;
export type ResearchPlan = z.infer<typeof researchPlanSchema>;
export type Review = z.infer<typeof reviewSchema>;
export type DomainArtifact = Research | Hypothesis | EvidenceReview | ResearchPlan | Review;

export type StoredArtifact = { id: string; type: DomainArtifact["artifact_type"]; content: DomainArtifact };

/** 一个业务 Attempt。SDK 内部的 model/tool turn 不升级成 Attempt，
 *  同一个 Attempt 内的结构化纠错记在 corrections 上，不虚增计数。 */
export type AttemptRecord = {
  role: Role;
  ordinal: number;
  status: "succeeded" | "failed";
  inputArtifactIds: string[];
  outputArtifactId: string | null;
  corrections: number;
  failure?: Failure;
};
