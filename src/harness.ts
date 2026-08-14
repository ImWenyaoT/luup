import { EvidenceLedger } from "./agent/evidence.ts";
import { classifyFailure } from "./agent/failures.ts";
import type { EvidenceReview, Review, Role } from "./agent/contracts.ts";
import { runTask, type StageExecutor } from "./roles.ts";
import type { StoredInput, TaskContext } from "./store/contracts.ts";
import type { SqliteStore, StoredArtifact } from "./store/store.ts";

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
  readonly #store: SqliteStore;
  readonly #execute: StageExecutor;
  readonly #createLedger: (scope: { runId: string; attemptId: string }) => EvidenceLedger;

  constructor(
    store: SqliteStore,
    execute: StageExecutor,
    options: { createLedger?: (scope: { runId: string; attemptId: string }) => EvidenceLedger } = {},
  ) {
    this.#store = store;
    this.#execute = execute;
    this.#createLedger = options.createLedger
      ?? ((scope) => new EvidenceLedger({
        // tool_evidence.id 全库唯一，所以用完整 Attempt ID 隔离每本台账。
        namespace: `${scope.attemptId}_`,
        onRecord: (record) => this.#store.recordEvidence(scope.runId, scope.attemptId, record),
      }));
  }

  createRun(question: string): string {
    return this.#store.createRun(question);
  }

  async execute(runId: string): Promise<RunOutcome> {
    const question = this.#store.question(runId);
    try {
      const research: StoredArtifact[] = [];
      const hypotheses: StoredArtifact[] = [];
      let evidenceReview!: StoredArtifact;

      for (let round = 1; round <= 2; round += 1) {
        // 补证轮要带上一轮的 Research Artifact：只给缺口清单的话，第二轮看不到
        // 上一轮已经查到什么，只会把同一份检索原样重做一遍。
        const researchInputs = round === 1 ? [] : [toInput(research.at(-1)!), toInput(evidenceReview)];
        const goal = round === 1
          ? "检索并冻结证据"
          : `仅补充证据缺口：${(evidenceReview.content as EvidenceReview).gaps.join("；")}`;
        research.push(await this.#step(runId, question, "researcher", researchInputs, goal));

        // 补证是累积，不是用第二轮替换第一轮：下游必须同时看到全部冻结 Research。
        const frozenResearch = research.map(toInput);
        hypotheses.push(await this.#step(runId, question, "hypothesis-generation",
          frozenResearch, "基于全部冻结 Research Artifact 生成可证伪假设"));

        evidenceReview = await this.#step(runId, question, "evidence-review",
          [...frozenResearch, toInput(hypotheses.at(-1)!)], "审查证据并报告缺口");

        if ((evidenceReview.content as EvidenceReview).gaps.length === 0) break;
      }

      const domainInputs = [...research, ...hypotheses, evidenceReview].map(toInput);
      let plan!: StoredArtifact;
      let review!: StoredArtifact;

      for (let round = 1; round <= 2; round += 1) {
        const plannerInputs = round === 1
          ? domainInputs
          : [...domainInputs, toInput(plan), toInput(review)];
        plan = await this.#step(runId, question, "research-plan", plannerInputs,
          round === 1 ? "生成可验证研究计划" : "根据冻结 Review Artifact 修订研究计划");

        review = await this.#step(runId, question, "reviewer",
          [toInput(plan), toInput(evidenceReview)], "独立评审研究计划");

        const verdict = review.content as Review;
        if (verdict.accepted) {
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
  ): Promise<StoredArtifact> {
    const attemptId = this.#store.startAttempt(runId, role);
    const context: TaskContext = {
      runId, taskId: attemptId, role, goal, question,
      inputArtifactIds: inputs.map((item) => item.id),
      inputArtifacts: inputs,
    };
    const ledger = this.#createLedger({ runId, attemptId });
    try {
      const result = await runTask(context, { execute: this.#execute, ledger });
      return this.#store.publishArtifact(runId, attemptId, result.artifact, inputs, result.corrections);
    } catch (error) {
      const failure = classifyFailure(error);
      const errorType = error instanceof Error ? error.name : "Error";
      const corrections = (error as { corrections?: number }).corrections ?? 0;
      this.#store.failAttempt(runId, attemptId, failure, errorType, corrections);
      throw new AttemptFailed(failure.code, failure.reason);
    }
  }
}

function toInput(artifact: StoredArtifact): StoredInput {
  return {
    id: artifact.id,
    type: artifact.type,
    content: artifact.content as unknown as Record<string, unknown>,
  };
}
