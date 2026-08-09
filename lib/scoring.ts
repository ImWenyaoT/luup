/**
 * **M9 质量评分 —— rubric 的唯一住所（criteria H）。**
 *
 * ## 红线：rubric 文本永不进 agent 的 prompt
 *
 * 本文件里的评级锚点、veto 条款、打分指令，**只能**被 `scripts/score-run.ts` 与
 * `scripts/calibrate-judge.ts` import。它们不得出现在 `agent/instructions.md`、任何
 * subagent 的 instructions、`scripts/run.ts` 的开场 message，也不得经 memory 回传给
 * 下一次 run（题页只写事实，见 {@link factNote}）。
 *
 * 理由是 Goodhart（ch6 L439–L447）：一旦被测系统看得见评分标准，它优化的就是标准而
 * 不是质量，而且会逐渐学会避开 judge 不擅长检测的错误类型 —— 到那时打分系统看起来
 * 一切正常。判分器与被测系统必须解耦，这是结构约束，不是风格偏好。
 *
 * ## 红线：分数永不进 gate
 *
 * judge 也是 Qwen（criteria D1 锁死模型族），同族自评偏置无法用换族 judge 消解。
 * 唯一诚实的处置是**结构性降权**：M9 只用于版本择优（`lib/versionSelect.ts`）与诊断，
 * 永不参与「这一题算不算交付」的判定 —— 那件事由 `scripts/verify-proposal.ts` 与
 * `lib/runOutcome.ts` 确定性地判。M9 也不进技术报告的「成绩」栏。
 *
 * ## 四维四级 + 一条 veto
 *
 * 每个锚点都写成**可验证行为**（ch6 L336 自包含原则）：禁止「体现了深刻理解」这类
 * 抽象表述，换成「给出了可判定的观测量与阈值」这类能逐条比对原文的描述。
 * veto 与质量正交（ch6 L61）：满级也照样能被 veto，被 veto 的版本直接出局。
 */
import { z } from "zod";

/** rubric 版本号。锚点/维度/权重任一改动就 +1 —— 跨版本的分不可比，score.json 里存着它。 */
export const RUBRIC_VERSION = "1.0.0";

export type DimensionId = "falsifiability" | "coherence" | "actionability" | "evidence";

/** Essential 权重 2，Important 权重 1（ch6 L332 的重要性分档）。 */
export type DimensionWeight = "essential" | "important";

export type ScoreDimension = {
  id: DimensionId;
  label: string;
  weight: DimensionWeight;
  /** judge 要回答的那一个问题（一句话，可判定）。 */
  question: string;
  /** 四级锚点，index 0 = 1 级（Fail）… index 3 = 4 级（Excellent）。 */
  levels: [string, string, string, string];
};

const WEIGHT_POINTS: Record<DimensionWeight, number> = { essential: 2, important: 1 };

export const LEVEL_LABELS = ["Fail", "Weak", "Adequate", "Excellent"] as const;

export const levelLabel = (level: number): string => LEVEL_LABELS[Math.min(4, Math.max(1, Math.trunc(level))) - 1];

/**
 * 四个维度。id 是 score.json 的键，**改 id 等于作废全部历史分**。
 *
 * 维度取的是「proposal 正文能自证」的部分：judge 只拿到 proposal.json 与 evidence.md，
 * 不上网、不反查 arXiv —— 引用条目本身真不真由 criteria B 的确定性验收器判（B1–B4），
 * 这里判的是「正文的论断挂不挂得到引用上」。两者分工不重叠。
 */
