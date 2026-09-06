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
import {
  researchPlanExecutionIssues,
  researchPlanQualityIssues,
  upstreamTraceabilityIssues,
} from "./agent/plan-quality.ts";
import { STRUCTURED_OUTPUT_TOOL, type StructuredOutput } from "./agent/roles/structured-output.ts";
import type { RunTraceEvent } from "./agent/run-trace.ts";
import type { StageUsage } from "./executor.ts";
import type { StoredInput, TaskContext } from "./agent/contracts.ts";

/** 两次调用的用量相加。缺失不是零：一边缺就以另一边为准，两边都缺就还是「不知道」。 */
function addUsage(left: StageUsage | null, right: StageUsage | undefined): StageUsage | null {
  if (!right) return left;
  if (!left) return right;
  return {
    ...(left.incomplete || right.incomplete ? { incomplete: true as const } : {}),
    requests: left.requests + right.requests,
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    totalTokens: left.totalTokens + right.totalTokens,
    toolCalls: left.toolCalls + right.toolCalls,
  };
}

export type StageExecutor = (request: {
  runId: string;
  taskId?: string;
  role: Role;
  task?: string;
  agent: Agent<any, any>;
  input: string;
  timeoutMs: number;
  signal?: AbortSignal;
  /** 这次调用**已经发生**的用量。成功路径经由它交还，失败路径挂在抛出的异常上
   *  （`error.usage`）—— 两条路都汇进 `runTask` 的同一个累加器。
   *  离线替身不花钱，不实现它就是「不知道」，不会被写成零。 */
  onUsage?: (usage: StageUsage) => void;
  /** SDK Runner 生命周期的脱敏事实；由 Harness 交给唯一 RunStore 写者。 */
  onTrace?: (event: RunTraceEvent) => void;
}) => Promise<unknown>;

const normalize = (text: string) => text.split(/\s+/).filter(Boolean).join(" ");

/** 角色只接收显式冻结输入，不共享对话。稳定字段在前，纠错材料追加在后以复用公共前缀。 */
function buildStageInput(spec: {
  question: string;
  goal: string;
  inputs: StoredInput[];
  userInstruction?: string;
  priorAttempts?: readonly string[];
  promotedCandidateId?: string;
  correction?: { issue: string; candidate: unknown; frozenSearches?: EvidenceRecord[] };
}): string {
  const payload: Record<string, unknown> = {
    question: spec.question,
    goal: spec.goal,
    input_artifacts: spec.inputs,
  };
  if (spec.userInstruction?.trim()) payload.user_instruction = spec.userInstruction;
  // 空记忆不添加字段，保持消融臂与自由输入的形状；非空记忆放在纠错材料之前。
  if (spec.priorAttempts && spec.priorAttempts.length > 0) {
    payload.prior_attempts = spec.priorAttempts;
  }
  if (spec.promotedCandidateId !== undefined) {
    payload.promoted_candidate_id = spec.promotedCandidateId;
  }
  if (spec.correction) {
    payload.correction = [
      `结构化纠错：${spec.correction.issue}。`,
      "保留合格字段，只修正违规字段，并重新输出完整 Artifact。",
    ].join("");
    payload.rejected_candidate = spec.correction.candidate;
    if (spec.correction.frozenSearches) {
      payload.frozen_searches = spec.correction.frozenSearches;
      payload.correction_search_policy = "reuse frozen_searches; do not run retrieval tools again";
    }
  }
  return JSON.stringify(payload);
}

/** 台账持有 queries 与检索元数据；模型漏报/虚报只记漂移，不改变事实。
 * citation 必须来自其引用的本次检索；claim 还可使用输入 Artifact 的冻结证据。
 * 依据：docs/design/experiment-protocol.json 的 queries_authority 修订。
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

/** question 是冻结输入的回显，由代码覆写并记录漂移，不消耗模型纠错机会。 */
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

/** Research Artifact 里所有真实发生过的检索 ID。
 *
 * Hypothesis 可以把空结果/冲突检索作为反对证据或不确定性的依据，因此这里不能只
 * 读取可引用 citations；引用真实性门仍由 `frozenEvidenceOf` 单独负责。
 */
function frozenResearchEvidenceIds(context: TaskContext): ReadonlySet<string> {
  return new Set(
    inputsOfType(context, "research").flatMap((item) => {
      const research = item.content as unknown as Research;
      return [
        ...research.queries.map((query) => query.evidence_id),
        ...research.citations.map((citation) => citation.evidence_id),
      ];
    }),
  );
}

