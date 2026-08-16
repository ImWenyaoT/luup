import type { Agent } from "@openai/agents";

import { EvidenceLedger, type EvidenceRecord } from "./agent/evidence.ts";
import { ContractError, StageError } from "./agent/failures.ts";
import { createRoles } from "./agent/roles/index.ts";
import {
  evidenceReviewSchema,
  hypothesisSchema,
  researchPlanSchema,
  researchSchema,
  reviewSchema,
  type DomainArtifact,
  type Research,
  type Role,
} from "./agent/contracts.ts";
import { researchPlanQualityIssues, upstreamTraceabilityIssues } from "./agent/plan-quality.ts";
import { STRUCTURED_OUTPUT_TOOL, type StructuredOutput } from "./agent/roles/structured-output.ts";
import type { StageUsage } from "./executor.ts";
import type { StoredInput, TaskContext } from "./store/contracts.ts";

/** 两次调用的用量相加。缺失不是零：一边缺就以另一边为准，两边都缺就还是「不知道」。 */
function addUsage(left: StageUsage | null, right: StageUsage | undefined): StageUsage | null {
  if (!right) return left;
  if (!left) return right;
  return {
    requests: left.requests + right.requests,
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    totalTokens: left.totalTokens + right.totalTokens,
    toolCalls: left.toolCalls + right.toolCalls,
  };
}

export type StageExecutor = (request: {
  runId: string;
  role: Role;
  agent: Agent<any, any>;
  input: string;
  timeoutMs: number;
  /** 这次调用**已经发生**的用量。成功路径经由它交还，失败路径挂在抛出的异常上
   *  （`error.usage`）—— 两条路都汇进 `runTask` 的同一个累加器。
   *  离线替身不花钱，不实现它就是「不知道」，不会被写成零。 */
  onUsage?: (usage: StageUsage) => void;
}) => Promise<unknown>;

const normalize = (text: string) => text.split(/\s+/).filter(Boolean).join(" ");

/** 模型返回的文本转成对象。
 *
 * 解析失败抛 ContractError 而不是让 SyntaxError 冒上去：「输出不是合法 JSON」正是
 * 最该给一次纠错的情况，可它原本落进「不可纠错」那一类，Attempt 直接判死。
 * live 上撞到过 —— 模型在 JSON 外面多说了两句话，一次机会都没给就终止了。
 *
 * 带 `outputType` 的四个角色到这里已经是对象，直接放行；researcher 走合成工具上报
 * （见 `capturedArtifact`），也不经过这条围栏剥离的路。
 */
function parseValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const text = value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new ContractError(
      `输出不是合法 JSON（${error instanceof Error ? error.message : String(error)}）：只输出 Artifact JSON 本身，不要加解释文字。`,
    );
  }
}

/** 装配一个角色单次调用看到的全部 context。
 *
 * 字段顺序就是序列化顺序，也就是前缀稳定性顺序：`question` 整个 Run 不变放最前，
 * 纠错材料只在第二次调用出现、放最后。这样首轮的 input 是纠错轮 input 的**真前缀**，
 * 两次调用能共享尽可能长的 KV cache 前缀；把纠错信息拌进 goal 会让前缀当场分叉。
 *
 * 这是 context engineering 的边界所在：角色看得见什么由这里决定，
 * 而不是由提示词里写「你可以参考上文」决定 —— 角色之间不共享对话。
 */