export const SCORE_DIMENSIONS: ScoreDimension[] = [
  {
    id: "falsifiability",
    label: "假设可证伪性",
    weight: "essential",
    question: "核心假设能不能被一次具体的观测/实验否证？",
    levels: [
      "只复述题面，或给出无法否证的泛化陈述（如「深度学习有助于理解该现象」）。",
      "有方向性主张，但没有指明用什么观测量判定，也没有说明什么结果算否证。",
      "指明了判定用的观测量与数据来源，但阈值或判定规则含糊（如「显著高于」而无量级）。",
      "写出了可判定的观测量、量级/阈值与否证条件：读者能据此说出「若测到 X 则本假设被推翻」。",
    ],
  },
  {
    id: "coherence",
    label: "推导自洽",
    weight: "essential",
    question: "从问题到假设的推导链条每一步都接得上吗？",
    levels: [
      "只有结论没有推导，或前后步骤互相矛盾。",
      "有推导形式，但关键一步靠断言跳过（出现「显然」「众所周知」而无依据）。",
      "推导链完整，个别中间步骤的前提未写明，但不影响结论成立。",
      "每一步都写明前提与依据，且关键前提在正文别处没有被自己推翻；限定条件被显式列出。",
    ],
  },
  {
    id: "actionability",
    label: "方案可落地",
    weight: "important",
    question: "照着这份计划，一个博士生能不能真的开工？",
    levels: [
      "只有「采用深度学习方法」这类占位描述，基线与指标都是空话。",
      "有技术栈名称，但数据集、基线或指标缺其一，无法排出执行顺序。",
      "数据集/基线/指标齐全，实施步骤可读，但资源量级或时间尺度未交代。",
      "数据集有具体来源与获取方式，基线实名可查，指标可量化计算，步骤细到可以直接排期。",
    ],
  },
  {
    id: "evidence",
    label: "引用支撑度",
    weight: "important",
    question: "正文的关键论断挂得到 references 上吗？",
    levels: [
      "论断与 references 之间没有任何对应关系，引用像是事后补的。",
      "只有背景段落挂了引用，方法与结论段的关键论断全部无出处。",
      "多数关键论断有对应引用，个别论断的引用只是话题相关而非支撑。",
      "每条关键论断都能指到具体的一篇引用，且该引用的内容确实支撑该论断（不是话题相关而已）。",
    ],
  },
];

const DIMENSION_IDS = SCORE_DIMENSIONS.map((d) => d.id);

/**
 * veto 条款。与质量正交，独立判定。
 *
 * 与 criteria B 的分工：**B 管引用条目本身真不真**（arXiv 反查标题与作者，确定性代码）；
 * **V 管正文断言的归因**（一个具体数值、一句「已有工作证明」，是否指得到出处）。
 * 前者是代码能验的，后者只有读正文才看得出来 —— 所以它在这里，而不是在验收器里。
 */
export const VETO_RULE = {
  id: "fabrication",
  label: "虚构类断言",
  description:
    "正文出现无法溯源的具体断言：具体数值/百分比/量级而正文与 references 里都找不到出处，" +
    "或把某个结论归因于一篇 references 里并不存在的工作，或声称做过实际未做的实验。" +
    "把「待验证的估计」明确标注为估计**不算** veto —— 标注本身就是溯源。",
} as const;

export const maxWeightedScore = (): number =>
  SCORE_DIMENSIONS.reduce((sum, d) => sum + WEIGHT_POINTS[d.weight] * LEVEL_LABELS.length, 0);

/* ------------------------------------------------------------------ */
/* judge 输出契约                                                        */
/* ------------------------------------------------------------------ */

export const ATTRIBUTIONS = ["supported", "unsourced", "speculative"] as const;
export type Attribution = (typeof ATTRIBUTIONS)[number];

/** 断言归因：一条正文原文摘录 + 它挂不挂得到出处。 */
export const ClaimSchema = z.object({
  /** 正文原文摘录（judge 不得改写）。 */
  quote: z.string().min(1),
  attribution: z.enum(ATTRIBUTIONS),
  /** judge 的说明。**只进 score.json，永不回传给 agent**（见 factNote）。 */
  note: z.string().default(""),
});

export const DimensionScoreSchema = z.object({
  level: z.number().int().gte(1).lte(4),
  claims: z.array(ClaimSchema).default([]),
});

export const ScoreSchema = z.object({
  dimensions: z.object({
    falsifiability: DimensionScoreSchema,
    coherence: DimensionScoreSchema,
    actionability: DimensionScoreSchema,
    evidence: DimensionScoreSchema,
  }),
  veto: z.object({
    triggered: z.boolean(),
    claims: z.array(ClaimSchema).default([]),
  }),
});

export type Score = z.infer<typeof ScoreSchema>;
export type Claim = z.infer<typeof ClaimSchema>;

/** 落盘形态：分数 + 出处身份（谁打的、按哪版 rubric、什么时候）。 */
export type ScoreFile = Score & {
  runId: string;
  rubricVersion: string;
  judgeModel: string;
  thinking: boolean;
  scoredAt: string;
  weighted: number;
  max: number;
  percent: number;
};

