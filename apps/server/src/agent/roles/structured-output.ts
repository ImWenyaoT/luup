import { RunContext, tool, type Agent, type FunctionTool, type ToolsToFinalOutputResult } from "@openai/agents";
import { z } from "zod";

/** strict 工具参数的 JSON Schema 形状。SDK 的 `JsonObjectSchemaStrict` 没从包根导出，
 *  这里按它的结构写一份等价的，只用于把 zod 转出来的对象交给 `tool()`。 */
type StrictToolParameters = {
  type: "object";
  properties: Record<string, Record<string, unknown>>;
  required: string[];
  additionalProperties: false;
};

/** 模型要交作业，只能调这个工具。 */
export const STRUCTURED_OUTPUT_TOOL = "structured_output";

/** 跟着工具一起进提示词的那句话：只有工具调用算最终答案。 */
export const STRUCTURED_OUTPUT_INSTRUCTION = [
  `写完之后，你必须调用 \`${STRUCTURED_OUTPUT_TOOL}\` 工具上报最终产物，参数逐字段匹配它的参数 schema。`,
  "不要用纯文本收尾：只有这次工具调用算最终答案，正文里再写一遍 JSON 不作数。",
  "工具只调一次；它一旦成功，这一轮就结束了。",
].join("");

/** 一次上报窗口的句柄。 */
export type StructuredOutput = {
  /** 注册给 Agent 的合成工具。 */
  readonly tool: FunctionTool<unknown, any, unknown>;
  /** 装到 Agent 上的 `toolUseBehavior`：捕获成功即收束本轮，见下面的说明。 */
  readonly toolUseBehavior: () => ToolsToFinalOutputResult;
  /** 检索入口的本地闸：成功上报后不得再开始检索。 */
  readonly assertOpen: () => void;
  /** 开一次新的上报窗口，丢弃上一轮捕获到的值。 */
  beginRound(): void;
  /** 已提交的产物；模型没交或交错就还是 undefined。 */
  captured(): { value: unknown } | undefined;
};

/** 五角色共用的上报通路：本地 schema 校验通过后才捕获，并终止当前 Runner 调用。
 * 错误参数回灌给模型；捕获后拒绝重复上报和新增检索，纠错时显式重开窗口。
 * 领域后置约束由 runTask 验收，不依赖 provider 遵守 strict 参数。
 */
export function createStructuredOutput(schema: z.ZodObject<any>): StructuredOutput {
  let captured: { value: unknown } | undefined;

  // 参数 schema 由 zod 直接转，`io: "input"` 取的是解析前的形状 —— 模型写的正是这一端。
  // `$schema` 是文档级元数据，provider 不需要，去掉少发一点字节。
  const { $schema: _unused, ...converted } = z.toJSONSchema(schema, {
    io: "input",
    target: "draft-2020-12",
  }) as Record<string, unknown>;
  // zod 转出来的就是一个 object schema；`strict: true` 会再补齐 required 与
  // additionalProperties。这里只是把结构性事实告诉类型系统。
  const parameters = converted as unknown as StrictToolParameters;

  const captureTool = tool({
    name: STRUCTURED_OUTPUT_TOOL,
    description: [
      "Report your final artifact. Call this exactly once, when the artifact is complete;",
      "the arguments must match this tool's parameter schema exactly.",
    ].join(" "),
    // 传 JSON Schema 而不是 zod，是为了让校验发生在**工具体内**：SDK 对 zod 参数的解析
    // 失败会被 `dontLogToolData` 默认打码，模型只收到一句「Invalid JSON input for tool」，
    // 无从对照着改。工具体内解析可回灌逐条 issue，无需打开全局敏感数据日志。
    strict: true,
    parameters,
    async execute(args: unknown) {
      if (captured !== undefined) {
        throw new Error(`${STRUCTURED_OUTPUT_TOOL} already recorded: this round is complete, report once`);
      }
      // 先校验后提交：`schema.parse` 抛出去时 `captured` 一个字节都没动过，
      // 所以一次失败的上报不会污染这一轮的窗口。
      captured = { value: schema.parse(args) };
      return { recorded: true } as const;
    },
  });

  return {
    tool: captureTool as unknown as FunctionTool<unknown, any, unknown>,
    // 判据是**捕获成功**而不是「调过这个工具」：参数写错时工具返回的是错误结果，
    // 那一轮必须继续跑，模型才有机会在同一个 turn 里改对。捕获之后立刻收束，
    // provider 仍可能在同一响应内多调工具；检索入口另用 assertOpen 挡住上报后的新调用。
    toolUseBehavior: () =>
      captured === undefined
        ? { isFinalOutput: false, isInterrupted: undefined }
        : { isFinalOutput: true, isInterrupted: undefined, finalOutput: "structured output recorded" },
    assertOpen: () => {
      if (captured !== undefined) throw new Error(`${STRUCTURED_OUTPUT_TOOL} already recorded: no further searches`);
    },
    beginRound: () => {
      captured = undefined;
    },
    captured: () => captured,
  };
}

/** 让离线替身走与真模型完全相同的上报通道。
 *
 * 确定性运行时和测试替身直接 `return artifact` 就绕开了工具校验，那样它们验证的编排
 * 与 live 的编排就不是同一条了。经由这里调用，替身也要过 `structured_output` 的 schema。
 */
export function reportStructuredOutput(agent: Agent<any, any>, value: unknown): Promise<unknown> {
  const target = agent.tools.find((item) => item.name === STRUCTURED_OUTPUT_TOOL);
  if (!target || target.type !== "function") {
    throw new Error(`${agent.name} has no ${STRUCTURED_OUTPUT_TOOL} tool`);
  }
  // 参数写错时返回的是错误文本而不是抛异常 —— 与模型看到的一模一样。
  return Promise.resolve(target.invoke(new RunContext(), JSON.stringify(value)));
}