function buildStageInput(spec: {
  question: string;
  goal: string;
  inputs: StoredInput[];
  priorAttempts?: readonly string[];
  correction?: { issue: string; candidate: unknown; frozenSearches?: EvidenceRecord[] };
}): string {
  const payload: Record<string, unknown> = {
    question: spec.question,
    goal: spec.goal,
    input_artifacts: spec.inputs,
  };
  // 战役记忆接在稳定段的末尾、纠错材料之前。整个 Run 内它不变，所以首轮 input 仍是
  // 纠错轮 input 的真前缀；接在纠错材料之后会让前缀在第四个字段上就分叉。
  // 空数组不写这个键：没有记忆的 run（消融臂、自由输入）的前缀与本波之前逐字节相同。
  if (spec.priorAttempts && spec.priorAttempts.length > 0) {
    payload.prior_attempts = spec.priorAttempts;
  }
  if (spec.correction) {
    payload.correction = [
      `结构化纠错：${spec.correction.issue}。`,
      "保留合格字段，只修正违规字段，并重新输出完整 Artifact。",
    ].join("");
    payload.rejected_candidate = spec.correction.candidate;
    if (spec.correction.frozenSearches) {
      payload.frozen_searches = spec.correction.frozenSearches;
    }
  }
  return JSON.stringify(payload);
}

/** 用本次调用真正发生过的检索，改写 Research Artifact 里所有证据字段。
 *
 * 检索台账是每次检索的权威记录，harness 自己持有；模型往 `queries` 里写的那份是**转录**，
 * 不是决定。所以三段分工：
 *
 * 1. `queries` 由台账实录**整体填充**，模型写的降为参考输入。集合不一致时落一条漂移
 *    事件、两向各自计数（漏报 = 台账有而模型没写，虚报 = 模型写了而台账没有），
 *    虚报条目直接丢弃 —— 它们不对应任何真实检索，进不了证据面。
 *    这里曾经是一道死刑门（集合不等即 `ContractError`）。它证伪于 v2 批：turn 预算
 *    6→12 之后模型检索更多、需转录的记录更多，漏报率反而从 6% 升到 24%。转录负担与
 *    检索量同向增长，提示词收敛不了 —— 与 `withFrozenQuestion`、引用元数据回填同一模式，
 *    抄写不可变数据本来就不该由模型负责。
 * 2. 每条 query 的 metadata 由代码写定（source_type / query / status / result_summary），
 *    模型改不动 —— 否则它可以把 `empty` 写成 `succeeded`。
 * 3. 每条 citation 必须逐字出自它所属那次检索的返回值；claims 可以再加上输入 Artifact
 *    里已冻结的证据 —— 论断能基于上一轮的结论继续，检索记录不能。
 *    **这一段是模型的选择行为，不是转录**：引一条从没跑过的检索是捏造，照旧判死。
 */
function canonicalizeResearch(
  proposed: Research,
  scoped: EvidenceRecord[],
  inherited: ReadonlySet<string>,
  onDrift: (drift: ArtifactDrift) => void,
): Research {
  const byId = new Map(scoped.map((record) => [record.evidenceId, record]));
  const reported = [...new Set(proposed.queries.map((query) => query.evidence_id))];
  const missing = scoped.filter((record) => !reported.includes(record.evidenceId)).map((record) => record.evidenceId);
  const invented = reported.filter((id) => !byId.has(id));
  if (missing.length > 0 || invented.length > 0) {
    onDrift({
      artifactType: proposed.artifact_type,
      field: "queries",
      before: reported.join(", "),
      after: scoped.map((record) => record.evidenceId).join(", "),
      transcription: { missing, invented },
    });
  }

  const citations = proposed.citations.map((citation) => {
    const record = byId.get(citation.evidence_id);
    if (!record) {
      throw new ContractError(`citation cites a search this attempt never ran: ${citation.evidence_id}`);
    }
    const registered = record.citations.find((item) => item.locator === citation.locator);
    if (!registered) {
      throw new ContractError(`citation "${citation.locator}" was not returned by search ${record.evidenceId}`);
    }
    return { evidence_id: record.evidenceId, ...registered };
  });

  // 失败/空检索也要留在 queries 里供审计，但没有返回 canonical citation 就不能支撑 claim。
  const citable = new Set([...citations.map((item) => item.evidence_id), ...inherited]);
  return researchSchema.parse({
    ...proposed,
    queries: scoped.map((record) => ({
      evidence_id: record.evidenceId,
      source_type: record.sourceType,
      query: record.query,
      status: record.status,
      result_summary: record.resultSummary,
    })),
    citations,
    claims: proposed.claims.map((claim) => ({
      ...claim,
      evidence_ids: claim.evidence_ids.map((id) => {
        if (!citable.has(id)) {
          throw new ContractError(`claims cite evidence from neither this attempt nor its inputs: ${id}`);
        }
        return id;
      }),
    })),
  });
}

