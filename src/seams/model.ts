import { OpenAIProvider } from "@openai/agents";

import { StageError } from "../agent/failures.ts";

const DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";

/** 模型接线的唯一事实源，对应 Python 侧的 `backend/app/agent/model.py`。
 *
 * 换 provider 只改这一个文件：凭据、端点、模型 id、模型设置全在这里读，
 * 别处一律不碰 `process.env.QWEN_*`。缺凭据抛的是 `missing_credential`
 * 而不是普通 Error —— 它是一个终态失败分类，批跑要靠它区分「环境没配好」和「模型不行」。
 */
export function qwenModelProvider(): OpenAIProvider {
  const apiKey = process.env.QWEN_API_KEY;
  if (!apiKey) throw new StageError("missing_credential", "missing QWEN_API_KEY");
  return new OpenAIProvider({
    apiKey,
    baseURL: (process.env.QWEN_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, ""),
  });
}

/** Demo 先让五个角色共用一个已验证模型；需要对比时用环境变量覆盖即可。 */
export function modelForRole(): string {
  return process.env.QWEN_MODEL || "qwen3.7-plus";
}

/** 结构化输出场景一律关思考：百炼在 structured output 上开思考会放大 token 且不稳。 */
export const sharedModelSettings = { providerData: { enable_thinking: false } } as const;
