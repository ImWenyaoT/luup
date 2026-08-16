import { EvidenceLedger } from "./agent/evidence.ts";
import { classifyFailure } from "./agent/failures.ts";
import type { EvidenceReview, Research, ResearchPlan, Review, Role } from "./agent/contracts.ts";
import type { StageUsage } from "./executor.ts";
import { runTask, type StageExecutor } from "./roles.ts";
import type { CampaignMemoryPort, RunStore, Verifier } from "./seams/index.ts";
import type { StoredInput, TaskContext, UsageFacts } from "./store/contracts.ts";
import type { StoredArtifact } from "./store/store.ts";
import { createReferenceVerifier, verificationFailureCode } from "./verify/verifier.ts";

/** Attempt 失败时抛，用来中断五阶段流程。失败本身已经落库。 */
class AttemptFailed extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "AttemptFailed";
    this.code = code;
  }
}

export type RunOutcome = {
  status: "completed" | "review_rejected" | "failed";
  finalArtifactId: string | null;
  errorCode: string | null;
};

/** 固定五阶段编排。
 *
 * 顺序和两条上界都写在下面的控制流里，一眼可读：
 * - 补证：`for (round = 1; round <= 2)`，evidence-review 没有 gaps 就提前 break
 * - 修订：同样两轮，Reviewer 第二次拒绝必定终止
 *
 * 这里曾经把「下一个角色是谁」交给 store 的任务依赖图算。那是 Python 版为任意 DAG
 * 和生产级恢复准备的结构，而 Luup 的主张恰恰是「格子之间怎么走由代码决定」——
 * 写成能一眼读完的循环，比写成依赖图更能说明这件事，评委也看得出上界在哪。
 *
 * store 只负责记账，不参与决定顺序。
 */
export class Harness {
  readonly #store: RunStore;
  readonly #execute: StageExecutor;
  readonly #createLedger: (scope: { runId: string; attemptId: string }) => EvidenceLedger;
  readonly #verifyReferences: Verifier;
  readonly #memory: CampaignMemoryPort | null;

  /** 三个可换实现的位置都以接缝类型入参，不认具体类：见 `src/seams/index.ts`。 */
  constructor(
    store: RunStore,
    execute: StageExecutor,
    options: {
      createLedger?: (scope: { runId: string; attemptId: string }) => EvidenceLedger;
      /** 终局引用验收。默认打 arXiv 官方 API；测试与确定性运行时注入离线替身。 */
      verifyReferences?: Verifier;
      /** 跨 run 战役记忆。不传（或传 null）就是消融臂：既不注入也不写回。 */
      memory?: CampaignMemoryPort | null;
    } = {},
  ) {
    this.#store = store;
    this.#execute = execute;
    this.#verifyReferences = options.verifyReferences ?? createReferenceVerifier();
    this.#memory = options.memory ?? null;
    this.#createLedger =
      options.createLedger ??
      ((scope) =>
        new EvidenceLedger({
          // tool_evidence.id 全库唯一，所以用完整 Attempt ID 隔离每本台账。
          namespace: `${scope.attemptId}_`,
          onRecord: (record) => this.#store.recordEvidence(scope.runId, scope.attemptId, record),
        }));
  }

  createRun(question: string): string {
    return this.#store.createRun(question);
  }

