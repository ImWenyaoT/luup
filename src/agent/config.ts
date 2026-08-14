/** 五个 Agent 共用的模型配置。 */

/** Demo 先让五个角色共用一个已验证模型；需要对比时用环境变量覆盖即可。 */
export function modelForRole(): string {
  return process.env.QWEN_MODEL || "qwen3.7-plus";
}

/** 结构化输出场景一律关思考：百炼在 structured output 上开思考会放大 token 且不稳。 */
export const sharedModelSettings = { providerData: { enable_thinking: false } } as const;
