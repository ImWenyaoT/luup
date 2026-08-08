import { z } from "zod";

/**
 * 《科学假设与研究计划》契约 —— 赛题 XH-202619 生成结果规范的 10 个标准化字段。
 * 本文件是 master 认证的锚点，实现层不得擅改字段语义。
 */

/** arXiv id 形如 "2401.12345" / "2401.12345v2" / 旧式 "astro-ph/0601001" */
export const arxivIdPattern = /^(\d{4}\.\d{4,5}(v\d+)?|[a-z-]+(\.[A-Z]{2})?\/\d{7}(v\d+)?)$/;

export const ReferenceSchema = z.object({
  arxivId: z.string().regex(arxivIdPattern),
  title: z.string().min(1),
  authors: z.array(z.string()).min(1),
  year: z.number().int().gte(1990).lte(2026),
  /** 该文献支撑本方案的哪个论点 */
  relevance: z.string().min(1),
});

export const ProposalSchema = z.object({
  /** 待研究问题：当前领域存在的具体局限性 */
  problemStatement: z.string().min(50),
  /** 解决思路：基于逻辑推理的创新点阐述，展示推导链条 */
  rationale: z.string().min(100),
  /** 必要的技术手段：验证假设所需的具体技术栈 */
  technicalDetails: z.string().min(50),
  /** 数据集：来源合规的真实数据集 */
  datasets: z.object({
    /** Source：假设推演依据的历史数据 */
    source: z.string().min(20),
    /** Target：验证实验所需的拟采集数据特征 */
    target: z.string().min(20),
  }),
  /** 标题：符合学术出版规范 */
  paperTitle: z.string().min(10).max(300),
  /** 摘要：背景、方法、预期结果完整 */
  paperAbstract: z.string().min(150),
  /** 方法论：具体实施步骤，包括模型架构或实验流程 */
  methods: z.string().min(100),
  /** 实验设计：基线对比与评估指标 */
  experiments: z.object({
    baselines: z.array(z.string().min(1)).min(1),
    metrics: z.array(z.string().min(1)).min(1),
    design: z.string().min(50),
  }),
  /** 实验结果：公式推导或实际执行，论证可行性 */
  results: z.string().min(100),
  /** 参考论文：真实文献，严禁虚构 —— 只允许本次运行 arXiv 实检命中的 id */
  references: z.array(ReferenceSchema).min(5),
});

export type Proposal = z.infer<typeof ProposalSchema>;
export type Reference = z.infer<typeof ReferenceSchema>;

/**
 * C→W handoff 契约。批判结论走结构化返回而非自由文本：胜出假设与强制修改要求
 * 是 W 的必需输入，用 markdown 传递时 master 得靠正则去捞，捞错就静默串味。
 * `critiques` 的 `.min(3)` 是基数防线 —— 判据「每假设 ≥3 条实质批判」在 schema 层
 * 就挡住，不必等 master 数完再打回。
 */
export const CritiqueSchema = z.object({
  /** 逐假设的批判结论，顺序与输入的候选假设一致 */
  assessments: z
    .array(
      z.object({
        /** 候选假设标识，逐字取自输入的 hypotheses 工件（如 "H1"） */
        hypothesisId: z.string().min(1),
        critiques: z
          .array(
            z.object({
              /** 实质批判：具体到哪一步、哪个前提、哪个数字站不住 */
              point: z.string().min(1),
              /** 有工具核查动作支撑时填：检索词 + 命中的 arXiv id/标题 + 对新颖性的影响 */
              checkedWith: z.string().min(1).optional(),
            }),
          )
          .min(3),
        /** 可行性判断（数据可得性、验证成本） */
        feasible: z.boolean(),
      }),
    )
    .min(1),
  /** 胜出假设；若是修改后才成立，用 revisedStatement 给出修改后的陈述 */
  winner: z.object({
    hypothesisId: z.string().min(1),
    revisedStatement: z.string().min(1).optional(),
  }),
  /** 对计划撰写的强制修改要求，W 的 rationale 必须逐条回应 */
  requiredChanges: z.array(z.string().min(1)).min(1),
});

export type Critique = z.infer<typeof CritiqueSchema>;

/** master 对某一节点产物的认证结论 */
export const VerdictSchema = z.object({
  node: z.enum(["literature", "hypothesis", "critique", "proposal"]),
  verdict: z.enum(["pass", "reject"]),
  /** 逐项检查：判据 id（对应 docs/design/criteria.md）→ 是否通过 + 理由 */
  checks: z.array(
    z.object({
      criterion: z.string().min(1),
      pass: z.boolean(),
      reason: z.string().min(1),
    }),
  ),
  /** reject 时必填：定向返工指令 */
  rework: z.string().optional(),
});

export type Verdict = z.infer<typeof VerdictSchema>;
