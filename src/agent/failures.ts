/** 失败分类。
 *
 * 前五个是 Attempt 级的（某个角色没写出合格 Artifact 或执行层出错），后两个是 Run 级的：
 * 五个角色全部成功、Reviewer 也 accepted 之后，终局引用验收仍可能否掉整个 Run。
 * `infra_error` 单列，是为了让 arXiv 不可达不被计成引用造假 —— 两者在报告里不可混。
 */
export type FailureCode =
  | "invalid_output"
  | "deadline_exceeded"
  | "provider_error"
  | "missing_credential"
  | "runtime_error"
  | "verifier_refs"
  | "infra_error";

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