export function totalScore(score: Score): { weighted: number; max: number; percent: number } {
  const weighted = SCORE_DIMENSIONS.reduce(
    (sum, d) => sum + WEIGHT_POINTS[d.weight] * score.dimensions[d.id].level,
    0,
  );
  const max = maxWeightedScore();
  return { weighted, max, percent: Math.round((weighted / max) * 1000) / 10 };
}

/* ------------------------------------------------------------------ */
/* 解析：模型输出 → Score                                                 */
/* ------------------------------------------------------------------ */

export type ParseResult = { ok: true; score: Score } | { ok: false; error: string };

/**
 * 从一段自由文本里取出第一个**括号配对完整**的 JSON 对象。
 *
 * 不用正则：百炼这条链路上 response_format 无效（architecture.md 已实测），模型会在
 * JSON 前后写前言与后记，还常常裹一层 ```json 围栏。贪婪/惰性正则在嵌套对象上都会切错。
 */
function extractJsonObject(text: string): string | null {
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "{") continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let j = i; j < text.length; j++) {
      const ch = text[j];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) return text.slice(i, j + 1);
    }
  }
  return null;
}

/** 归因值归一：大小写/空白容忍；认不出的一律降级成 speculative（不猜「有出处」）。 */
function normalizeClaims(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((c) => {
    if (typeof c !== "object" || c === null) return c;
    const raw = (c as { attribution?: unknown }).attribution;
    const s = typeof raw === "string" ? raw.trim().toLowerCase() : "";
    return {
      ...(c as Record<string, unknown>),
      attribution: (ATTRIBUTIONS as readonly string[]).includes(s) ? s : "speculative",
    };
  });
}

/**
 * judge 原始输出 → Score。
 *
 * **失败就是失败**：解析不出、缺维度、档位越界一律返回 `ok:false`，绝不补默认分。
 * 一个静默的默认分会让「judge 没在判事」长得和「judge 判它是中等」一模一样，
 * 而 M10 校准的全部意义正是把这两件事分开。重试与否由调用方显式决定（无隐式 Attempt）。
 */
export function parseScore(text: string): ParseResult {
  const json = extractJsonObject(text);
  if (json === null) return { ok: false, error: "输出里没有完整的 JSON 对象" };
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    return { ok: false, error: `JSON 解析失败：${String(e)}` };
  }
  if (typeof raw !== "object" || raw === null) return { ok: false, error: "JSON 顶层不是对象" };

  const obj = raw as Record<string, unknown>;
  const dims = (typeof obj.dimensions === "object" && obj.dimensions !== null ? obj.dimensions : {}) as Record<
    string,
    unknown
  >;
  const normalizedDims: Record<string, unknown> = {};
  for (const id of DIMENSION_IDS) {
    const d = dims[id];
    if (typeof d !== "object" || d === null) continue;
    normalizedDims[id] = { ...(d as Record<string, unknown>), claims: normalizeClaims((d as { claims?: unknown }).claims ?? []) };
  }
  const veto = (typeof obj.veto === "object" && obj.veto !== null ? obj.veto : {}) as Record<string, unknown>;

  const parsed = ScoreSchema.safeParse({
    dimensions: normalizedDims,
    veto: { ...veto, claims: normalizeClaims(veto.claims ?? []) },
  });
  return parsed.success
    ? { ok: true, score: parsed.data }
    : { ok: false, error: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ") };
}

/* ------------------------------------------------------------------ */
/* judge 请求（rubric 在这里，且只在这里）                                 */
/* ------------------------------------------------------------------ */

export type JudgeInput = {
  /** proposal.json 原文（不做任何摘要/裁剪 —— judge 要读的就是交付物本身）。 */
  proposalJson: string;
  /** evidence.md 原文（L 节点的事实卡，用来判「论断挂不挂得到证据」）。 */
  evidenceMd: string;
};

export type JudgeRequest = { system: string; prompt: string };

const dimensionBlock = (d: ScoreDimension): string =>
  [
    `### ${d.id}（${d.label}｜权重 ${d.weight === "essential" ? "Essential" : "Important"}）`,
    `判什么：${d.question}`,
    ...d.levels.map((text, i) => `- ${i + 1} 级 ${LEVEL_LABELS[i]}：${text}`),
  ].join("\n");

/**
 * 构造 judge 请求。**入参只有 proposal.json 与 evidence.md 原文** —— 不给题面模板、
 * 不给 verdicts、不给历史分，judge 看到的就是一份交付物加它的证据底稿。
 */