/** 根据冻结输入与本次检索验收角色产物；ContractError 可纠错，角色顺序由 Harness 决定。 */
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
        const frozenEvidenceIds = frozenResearchEvidenceIds(context);
        const proposed = withFrozenQuestion(hypothesisSchema.parse(raw), context, onDrift);
        const candidateEvidence = proposed.candidates.flatMap((candidate) => [
          ...candidate.supporting_evidence_ids,
          ...candidate.opposing_evidence_ids,
        ]);
        const comparisonEvidence = proposed.comparison.evaluations.flatMap((evaluation) => evaluation.evidence_ids);
        const unknownEvidence = [...new Set([...candidateEvidence, ...comparisonEvidence])].filter(
          (id) => !frozenEvidenceIds.has(id),
        );
        if (unknownEvidence.length > 0) {
          throw new ContractError(
            `hypothesis cites evidence outside its Research Artifacts: ${unknownEvidence.join(", ")}`,
          );
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
        const candidateIds = hypothesisSchema
          .parse(hypothesis.content)
          .candidates.map((candidate) => candidate.candidate_id);
        const assessedIds = proposed.assessments.map((assessment) => assessment.candidate_id);
        const missing = candidateIds.filter((id) => !assessedIds.includes(id));
        const unknown = assessedIds.filter((id) => !candidateIds.includes(id));
        if (missing.length > 0 || unknown.length > 0 || new Set(assessedIds).size !== assessedIds.length) {
          throw new ContractError(
            `evidence review must assess every candidate exactly once; missing ${missing.join(",") || "none"}, unknown ${unknown.join(",") || "none"}`,
          );
        }
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
        const proposed = researchPlanSchema.parse({
          ...researchPlanSchema.parse(raw),
          input_artifact_ids: context.inputArtifactIds,
        });
        const hypothesis = inputsOfType(context, "hypothesis").at(-1)?.content as
          | {
              candidates?: Array<{ candidate_id: string }>;
            }
          | undefined;
        const candidateIds = new Set(hypothesis?.candidates?.map((item) => item.candidate_id) ?? []);
        const promotedCandidateId = context.promotedCandidateId;
        if (!promotedCandidateId || !candidateIds.has(promotedCandidateId)) {
          throw new Error("research-plan task is missing a valid Harness-promoted candidate");
        }
        const candidate = researchPlanSchema.parse({
          ...proposed,
          execution_plan: {
            ...proposed.execution_plan,
            predictions: proposed.execution_plan.predictions.map((prediction) => ({
              ...prediction,
              candidate_id: promotedCandidateId,
            })),
          },
        });
        const authoredCandidateIds = proposed.execution_plan.predictions.map((item) => item.candidate_id);
        if (authoredCandidateIds.some((id) => id !== promotedCandidateId)) {
          onDrift({
            artifactType: proposed.artifact_type,
            field: "execution_plan.predictions.candidate_id",
            before: authoredCandidateIds.join(", "),
            after: promotedCandidateId,
          });
        }
        // 领域门禁与可追溯性一次报全：每个业务 Attempt 只有一次纠错机会，
        // 分两次抛会让模型修好前一半，在后一半上撞死。
        const issues = [
          ...researchPlanQualityIssues(candidate),
          ...researchPlanExecutionIssues(candidate, candidateIds, promotedCandidateId),
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
 * 五角色均通过合成工具上报；本地 schema 校验失败会回灌 zod issue，
 * 由同一次 Runner 调用内的后续 turn 修正，不花 correction。
 * corrections 处理依赖冻结输入和检索台账的后置约束：
 * `canonicalizeResearch` 的检索冻结门、计划质量门与可追溯性门。
 * 后者必须先跑完整个 Attempt 才知道违没违规，只能另起一次调用把材料交还给模型。
 * 两条通路互补，谁也替代不了谁；合成工具只是把第一类失败从 corrections 上卸下来。
 */
export async function runTask(
  context: TaskContext,
  options: {
    execute: StageExecutor;
    ledger?: EvidenceLedger;
    onTrace?: (event: RunTraceEvent) => void;
    signal?: AbortSignal;
  },
): Promise<TaskRunResult> {
  options.signal?.throwIfAborted();
  const userInstruction = context.userInstruction;
  const ledger = options.ledger ?? new EvidenceLedger();
  const { agents, captures } = createRoles(ledger);
  const agent = agents[context.role];
  if (
    context.role !== "researcher" &&
    context.role !== "reviewer" &&
    agent.tools.some((tool) => tool.name !== STRUCTURED_OUTPUT_TOOL)
  ) {
    throw new Error(`${context.role} cannot use retrieval tools`);
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
  let hasUnknownUsage = false;
  // 首轮与纠错共用 300s Attempt deadline；批跑另有单题 40 分钟上限。
  // 固定值依据 docs/design/experiment-protocol.json 的 transient_backoff 修订。
  const deadline = Date.now() + 300_000;
  // 一个业务 Attempt 共用一本检索账。纠错只是修 Artifact，不要求把刚做过的搜索再做一遍。
  ledger.beginScope(context.taskId);
  for (let round = 0; round < 2; round += 1) {
    // 台账跨纠错轮累积，上报窗口不跨：纠错轮要求模型重新交一份完整 Artifact，
    // 上一轮捕获到的那份必须先作废，否则守卫会把第二次上报当成重复调用拒掉。
    const outputCapture = captures[context.role];
    outputCapture.beginRound();
    drift = [];
    let callStarted = false;
    let callHasUsage = false;
    try {
      // 纠错必须重新上报完整产物，并与首轮共享 Attempt deadline。
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new StageError("deadline_exceeded", `${context.role} exceeded the Attempt deadline`);
      }
      options.signal?.throwIfAborted();
      callStarted = true;
      await options.execute({
        runId: context.runId,
        taskId: context.taskId,
        role: context.role,
        task: context.goal,
        agent,
        timeoutMs: remaining,
        signal: options.signal,
        input: buildStageInput({
          question: context.question,
          goal: context.goal,
          inputs: context.inputArtifacts,
          userInstruction,
          priorAttempts: context.priorAttempts,
          promotedCandidateId: context.promotedCandidateId,
          correction,
        }),
        // 模型调用成功了这一段就算花掉了 —— 哪怕紧接着的合同门把产物驳回，
        // 也不能因为「这一轮没交出 Artifact」把已经烧掉的 token 从账上抹掉。
        onUsage: (usage) => {
          callHasUsage = true;
          spent = addUsage(spent, usage);
        },
        onTrace: options.onTrace,
      });
      options.signal?.throwIfAborted();
      if (!callHasUsage) hasUnknownUsage = true;
      if (spent && hasUnknownUsage) spent = { ...spent, incomplete: true };
      // 最终文本只是收尾回执；只有经过本地 schema 校验的工具上报才是产物。
      candidate = capturedArtifact(outputCapture, context.role);
      options.signal?.throwIfAborted();
      return {
        artifact: accept(candidate),
        corrections,
        usage: spent,
        drift,
      };
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error), { cause: error });
      const failedUsage = (error as { usage?: StageUsage } | null)?.usage;
      spent = addUsage(spent, failedUsage);
      if (callStarted && !callHasUsage && !failedUsage) hasUnknownUsage = true;
      if (spent && hasUnknownUsage) spent = { ...spent, incomplete: true };
      if (options.signal?.aborted) {
        const reason: unknown = options.signal.reason;
        if (reason instanceof Error) {
          (reason as Error & { corrections?: number }).corrections = corrections;
          if (spent) (reason as Error & { usage?: StageUsage }).usage = spent;
        }
        options.signal.throwIfAborted();
      }
      if (round === 1 || !(failure instanceof ContractError || failure.name === "ZodError")) {
        // 把纠错次数挂到异常上：失败的 Attempt 也要记准它试过几次
        (failure as { corrections?: number }).corrections = corrections;
        // 用量同理：失败的 Attempt 也花了钱，记账的一层在上面（store.failAttempt）。
        if (spent) (failure as { usage?: StageUsage }).usage = spent;
        throw failure;
      }
      corrections += 1;
      correction = {
        issue: failure.message,
        candidate,
        // 独立的第二次 Runner 调用看不到首轮 tool conversation，必须显式交还已冻结检索。
        frozenSearches:
          context.role === "researcher" || context.role === "reviewer" ? ledger.scopedRecords() : undefined,
      };
    }
  }
  throw new ContractError(`${context.role} correction returned no Artifact`);
}
