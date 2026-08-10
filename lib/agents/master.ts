/**
 * root agent = master（薄调度器）+ 两个派工工具（scientist / reviewer）。
 *
 * 不开思考：master 只做调度、落盘和交给确定性验证器，唯一的"判断"（返修与否）
 * 来自 reviewer 的结构化 verdict —— 严肃推理都在两个节点里（2026-08-10 拓扑
 * 简化：Simplify agent workflow）。
 *
 * 派工 = agent-as-tool：工具名就是节点名（scientist / reviewer），入参只有
 * `{message}`。subagent 之间不共享上下文的隔离由此天然成立：每次派工都是一次
 * 独立的 run()，除 message 里的内容外什么都带不过去。
 *
 * typed 回传（architecture.md「循环控制」，从约定升为机制）：
 *   - 做完   → 工具结果就是节点产物原文（contract 节点先做 JSON 提取/规范化）
 *   - 被截断 → { status: "max_turns", ... }（撞轮数熔断）
 *   - 报错   → { status: "error", ... }
 * master 对后两种不得原样重派。
 *
 * 轮数熔断 = maxTurns × 窗口 的上界映射（各节点额度写在各自 agent.ts）；
 * master 自己的轮数上限在 MASTER_MAX_TURNS，由外层驱动传给 run()。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Agent, MaxTurnsExceededError, run, tool } from "@openai/agents";
import { z } from "zod";
import { qwenModel } from "./model.ts";
import type { SubagentNode } from "./types.ts";
import { scientistNode } from "./scientist.ts";
import { reviewerNode } from "./reviewer.ts";
import artifactWrite from "./tools/artifact_write.ts";
import artifactRead from "./tools/artifact_read.ts";
import verifyReferences from "./tools/verify_references.ts";

/**
 * master 轮数上限：60 轮 × 131k 窗口 ≈ 原 eve maxInputTokensPerSession 8M
 * 的上界映射（薄调度器：两次派工 + 至多一轮返修 + 落盘 + verify，60 轮富余）。
 */
export const MASTER_MAX_TURNS = 60;

/** 会话绝对时限（原 eve sessionTimeoutMs 1h）。外层驱动用它造 AbortSignal。 */
export const MASTER_TIMEOUT_MS = 60 * 60 * 1000;

/**
 * contract 节点返回值的 JSON 提取与规范化：剥 markdown 围栏 → 取最外层花括号 →
 * JSON.parse。schema 过 = 回规范化 JSON（剥掉契约外的杂字段）；JSON 合法但契约
 * 不过 = 回 pretty-print 原对象（让 artifact_write 给出精确的字段错误，而不是
 * 围栏噪声）；连 JSON 都提不出来 = 回原文。验收权只有一个 owner：artifact_write。
 */
function canonicalizeContractOutput(text: string, node: SubagentNode): string {
  if (!node.contract) return text;
  const stripped = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start === -1 || end <= start) return text;
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped.slice(start, end + 1));
  } catch {
    return text;
  }
  const result = node.contract.safeParse(parsed);
  if (!result.success) return JSON.stringify(parsed, null, 2);
  const normalized = node.normalize ? node.normalize(result.data) : result.data;
  return JSON.stringify(normalized, null, 2);
}

/** 一个 DAG 节点 → 一个派工工具。agent 实例构造一次，跨轮次复用（run() 各自独立）。 */
function dispatchTool(node: SubagentNode) {
  const agent = node.build();
  return tool({
    name: node.name,
    description: node.description,
    parameters: z.object({
      message: z
        .string()
        .min(1)
        .describe(
          "The full dispatch message. The subagent sees NOTHING but this text — include everything " +
            "this node needs (question, evidence, proposal, concrete revision items).",
        ),
    }),
    async execute({ message }, _ctx, details) {
      try {
        const result = await run(agent, message, {
          maxTurns: node.maxTurns,
          signal: details?.signal,
          // 百炼对回放的 reasoning item id 可能报 400（SDK 文档明示的兼容旋钮）
          reasoningItemIdPolicy: "omit",
        });
        const text =
          typeof result.finalOutput === "string"
            ? result.finalOutput
            : JSON.stringify(result.finalOutput ?? "");
        return canonicalizeContractOutput(text, node);
      } catch (e) {
        if (e instanceof MaxTurnsExceededError) {
          return {
            status: "max_turns" as const,
            error: `节点 ${node.name} 超出轮数熔断（${node.maxTurns} 轮）。`,
            hint: "这是「被截断」不是「不合格」：不要原样重派——按 instructions 写 FAILED.md 如实报失败。",
          };
        }
        return {
          status: "error" as const,
          error: String(e),
          hint: "这是「报错」不是「不合格」：不要原样重派——按 instructions 写 FAILED.md 如实报失败。",
        };
      }
    },
  });
}

/**
 * 装配 master。工厂而非模块级实例：入口脚本先 loadEnvFile 再构造，
 * 静态装配自检（scripts/selftest-agents.ts）也能在无 .env 环境下构造。
 *
 * 工具面 = instructions「工具边界」的闭集：两个派工工具 + 工件读写 + 终审。
 * 文献与记忆工具都在节点手里（scientist 持 memory_search / arxiv_*），master
 * 不越权检索；跨 run 记忆归档走代码路径（scripts/run.ts 的 archiveRunOutcome）。
 *
 * 工具顺序是 KV cache 判据的一部分（architecture.md「KV cache 经营」②）：
 * 定义顺序即请求里的序列化顺序，**不许按用途重排**。
 */
export function buildMasterAgent(): Agent {
  return new Agent({
    name: "master",
    instructions: readFileSync(join(import.meta.dirname, "master.md"), "utf8"),
    model: qwenModel(),
    tools: [
      dispatchTool(scientistNode),
      dispatchTool(reviewerNode),
      artifactWrite,
      artifactRead,
      verifyReferences,
    ],
  });
}

/** DAG 节点声明的唯一清单（selftest-agents 按它做静态装配断言）。 */
export const SUBAGENT_NODES: readonly SubagentNode[] = [scientistNode, reviewerNode];