/** 一次「代码用冻结事实覆写模型转述」的记录。
 *
 * 覆写救回了一个本来要失败的 Attempt，这恰恰是它不能悄悄发生的理由：
 * 被替换掉的每个字段都要留成证据。落库的一层在 harness。
 */
type ArtifactDrift = {
  artifactType: string;
  field: string;
  before: string;
  after: string;
  /** 转录漂移的两向明细，只有「模型抄写台账」这类字段（目前只有 `queries`）填它。
   *  计数与 ID 都要留：光有「发生过漂移」说不出是漏报还是虚报，两者的含义天差地别。 */
  transcription?: { missing: string[]; invented: string[] };
};

/** 用冻结 Run question 覆写模型转述的那一份。
 *
 * Artifact 里的 `question` **纯属回显**，没有任何下游读它：公共投影两个角色都没挑这个字段
 * （`api/projection.ts` 的 `publicArtifactContentSchema`）、离线评估读的是 `runs.question` 列、
 * 引用验收与战役记忆都不碰它；下游角色看到的 question 由 `buildStageInput` 直接从 context 给，
 * 输入 Artifact 里那一份只是同一个值的第二个副本。既然是模型无权决定的不可变数据，
 * 就该由代码写定 —— 和 citations/queries 元数据、以及 `research_artifact_ids` 那几个
 * 上游 ID 字段一样，模型抄错了不该由它把整个 Attempt 拖死。
 *
 * live 取证（探针 6 次调用）确认漂移形态是**截断**而不是翻译：题面是英文原题包在中文包装里
 * （`domain/science125.ts` 的 `science125Text`），模型只把「问题：」后面那半截填回来，
 * 中文出处整段丢掉。三次拿到合格结构的调用里两次如此。纠错轮救不回来 ——
 * 冻结值本来就明写在同一份 input 的第一个字段上，它看得见仍然照丢。
 *
 * 覆写不静默：对齐 Python `backfill_reference_metadata` 的 `on_mismatch`，
 * 发生一次落一条漂移记录。
 */
function withFrozenQuestion<T extends { artifact_type: string; question: string }>(
  proposed: T,
  context: TaskContext,
  onDrift: (drift: ArtifactDrift) => void,
): T {
  if (normalize(proposed.question) === normalize(context.question)) return proposed;
  onDrift({
    artifactType: proposed.artifact_type,
    field: "question",
    before: proposed.question,
    after: context.question,
  });
  return { ...proposed, question: context.question };
}

function inputsOfType(context: TaskContext, type: string): StoredInput[] {
  return context.inputArtifacts.filter((item) => item.type === type);
}

/** 计划能追溯的范围，就是输入里所有 Research Artifact 的引用 —— 不是检索台账全集。 */
function frozenEvidenceOf(context: TaskContext) {
  const citations = inputsOfType(context, "research").flatMap(
    (item) => (item.content as unknown as Research).citations,
  );
  return {
    evidenceIds: new Set(citations.map((item) => item.evidence_id)),
    urls: new Set(citations.flatMap((item) => (item.url === null ? [] : [item.url]))),
  };
}

/** 每个角色如何把模型的原始输出变成可发布的领域 Artifact。
 *
 * 抛 ContractError 表示「模型写错了、可以纠错」；这些判据全部只看**冻结输入**和
 * 本次调用的检索记录，不依赖任何跨 Task 的内存状态 —— 顺序与依赖已经由 store
 * 的任务图决定，这里只管单个格子里的合同。
 */
