/** 失败分类。
 *
 * `context_overflow` 是从 `provider_error` 里拆出来的一支：我们塞进去的输入超了模型容量，
 * 既不是 provider 宕机，也不是模型写错格式。它**不算**环境故障 —— 责任在 harness，
 * 该被质量分母看见；单列只是为了让「以后加不加压缩兜底」有一个可数的事实依据。
 *
 * 前六个是 Attempt 级的（某个角色没写出合格 Artifact 或执行层出错），后三个是 Run 级的：
 * 五个角色全部成功、Reviewer 也 accepted 之后，终局引用验收仍可能否掉整个 Run；
 * 而 `infra_timeout` 只可能由批跑判定 —— 一道题挂死到期限之外，只有旁观者能说出这件事。
 * `infra_error` / `infra_timeout` 单列，是为了让 arXiv 不可达不被计成引用造假，
 * 也让「挂死」不被计成模型质量问题 —— 三者在报告里不可混。
 */
/** 九个码的**运行时**清单。类型由它派生，不是各写一份 ——
 *  读数侧的桶归属要断言「每个码恰好落进一个桶」，那条断言需要一个能枚举的事实。 */
export const FAILURE_CODES = [
  "invalid_output",
  "deadline_exceeded",
  "provider_error",
  "context_overflow",
  "missing_credential",
  "runtime_error",
  "verifier_refs",
  "infra_error",
  "infra_timeout",
] as const;

export type FailureCode = (typeof FAILURE_CODES)[number];

/** **熔断口径**：批跑连续两次撞上这里的码就停批（`batch/runner.ts` 的 outage 判定）。
 *
 * 这两个码作为 `controls.batch_circuit_breakers.outage_classes` 写进了预注册协议
 * （`docs/design/experiment-protocol.json`），已注册即不可动。
 *
 * 它**不是**读数用的环境类桶。`eval/metrics.ts` 的 `INFRASTRUCTURE_CLASSES` 另有五个码：
 * 「该不该停批」问的是「再跑下去还有没有信息增益」，「该不该剔出质量分母」问的是「谁能修」，
 * 两个问题的答案本来就不必相同（一次 `provider_error` 不值得停批，却该剔出质量分母）。
 * 早先这里写着「两者同一个集合」，2026-08-15 桶归属明细化之后不再成立。
 */
export const INFRASTRUCTURE_FAILURE_CODES: ReadonlySet<FailureCode> = new Set([
  "infra_error",
  "infra_timeout",
]);

export type Failure = { code: FailureCode; reason: string };

/** 模型输出不满足领域合同。这类失败可以纠错一次，纠错仍不过就终止。 */
export class ContractError extends Error {
  override readonly name = "ContractError";

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}

/** 执行层失败（超时、provider 报错、缺凭据）。纠错解决不了，直接终止。 */
export class StageError extends Error {
  override readonly name = "StageError";
  readonly code: FailureCode;

  constructor(code: FailureCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.code = code;
  }
}

export function classifyFailure(error: unknown): Failure {
  const reason = error instanceof Error ? error.message : String(error);
  if (error instanceof StageError) return { code: error.code, reason };
  // ZodError 与 ContractError 都表示「模型写出来的东西不合格」，归一类。
  if (error instanceof ContractError || (error instanceof Error && error.name === "ZodError")) {
    return { code: "invalid_output", reason };
  }
  return { code: "runtime_error", reason };
}
