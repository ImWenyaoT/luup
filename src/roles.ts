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
  const text = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
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
 * 三道门，对齐 backend/app/harness.py 对 ResearchArtifact 的校验：
 *
 * 1. `queries` 必须**恰好**冻结本次调用的每一次检索 —— 集合相等，不是子集。
 *    少报一次就能把「查过但结果不利」的检索藏起来，多报一次就是凭空捏造检索动作。
 * 2. 每条 query 的 metadata 由代码写定（source_type / query / status / result_summary），
 *    模型改不动 —— 否则它可以把 `empty` 写成 `succeeded`。
 * 3. 每条 citation 必须逐字出自它所属那次检索的返回值；claims 可以再加上输入 Artifact
 *    里已冻结的证据 —— 论断能基于上一轮的结论继续，检索记录不能。
 */
function canonicalizeResearch(
  proposed: Research,
  scoped: EvidenceRecord[],
  inherited: ReadonlySet<string>,
): Research {
  const byId = new Map(scoped.map((record) => [record.evidenceId, record]));
  const reported = new Set(proposed.queries.map((query) => query.evidence_id));
  const missing = scoped.filter((record) => !reported.has(record.evidenceId));
  const unknown = [...reported].filter((id) => !byId.has(id));
  if (missing.length > 0 || unknown.length > 0) {
    throw new ContractError([
      "queries must freeze exactly this attempt's searches.",
      missing.length > 0 ? `missing: ${missing.map((item) => item.evidenceId).join(", ")}.` : "",
      unknown.length > 0 ? `never performed: ${unknown.join(", ")}.` : "",
    ].filter(Boolean).join(" "));
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

function inputsOfType(context: TaskContext, type: string): StoredInput[] {
  return context.inputArtifacts.filter((item) => item.type === type);
}

/** 计划能追溯的范围，就是输入里所有 Research Artifact 的引用 —— 不是检索台账全集。 */
function frozenEvidenceOf(context: TaskContext) {
  const citations = inputsOfType(context, "research")
    .flatMap((item) => (item.content as unknown as Research).citations);
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
function acceptFor(context: TaskContext, ledger: EvidenceLedger): (raw: unknown) => DomainArtifact {
  switch (context.role) {
    case "researcher":
      return (raw) => {
        // 这道门不看模型写了什么，所以放在 schema 解析之前：本轮一次检索都没跑，
        // 才是最根本的违规。放在后面会被「queries 不能为空」之类的 schema 报错盖住。
        const scoped = ledger.scopedRecords();
        if (scoped.length === 0) {
          throw new ContractError("researcher published without running any search in this attempt");
        }
        const proposed = researchSchema.parse(raw);
        if (normalize(proposed.question) !== normalize(context.question)) {
          throw new ContractError("research Artifact rewrote the frozen Run question");
        }
        const inheritedResearch = inputsOfType(context, "research");
        const inheritedSearches = new Set(inheritedResearch.flatMap((item) =>
          (item.content as unknown as Research).queries.map((query) =>
            `${query.source_type}\u0000${normalize(query.query).toLowerCase()}`)));
        const hasNovelSearch = scoped.some((record) =>
          !inheritedSearches.has(`${record.sourceType}\u0000${normalize(record.query).toLowerCase()}`));
        if (inheritedResearch.length > 0 && !hasNovelSearch) {
          throw new ContractError("supplementary research repeated every inherited source/query");
        }
        return canonicalizeResearch(proposed, scoped, frozenEvidenceOf(context).evidenceIds);
      };

    case "hypothesis-generation":
      return (raw) => {
        const research = inputsOfType(context, "research");
        if (research.length === 0) throw new Error("hypothesis task is missing its Research Artifact");
        const cited = frozenEvidenceOf(context).evidenceIds;
        const proposed = hypothesisSchema.parse(raw);
        if (normalize(proposed.question) !== normalize(context.question)) {
          throw new ContractError("hypothesis Artifact rewrote the frozen Run question");
        }
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
        return reviewSchema.parse({
          ...reviewSchema.parse(raw),
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
  searches: EvidenceRecord[];
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
  const { agents, capture } = createRoles(ledger);
  const agent = agents[context.role];
  if (context.role !== "researcher" && agent.tools.length !== 0) {
    throw new Error(`${context.role} cannot use tools`);
  }
  const accept = acceptFor(context, ledger);

  let candidate: unknown;
  let correction: { issue: string; candidate: unknown; frozenSearches?: EvidenceRecord[] } | undefined;
  let corrections = 0;
  // 一个 Attempt 最多两次模型调用；失败时往上带的是这个 Attempt 的**合计**已发生用量，
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
  const timeoutMs = Number(process.env.LUUP_STAGE_TIMEOUT_MS || 300_000);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("LUUP_STAGE_TIMEOUT_MS must be a positive number");
  }
  const deadline = Date.now() + timeoutMs;
  // 一个业务 Attempt 共用一本检索账。纠错只是修 Artifact，不要求把刚做过的搜索再做一遍。
  ledger.beginScope(context.taskId);
  for (let round = 0; round < 2; round += 1) {
    // 台账跨纠错轮累积，上报窗口不跨：纠错轮要求模型重新交一份完整 Artifact，
    // 上一轮捕获到的那份必须先作废，否则守卫会把第二次上报当成重复调用拒掉。
    capture.beginRound();
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
      });
      // researcher 交作业走合成工具，最终文本只是收尾回执，产物在上报窗口里。
      candidate = context.role === "researcher" ? capturedArtifact(capture, context.role) : returned;
      return { artifact: accept(parseValue(candidate)), corrections, searches: ledger.scopedRecords() };
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
        frozenSearches: context.role === "researcher" ? ledger.scopedRecords() : undefined,
      };
    }
  }
  throw new ContractError(`${context.role} correction returned no Artifact`);
}