function acceptFor(
  context: TaskContext,
  ledger: EvidenceLedger,
  onDrift: (drift: ArtifactDrift) => void,
): (raw: unknown) => DomainArtifact {
  switch (context.role) {
    case "researcher":
      return (raw) => {
        // 这道门不看模型写了什么，所以放在 schema 解析之前：本轮一次检索都没跑，
        // 才是最根本的违规。放在后面会被「queries 不能为空」之类的 schema 报错盖住。
        const scoped = ledger.scopedRecords();
        if (scoped.length === 0) {
          throw new ContractError("researcher published without running any search in this attempt");
        }
        const proposed = withFrozenQuestion(researchSchema.parse(raw), context, onDrift);
        const inheritedResearch = inputsOfType(context, "research");
        const inheritedSearches = new Set(
          inheritedResearch.flatMap((item) =>
            (item.content as unknown as Research).queries.map(
              (query) => `${query.source_type}\u0000${normalize(query.query).toLowerCase()}`,
            ),
          ),
        );
        const hasNovelSearch = scoped.some(
          (record) => !inheritedSearches.has(`${record.sourceType}\u0000${normalize(record.query).toLowerCase()}`),
        );
        if (inheritedResearch.length > 0 && !hasNovelSearch) {
          throw new ContractError("supplementary research repeated every inherited source/query");
        }
        return canonicalizeResearch(proposed, scoped, frozenEvidenceOf(context).evidenceIds, onDrift);
      };

    case "hypothesis-generation":
      return (raw) => {
        const research = inputsOfType(context, "research");
        if (research.length === 0) throw new Error("hypothesis task is missing its Research Artifact");
        const cited = frozenEvidenceOf(context).evidenceIds;
        const proposed = withFrozenQuestion(hypothesisSchema.parse(raw), context, onDrift);
        if (!proposed.evidence_ids.every((id) => cited.has(id))) {
          throw new ContractError("hypothesis cites evidence outside its Research Artifacts");
        }
        return hypothesisSchema.parse({ ...proposed, research_artifact_ids: research.map((item) => item.id) });
      };

    case "evidence-review":
      return (raw) => {
        const research = inputsOfType(context, "research");
        const hypothesis = inputsOfType(context, "hypothesis").at(-1);
        if (research.length === 0 || !hypothesis) throw new Error("evidence-review task is missing its inputs");
        const proposed = evidenceReviewSchema.parse(raw);
        const frozen = frozenEvidenceOf(context).evidenceIds;
        for (const assessment of proposed.assessments) {
          if (assessment.verdict !== "uncertain" && assessment.evidence_ids.length === 0) {
            throw new ContractError(`${assessment.verdict} assessment must cite frozen evidence`);
          }
          if (!assessment.evidence_ids.every((id) => frozen.has(id))) {
            throw new ContractError("evidence review cites evidence outside its Research Artifacts");
          }
        }
        return evidenceReviewSchema.parse({
          ...proposed,
          hypothesis_artifact_id: hypothesis.id,
          research_artifact_ids: research.map((item) => item.id),
        });
      };

    case "research-plan":
      return (raw) => {
        const candidate = researchPlanSchema.parse({
          ...researchPlanSchema.parse(raw),
          input_artifact_ids: context.inputArtifactIds,
        });
        // 领域门禁与可追溯性一次报全：每个业务 Attempt 只有一次纠错机会，
        // 分两次抛会让模型修好前一半，在后一半上撞死。
        const issues = [
          ...researchPlanQualityIssues(candidate),
          ...upstreamTraceabilityIssues(candidate, frozenEvidenceOf(context)),
        ];
        if (issues.length > 0) throw new ContractError(issues.join("；"));
        return candidate;
      };

    case "reviewer":
      return (raw) => {
        const plan = inputsOfType(context, "research-plan").at(-1);
        const evidenceReview = inputsOfType(context, "evidence-review").at(-1);
        if (!plan || !evidenceReview) throw new Error("reviewer task is missing its inputs");
        const proposed = reviewSchema.parse(raw);
        const usable = new Map(
          ledger
            .scopedRecords()
            .filter(
              (record) => (record.status === "succeeded" || record.status === "partial") && record.citations.length > 0,
            )
            .map((record) => [record.evidenceId, record]),
        );
        const invalidEvidenceIds = proposed.independent_evidence_ids.filter((id) => !usable.has(id));
        if (invalidEvidenceIds.length > 0) {
          throw new ContractError(
            `reviewer independent_evidence_ids must reference usable searches in this Attempt: ${invalidEvidenceIds.join(", ")}`,
          );
        }
        return reviewSchema.parse({
          ...proposed,
          research_plan_artifact_id: plan.id,
          evidence_review_artifact_id: evidenceReview.id,
        });
      };
  }
}

