/** 失败分类。
 *
 * 前五个是 Attempt 级的（某个角色没写出合格 Artifact 或执行层出错），后三个是 Run 级的：
 * 五个角色全部成功、Reviewer 也 accepted 之后，终局引用验收仍可能否掉整个 Run；
 * 而 `infra_timeout` 只可能由批跑判定 —— 一道题挂死到期限之外，只有旁观者能说出这件事。
 * `infra_error` / `infra_timeout` 单列，是为了让 arXiv 不可达不被计成引用造假，
 * 也让「挂死」不被计成模型质量问题 —— 三者在报告里不可混。
 */
export type FailureCode =
  | "invalid_output"
  | "deadline_exceeded"
  | "provider_error"
  | "missing_credential"
  | "runtime_error"
  | "verifier_refs"
  | "infra_error"
  | "infra_timeout";

/** 环境性失败：不反映提案质量，评估的质量分母要把它们排除，批跑连续两次即停批。
 *
 * 与 Python `app/evaluation.py` 的 `INFRASTRUCTURE_CLASSES` 同一个集合。写在这里而不是
 * 批跑或评估里，是因为「哪几类算环境故障」是一个跨越执行、熔断与读数三处的口径，
 * 各处各写一份迟早会分叉。
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