export function buildJudgeRequest(input: JudgeInput): JudgeRequest {
  const system = [
    "你是一名严格的科研评审，按下面的评分表评估一份《科学假设与研究计划》。",
    "",
    "通用纪律（违反即评分无效）：",
    "- **篇幅不计分**。更长不等于更好；复述题面、复述前文、堆砌关键词一律不得分。",
    "- 每个档位都要能指到原文。给不出原文依据的档位，往低了判。",
    "- 只依据给你的两份材料判断，不要联网、不要凭记忆补充文献内容。",
    "- 引用条目本身的真伪不归你判（另有确定性验收器反查 arXiv）；你判的是正文论断与引用的对应关系。",
    "",
    `## 评分表（rubric v${RUBRIC_VERSION}）`,
    "",
    ...SCORE_DIMENSIONS.map(dimensionBlock),
    "",
    `### veto：${VETO_RULE.label}`,
    VETO_RULE.description,
    "veto 与四维分正交：即使四维全是 4 级，只要出现虚构类断言就要把 veto 置为 true。",
    "",
    "## 输出格式",
    "",
    "只输出一个 JSON 对象，不要输出别的。结构：",
    "```json",
    JSON.stringify(
      {
        dimensions: Object.fromEntries(
          DIMENSION_IDS.map((id) => [
            id,
            { level: 3, claims: [{ quote: "正文原文摘录", attribution: "supported", note: "为什么这样归因" }] },
          ]),
        ),
        veto: { triggered: false, claims: [] },
      },
      null,
      2,
    ),
    "```",
    "",
    "字段规则：",
    "- `level` 取 1–4 的整数。",
    "- `claims` 是**断言归因**：逐条摘录正文原句（`quote` 必须逐字取自材料，不得改写），",
    `  \`attribution\` 取 ${ATTRIBUTIONS.map((a) => `\`${a}\``).join(" / ")} 之一：`,
    "  supported = 能指到具体出处；unsourced = 具体断言但找不到出处；speculative = 明确标注为推测/待验证。",
    "- `veto.claims` 只放触发 veto 的那些断言；未触发时留空数组。",
  ].join("\n");

  const prompt = [
    "## 材料一：proposal.json（交付物原文）",
    "",
    "```json",
    input.proposalJson.trim(),
    "```",
    "",
    "## 材料二：evidence.md（文献节点产出的事实卡原文）",
    "",
    input.evidenceMd.trim() || "(本次 run 没有 evidence.md)",
  ].join("\n");

  return { system, prompt };
}

/* ------------------------------------------------------------------ */
/* 回传给 agent 的那条窄带宽：只有事实                                     */
/* ------------------------------------------------------------------ */

export type FactNoteInput = {
  runId: string;
  /** 胜出方案标题（proposal.paperTitle）。 */
  winningTitle: string;
  claims: Claim[];
  veto: { triggered: boolean; claims: Claim[] };
};

/**
 * 题页 memory 的**事实行**。criteria H：自进化闭环里回传给 agent 的只有事实，不是分数。
 *
 * 因此这里写的是：胜出假设、关键断言的**原文摘录**、以及哪些断言找不到出处。
 * 不写的是：逐维档位、加权总分、维度名称、judge 的评语（`Claim.note` 是 judge 的自由
 * 文本，最容易把 rubric 措辞泄漏进 agent 可见面）。
 *
 * 带宽收窄是刻意的：分数一旦进入 agent 可见面，rubric 立刻变成优化目标（ch6 L443）。
 */
export function factNote(input: FactNoteInput): string {
  const quote = (c: Claim) =>
    `- 「${c.quote.replace(/\s+/g, " ").trim()}」— ${
      c.attribution === "supported" ? "有出处" : c.attribution === "unsourced" ? "无出处" : "标注为待验证"
    }`;

  const lines = [`- 胜出方案：${input.winningTitle}`, `- 评估对象 run：${input.runId}`, ""];

  if (input.claims.length > 0) {
    lines.push("关键断言（原文摘录，只记事实）：", ...input.claims.map(quote), "");
  }
  if (input.veto.triggered) {
    lines.push(
      "以下断言找不到出处，下一版必须补出处或删除：",
      ...input.veto.claims.map((c) => `- 「${c.quote.replace(/\s+/g, " ").trim()}」`),
      "",
    );
  }
  if (input.claims.length === 0 && !input.veto.triggered) {
    lines.push("本次未摘录到需要回传的断言。", "");
  }
  return lines.join("\n").trimEnd();
}