/** 取本轮上报的产物。没上报就是合同违规 —— 模型自称完成，却没交作业。
 *
 * 抛 StageError 而不是 ContractError：这一类不给纠错机会，也不隐式重跑。
 * 「你忘了调工具」这句话，模型在同一个 turn 内已经有机会听见了
 * （工具错误会原样回灌），再花一次调用去说同一句话没有理由。
 * 失败分类沿用既有的 `invalid_output`：它就是「模型没写出合格产物」那一类。
 */
function capturedArtifact(capture: StructuredOutput, role: Role): unknown {
  const captured = capture.captured();
  if (!captured) {
    throw new StageError(
      "invalid_output",
      `${role} finished without calling ${STRUCTURED_OUTPUT_TOOL}: only the tool call counts as the final answer`,
    );
  }
  return captured.value;
}

export type TaskRunResult = {
  artifact: DomainArtifact;
  corrections: number;
  /** 这个 Attempt 全部调用的合计用量。执行器不报就是 null —— 「不知道」不写成零。 */
  usage: StageUsage | null;
  /** 代码在这份产物上覆写掉的不可变字段。没发生就是空数组。 */
  drift: ArtifactDrift[];
};

/** 执行一个 Task，至多两次模型调用：首轮 + 一次结构化纠错。
 *
 * 纠错不虚增 Attempt —— 它是同一个业务 Attempt 内的第二次尝试，只记在 corrections 上。
 * 执行层的 StageError（超时、provider 报错）纠错解决不了，直接往上抛。
 *
 * corrections 与 turn 内自我修正的分工（researcher 上报走合成工具之后仍然成立）：
 * 工具参数校验挡的是 **schema 表达得了** 的失败，模型在同一个 turn 内看着 zod issue
 * 自己改，不花 correction；corrections 挡的是 **schema 表达不了** 的后置约束 ——
 * `.refine()` 的中文正文、`canonicalizeResearch` 的检索冻结门、计划质量门与可追溯性门。
 * 后者必须先跑完整个 Attempt 才知道违没违规，只能另起一次调用把材料交还给模型。
 * 两条通路互补，谁也替代不了谁；合成工具只是把第一类失败从 corrections 上卸下来。
 */
