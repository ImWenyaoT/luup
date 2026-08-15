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
  /** 开一次新的上报窗口，丢弃上一轮捕获到的值。 */
  beginRound(): void;
  /** 已提交的产物；模型没交或交错就还是 undefined。 */
  captured(): { value: unknown } | undefined;
};

/** 把「交作业」从自由文本换成一次工具调用。
 *
 * 形状取自 dsh `packages/subagent/subagent-in-process-driver/src/structured.ts:74-97`：
 * 用真实 schema 注册一个合成工具，产物由工具参数承载，工具体内 stage 值。
 * 它换掉的是 `roles.ts` 里那条「剥围栏 → JSON.parse → zod」的自由文本通路 ——
 * 那条通路上，「JSON 外面多说了两句话」和「字段写错了」是同一类失败，都要多花一次调用。
 *
 * 三件配套照抄 dsh，缺一件这个工具就只是个装饰：
 *
 * 1. **提示词声明**：`STRUCTURED_OUTPUT_INSTRUCTION` 明说只有工具调用算最终答案。
 * 2. **捕获后拒绝后续调用**：第二次调用直接抛，错误回灌给模型而不是把 Attempt 打死。
 *    这就是 deny-only 纪律的落点 —— 守卫只会「拒绝或弃权」，永远不会把一次被拒的调用
 *    重新放行；所以哪怕以后再加守卫，也不必建一张注册表来仲裁它们的先后。
 * 3. **staged → captured 的提交时机**：dsh 分两阶段，是因为它的管线还能把一次成功的
 *    execute 变成错误结果，所以提交要等权威的 `tools/result` 落定。@openai/agents 的函数
 *    工具没有这层瀑布 —— 未声明 outputSchema 时 execute 返回即结果 —— 两个阶段因此塌成
 *    同一行赋值。**不给它保留一个空壳的 staged 变量**：那只会让读的人以为这里还有一个
 *    等待窗口。真正要守住的是顺序，写在 execute 里：校验通过才写 `captured`。
 *
 * 与 `runTask` 那套 corrections 的分工：**工具内校验管 schema 表达得了的约束**
 * （字段缺失、类型、枚举、长度），模型在同一个 turn 内看着 zod 的逐条 issue 自己改；
 * **corrections 管 schema 表达不了的后置约束** —— `.refine()` 的中文正文、
 * 「queries 必须恰好冻结本轮每一次检索」、计划质量门。后者要先跑完整个 Attempt
 * 才知道违没违规，只能另起一次调用把材料交还给模型。两者互补，谁也替代不了谁。
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
    // 无从对照着改。自己解析就能把 zod 的逐条 issue 原样回灌 —— 这正是 dsh 用
    // ToolArgsError(violations) 达到的效果，不必为此去翻全局的敏感数据日志开关。
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
    // dsh 在工具体内调 `exec.concludeTurn()`；@openai/agents 的等价物是 toolUseBehavior。
    // 判据是**捕获成功**而不是「调过这个工具」：参数写错时工具返回的是错误结果，
    // 那一轮必须继续跑，模型才有机会在同一个 turn 里改对。捕获之后立刻收束，
    // 顺带堵死「交完作业又去检索一次」—— 那种检索会落进本轮台账，把 queries 冻结门撞死。
    toolUseBehavior: () => captured === undefined
      ? { isFinalOutput: false, isInterrupted: undefined }
      : { isFinalOutput: true, isInterrupted: undefined, finalOutput: "structured output recorded" },
    beginRound: () => { captured = undefined; },
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