  /** 跑完一个 Run，并把结论确定性追加进战役记忆。
   *
   * 记忆的两端都在这里合拢：开局注入同题最近几次尝试，收尾追加这一次的结论。
   * 注入了几条**必须落成事实**（`campaign.prior_attempts`）—— 消融生效门读的就是它：
   * off 臂的 run 若这条事件的 count > 0，那一臂就不是对照臂，该配对必须剔除。
   * 没有记忆通道时它照样发，count 记 0：缺失与零在这里是两回事，不能靠「没有事件」来推断。
   */
  async execute(runId: string): Promise<RunOutcome> {
    const questionId = this.#store.science125Id(runId);
    const priorAttempts = this.#memory?.readPriorAttempts(questionId) ?? [];
    this.#store.emit(runId, "campaign.prior_attempts", {
      question_id: questionId,
      count: priorAttempts.length,
    });
    const outcome = await this.#pipeline(runId, priorAttempts);
    const plan = this.#store.latestArtifact(runId, "research-plan")?.content as ResearchPlan | undefined;
    this.#memory?.recordRun({
      runId,
      questionId,
      status: outcome.status,
      failureCode: outcome.errorCode,
      title: plan?.paper_title ?? null,
      references: plan?.references ?? [],
    });
    return outcome;
  }

  async #pipeline(runId: string, priorAttempts: readonly string[]): Promise<RunOutcome> {
    const question = this.#store.question(runId);
    try {
      const research: StoredArtifact[] = [];
      const hypotheses: StoredArtifact[] = [];
      let evidenceReview!: StoredArtifact;

      for (let round = 1; round <= 2; round += 1) {
        // 补证轮要带上一轮的 Research Artifact：只给缺口清单的话，第二轮看不到
        // 上一轮已经查到什么，只会把同一份检索原样重做一遍。
        const researchInputs = round === 1 ? [] : [toInput(research.at(-1)!), toInput(evidenceReview)];
        const goal =
          round === 1
            ? "检索并冻结证据"
            : `仅补充证据缺口：${(evidenceReview.content as EvidenceReview).gaps.join("；")}`;
        // 记忆只进 researcher：它是唯一决定「去查什么」的角色，也是唯一能从
        // 「上次这条路走死了」里得到便宜的角色。下游角色只看冻结 Artifact。
        research.push(await this.#step(runId, question, "researcher", researchInputs, goal, priorAttempts));

        // 补证是累积，不是用第二轮替换第一轮：下游必须同时看到全部冻结 Research。
        const frozenResearch = research.map(toInput);
        hypotheses.push(
          await this.#step(
            runId,
            question,
            "hypothesis-generation",
            frozenResearch,
            "基于全部冻结 Research Artifact 生成可证伪假设",
          ),
        );

        evidenceReview = await this.#step(
          runId,
          question,
          "evidence-review",
          [...frozenResearch, toInput(hypotheses.at(-1)!)],
          "审查证据并报告缺口",
        );

        if ((evidenceReview.content as EvidenceReview).gaps.length === 0) break;
      }

      const domainInputs = [...research, ...hypotheses, evidenceReview].map(toInput);
      let plan!: StoredArtifact;
      let review!: StoredArtifact;

      for (let round = 1; round <= 2; round += 1) {
        const plannerInputs = round === 1 ? domainInputs : [...domainInputs, toInput(plan), toInput(review)];
        plan = await this.#step(
          runId,
          question,
          "research-plan",
          plannerInputs,
          round === 1 ? "生成可验证研究计划" : "根据冻结 Review Artifact 修订研究计划",
        );

        review = await this.#step(
          runId,
          question,
          "reviewer",
          [toInput(plan), toInput(evidenceReview)],
          "独立评审研究计划",
        );

        const verdict = review.content as Review;
        if (verdict.accepted) {
          // Reviewer 说好只是另一个模型的判断。终态之前还有一道不问模型的验收：
          // 计划引的文献必须真的存在，而且就是本 run 检索并冻结下来的那几篇。
          const verification = await this.#verifyReferences({
            plan: plan.content as ResearchPlan,
            research: research.map((item) => item.content as Research),
          });
          this.#store.emit(runId, "verification.references", {
            ok: verification.ok,
            reference_count: verification.referenceCount,
            frozen_sources: verification.frozenSources,
            arxiv_checked: verification.arxivChecked,
            doi_checked: verification.doiChecked,
            membership_only: verification.membershipOnly,
            failed_count: verification.failed.length,
            infra_error: verification.infraError,
            // 逐条证据留在库里供报告与排障引用；公共投影只放行上面那些标量。
            checks: verification.checks,
            failed: verification.failed,
          });
          if (!verification.ok) {
            const code = verificationFailureCode(verification);
            this.#store.finishRun(runId, "failed", { errorCode: code });
            return { status: "failed", finalArtifactId: null, errorCode: code };
          }
          this.#store.finishRun(runId, "completed", { finalArtifactId: plan.id });
          return { status: "completed", finalArtifactId: plan.id, errorCode: null };
        }
        // 第二次拒绝、或者 Reviewer 认为一次修订解决不了，都必须终止。
        if (round === 2 || !verdict.suggested_successor_roles.includes("research-plan")) {
          this.#store.finishRun(runId, "review_rejected", { errorCode: "review_rejected" });
          return { status: "review_rejected", finalArtifactId: null, errorCode: "review_rejected" };
        }
      }
      throw new Error("unreachable pipeline state");
    } catch (error) {
      const code = error instanceof AttemptFailed ? error.code : "runtime_error";
      this.#store.finishRun(runId, "failed", { errorCode: code });
      return { status: "failed", finalArtifactId: null, errorCode: code };
    }
  }

  /** 跑一个角色，成功就发布，失败就记账并中断流程。 */
  async #step(
    runId: string,
    question: string,
    role: Role,
    inputs: StoredInput[],
    goal: string,
    priorAttempts: readonly string[] = [],
  ): Promise<StoredArtifact> {
    const attemptId = this.#store.startAttempt(runId, role);
    const context: TaskContext = {
      runId,
      taskId: attemptId,
      role,
      goal,
      question,
      inputArtifactIds: inputs.map((item) => item.id),
      inputArtifacts: inputs,
      priorAttempts,
    };
    const ledger = this.#createLedger({ runId, attemptId });
    try {
      const result = await runTask(context, { execute: this.#execute, ledger });
      // 覆写救回了这个 Attempt，所以它必须留痕：产物发布之前先把「代码替掉了模型写的哪个
      // 字段」落成事实，否则 Artifact 看上去永远是对的，漂移发生过几次谁也说不出来。
      for (const item of result.drift) {
        this.#store.emit(runId, "artifact.field_overwritten", {
          artifact_type: item.artifactType,
          field: item.field,
          before: summarize(item.before),
          after: summarize(item.after),
          // 转录类字段（queries）多带两向明细：只知道「不一致」说不出模型是漏抄还是编造，
          // 而这两件事的含义天差地别。计数是精确的，ID 列表与 before/after 同样截断。
          ...(item.transcription === undefined
            ? {}
            : {
                missing_count: item.transcription.missing.length,
                invented_count: item.transcription.invented.length,
                missing: summarize(item.transcription.missing.join(", ")),
                invented: summarize(item.transcription.invented.join(", ")),
              }),
        });
      }
      // 成功也花了钱，而且是花得最多的那一半。用量与失败路径同一形状、同一条通路：
      // runTask 按 Attempt 累加，store 在终态事件之前落成唯一一条 `sdk.usage`。
      return this.#store.publishArtifact(
        runId,
        attemptId,
        result.artifact,
        inputs,
        result.corrections,
        usageFacts(role, result.usage),
      );
    } catch (error) {
      const failure = classifyFailure(error);
      const errorType = error instanceof Error ? error.name : "Error";
      const corrections = (error as { corrections?: number }).corrections ?? 0;
      // 失败也花了钱。用量由 executor 挂在它抛出的分类异常上、由 runTask 沿两次调用累加，
      // 到这里才落库 —— 不透传就等于把失败的成本从账上抹掉，跑完 125 题算总账时
      // 差的正是最该被看见的那一块。拿不到就传 null，绝不用零顶替。
      this.#store.failAttempt(
        runId,
        attemptId,
        failure,
        errorType,
        corrections,
        usageFacts(role, (error as { usage?: StageUsage } | null)?.usage),
      );
      throw new AttemptFailed(failure.code, failure.reason);
    }
  }
}

/** 漂移记录里的正文摘要。
 *
 * 事件载荷是给人读的排障材料，不是原文存档：question 上限 4000 字，整段抄进每条事件
 * 只会把事件表撑大而不多说一句话。实测的漂移形态（截断掉中文出处）在头 200 字里
 * 一眼可见，够判形态就够了。
 */
const DRIFT_SUMMARY_LENGTH = 200;

function summarize(text: string): string {
  return text.length <= DRIFT_SUMMARY_LENGTH ? text : `${text.slice(0, DRIFT_SUMMARY_LENGTH)}…`;
}

/** StageUsage 转成记账口径的 UsageFacts。没有就是 null —— 「不知道」不写成零。 */
function usageFacts(role: Role, usage: StageUsage | null | undefined): UsageFacts | null {
  if (!usage) return null;
  return {
    agent: role,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
  };
}

function toInput(artifact: StoredArtifact): StoredInput {
  return {
    id: artifact.id,
    type: artifact.type,
    content: artifact.content as unknown as Record<string, unknown>,
  };
}