export async function runTask(
  context: TaskContext,
  options: { execute: StageExecutor; ledger?: EvidenceLedger },
): Promise<TaskRunResult> {
  const ledger = options.ledger ?? new EvidenceLedger();
  const { agents, capture, planCapture } = createRoles(ledger);
  const agent = agents[context.role];
  if (
    context.role !== "researcher" &&
    context.role !== "research-plan" &&
    context.role !== "reviewer" &&
    agent.tools.length !== 0
  ) {
    throw new Error(`${context.role} cannot use tools`);
  }
  // 漂移记录**按轮作废**：只有被接受的那一轮的覆写才是事实。首轮记下一条覆写、
  // 随后又被别的门驳回时，那条记录属于一份从未发布的产物，不能跟着纠错轮一起落库。
  let drift: ArtifactDrift[] = [];
  const accept = acceptFor(context, ledger, (item) => drift.push(item));

  let candidate: unknown;
  let correction: { issue: string; candidate: unknown; frozenSearches?: EvidenceRecord[] } | undefined;
  let corrections = 0;
  // 一个 Attempt 最多两次模型调用；成功与失败往上带的都是这个 Attempt 的**合计**已发生用量，
  // 只带最后一次会把纠错轮之前烧掉的 token 从账上抹掉。
  let spent: StageUsage | null = null;
  // 这道线判的是「卡死」，不是「慢」：一个阶段 5 分钟还没交出 Artifact 就是挂了。
  // 真正给单题兜底的是外层——`batch/runner.ts` 的 `RUN_TIMEOUT_MS`（40 分钟/题）。
  // 两层不是相乘关系：流水线最坏 10 次阶段调用（证据环 3 × 2 + 计划评审环 2 × 2），
  // 典型路径 5 次；40 分钟先到就先切，这里只负责不让单个阶段无限期吊住。
  // 60s 是 luup-old 时代针对当时更简流水线定的值，对现在的 researcher 不成立：
  // 它一个阶段要做多轮 LLM + 数次 arXiv/Crossref（含 arXiv 官方要求的 3s 间隔）
  // + 合成工具上报。canary 现场 researcher 撞 deadline 拿到 `deadline_exceeded`；
  // 修好 arXiv 超时后重跑，同一阶段实测 56s——离 60s 只剩 4 秒，等于没有余量。
  // 300s 是注册过的硬上界（experiment-protocol.json 的 transient_backoff 修订），
  // 所以写成常量而不是可调参——运行期能改它就等于给预注册留了后门。
  const deadline = Date.now() + 300_000;
  // 一个业务 Attempt 共用一本检索账。纠错只是修 Artifact，不要求把刚做过的搜索再做一遍。
  ledger.beginScope(context.taskId);
  for (let round = 0; round < 2; round += 1) {
    // 台账跨纠错轮累积，上报窗口不跨：纠错轮要求模型重新交一份完整 Artifact，
    // 上一轮捕获到的那份必须先作废，否则守卫会把第二次上报当成重复调用拒掉。
    const outputCapture =
      context.role === "researcher" ? capture : context.role === "research-plan" ? planCapture : undefined;
    outputCapture?.beginRound();
    drift = [];
    try {
      // 先存原始输出再解析：解析失败时纠错提示里也要带上模型写的那份原文，
      // 否则它只收到一句「不是合法 JSON」，无从对照着改。
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new StageError("deadline_exceeded", `${context.role} exceeded the Attempt deadline`);
      }
      const returned = await options.execute({
        runId: context.runId,
        role: context.role,
        agent,
        timeoutMs: remaining,
        input: buildStageInput({
          question: context.question,
          goal: context.goal,
          inputs: context.inputArtifacts,
          priorAttempts: context.priorAttempts,
          correction,
        }),
        // 模型调用成功了这一段就算花掉了 —— 哪怕紧接着的合同门把产物驳回，
        // 也不能因为「这一轮没交出 Artifact」把已经烧掉的 token 从账上抹掉。
        onUsage: (usage) => {
          spent = addUsage(spent, usage);
        },
      });
      // researcher 交作业走合成工具，最终文本只是收尾回执，产物在上报窗口里。
      candidate = outputCapture ? capturedArtifact(outputCapture, context.role) : returned;
      return {
        artifact: accept(parseValue(candidate)),
        corrections,
        usage: spent,
        drift,
      };
    } catch (error) {
      spent = addUsage(spent, (error as { usage?: StageUsage }).usage);
      if (round === 1 || !(error instanceof ContractError || (error as Error)?.name === "ZodError")) {
        // 把纠错次数挂到异常上：失败的 Attempt 也要记准它试过几次
        (error as { corrections?: number }).corrections = corrections;
        // 用量同理：失败的 Attempt 也花了钱，记账的一层在上面（store.failAttempt）。
        if (spent) (error as { usage?: StageUsage }).usage = spent;
        throw error;
      }
      corrections += 1;
      correction = {
        issue: error instanceof Error ? error.message : String(error),
        candidate,
        // 独立的第二次 Runner 调用看不到首轮 tool conversation，必须显式交还已冻结检索。
        frozenSearches:
          context.role === "researcher" || context.role === "reviewer" ? ledger.scopedRecords() : undefined,
      };
    }
  }
  throw new ContractError(`${context.role} correction returned no Artifact`);
}
