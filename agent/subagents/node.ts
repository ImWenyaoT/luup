import type { Agent } from "@openai/agents";
import type { ZodType } from "zod";

/**
 * 一个 DAG 节点的装配声明：master 的派工工具照它生成（agent/agent.ts）。
 *
 * `name` 就是派工工具名（eve 时代的约定原样保留：literature / hypothesis /
 * critique / proposal），instructions.md 的 handoff 协议表因此一字不用改。
 */
export type SubagentNode = {
  name: "literature" | "hypothesis" | "critique" | "proposal";
  /** 派工工具的 description —— master 决定何时派工的依据。 */
  description: string;
  /**
   * 轮数熔断（机制层，不靠 prompt）：maxTurns × 上下文窗口 ≈ 原 eve
   * maxInputTokensPerSession 的上界映射。撞线 = 「被截断」，master 升级处理。
   */
  maxTurns: number;
  /** 熔断额度换算基数，与 agent/lib/model.ts 的窗口常量同源。 */
  contextWindowTokens: number;
  /**
   * 该节点交付物的结构契约（critique / proposal）。派工工具用它做返回值的
   * JSON 提取与规范化：合法 → 回规范化 JSON 文本；不合法 → 回原文，交
   * master 的 artifact_write 校验环处置（fail-closed，格式重试 ≤1 不在这里做）。
   */
  contract?: ZodType;
  build: () => Agent;
};
