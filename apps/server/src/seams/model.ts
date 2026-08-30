import { OpenAIProvider } from "@openai/agents";

import { StageError } from "../agent/failures.ts";

const DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";

/** web 设置面的进程内覆盖（学 dsh 设置面：环境变量是默认，页面可即时补配）。
 *
 * 只活在内存里：不落盘、不进库、进程重启即忘——密钥的持久化仍然只有环境变量
 * 一条路。读取优先级恒为 覆盖 > 环境变量 > 默认值，读取点仍只有本文件。
 */
type ModelOverride = { apiKey?: string; baseUrl?: string; modelId?: string };
let override: ModelOverride = {};
let version = 0;

export function setModelOverride(next: ModelOverride): void {
  override = { ...override, ...next };
  version += 1;
}

export function clearModelOverride(): void {
  override = {};
  version += 1;
}

/** executor 用它决定要不要重建 Runner——配置一变，下一次调用就吃到新接线。 */
export function modelConfigVersion(): number {
  return version;
}

/** 给设置面的只读状态。密钥本体永远不出这个模块。 */
export function modelConfigStatus(): {
  credential: "override" | "environment" | "absent";
  model_id: string;
  base_url: string;
} {
  const credential = override.apiKey ? "override" : process.env.QWEN_API_KEY ? "environment" : "absent";
  return { credential, model_id: modelForRole(), base_url: effectiveBaseUrl() };
}

function effectiveBaseUrl(): string {
  return (override.baseUrl || process.env.QWEN_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
}

/** 模型接线的唯一事实源。
 *
 * 换 provider 只改这一个文件：凭据、端点、模型 id、模型设置全在这里读，
 * 别处一律不碰 `process.env.QWEN_*`。缺凭据抛的是 `missing_credential`
 * 而不是普通 Error —— 它是一个终态失败分类，批跑要靠它区分「环境没配好」和「模型不行」。
 */
export function qwenModelProvider(): OpenAIProvider {
  const apiKey = override.apiKey || process.env.QWEN_API_KEY;
  if (!apiKey) throw new StageError("missing_credential", "missing QWEN_API_KEY");
  return new OpenAIProvider({
    apiKey,
    baseURL: effectiveBaseUrl(),
    // 百炼已原生支持 OpenAI-compatible Responses。显式钉住，避免 SDK 全局默认变化
    // 把 Qwen 静默切回 Chat Completions。
    useResponses: true,
  });
}

/** Demo 先让五个角色共用一个已验证模型；需要对比时用 `LUUP_MODEL_ID` 环境变量覆盖。 */
export function modelForRole(): string {
  return override.modelId || process.env.LUUP_MODEL_ID || "qwen3.8-max";
}

/** 结构化输出场景一律关思考。
 *
 * Responses 用 OpenAI 标准 `reasoning.effort`；百炼已声明旧的非标准
 * `enable_thinking` 后续不再支持。Agents SDK 负责把该设置映射到 Responses 请求。
 */
export const sharedModelSettings = { reasoning: { effort: "none" } } as const;
