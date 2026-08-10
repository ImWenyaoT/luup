import type { Agent } from "@openai/agents";
import type { ZodType } from "zod";

/**
 * 一个 DAG 节点的装配声明：master 的派工工具照它生成（lib/agents/master.ts）。
 *
 * `name` 就是派工工具名（eve 时代的约定原样保留：目录名 = 工具名），
 * instructions.md 的流程描述因此不用改。
 */
export type SubagentNode = {
  name: "scientist" | "reviewer";
  /** 派工工具的 description —— master 决定何时派工的依据。 */
  description: string;
  /**
   * 轮数熔断（机制层，不靠 prompt）：maxTurns × 上下文窗口 ≈ 原 eve
   * maxInputTokensPerSession 的上界映射。撞线 = 「被截断」，master 升级处理。
   */
  maxTurns: number;
  /** 熔断额度换算基数，与 lib/agents/model.ts 的窗口常量同源。 */
  contextWindowTokens: number;
  /**
   * 该节点交付物的结构契约（scientist / reviewer）。派工工具用它做返回值的
   * JSON 提取与规范化：合法 → 回规范化 JSON 文本；不合法 → 回原文，交
   * master 的 artifact_write 校验环处置（fail-closed，格式重试 ≤1 不在这里做）。
   */
  contract?: ZodType;
  /**
   * 契约通过后的机制层归一化（schema>机制>prompt）。scientist 用它做**引用元数据
   * 回填**：`references[].title/authors/year` 从本 run 文献库（arXiv 权威元数据）
   * 覆写 —— 模型的智力产出只有 arxivId + relevance，事实字段不该由模型凭记忆写。
   * 与 arxiv_save「入参只有 id，元数据自取」同一条防线原则。
   */
  normalize?: (data: unknown) => unknown;
  build: () => Agent;
};
