# Agents SDK 与 Qwen Responses 的兼容边界

2026-09-05 对当前 `@openai/agents 0.17.0`、配置模型 `qwen3.8-max` 做了官方文档核对、
SDK 源码检查、本地 HTTP 回归及线上合成探针。结论限定于这套接线；不推定其他模型、地区或未来版本相同。
共 6 次线上请求，服务端报告合计 1,410 tokens。没有运行科研题目、外部检索或批实验。
本地诊断记录在 `outputs/diagnostics/qwen-responses-audit.json`，不上传或入库。

## 已验证的差异

| 验证面 | 实际结果 | Luup 的处理 |
| --- | --- | --- |
| `text.format` 的严格 JSON Schema | SDK 发 `strict:true` 和 `{marker:const schema-wins}`，供应商仍返回 `PLAIN_TEXT`；SDK 最后报 `ModelBehaviorError`。`low` 思考配 `{sum:const 2}` 也只返回纯文本 `2` | 五角色统一走既有 `structured_output` 工具，不依赖原生文本 Schema 约束 |
| Function Calling 回传 | 工具被实际执行，下一轮模型正确返回只有本地工具知道的标记 | 保留 SDK 的工具循环与 `function_call_output` 编解码 |
| 合成工具上报 | 实际 `createStructuredOutput` 成功收到、校验并冻结 `{marker: schema-wins}` | 本地 Zod 校验是权威；不能由此声称供应商严格保证工具 Schema |
| 输出截断 | `max_output_tokens:16` 导致顶层与消息均为 `incomplete`；未修复 SDK 却将残缺文本作为最终成功输出 | 模型 seam 在 Runner 执行工具或接受输出前拒绝非 `completed` 响应 |
| HTTP 重试预算 | 本地持续返回 429/500，原接线实际发 5 次，而 Runner 配置意图是首发加两次重试 | 通过官方 `openAIClient` 配置关闭底层重试，只保留 Runner 的 3 次总预算；400 保持单发 |
| 顶层失败、异常状态、`error` | 官方允许 `failed/incomplete/cancelled/queued/in_progress`；本地真实 SDK + HTTP 验证原映射不守终态 | 非空 `error` 同样拒绝；不等待模型空转至 maxTurns，也不盲重发 |
| `parallelToolCalls:false` | 本地返回 20 个调用，SDK 实际执行 20 次；历史实验协议已有线上同类记录 | maxTurns 只约束模型轮数；保留既定 deadline 与 Reviewer 两次检索门，不擅自给 Researcher 添加新硬上限 |
| 成功上报后的同轮检索 | SDK 会继续执行供应商同响应内其余工具 | 本地上报窗口关闭后拒绝新增检索；无效上报不关闭窗口 |
| 缺失/部分 usage | SDK 可将缺失 usage 补为零 | 保留原始已知用量与未知标记，失败也计账，不伪造精确成本 |

`text.format` 的结果说明本次接线没有提供所要求的严格约束；不是对百炼所有结构化输出接口的否定。
Chat Completions、DashScope 与 Responses 的能力不能互相代证。

## 接线取舍

`QwenResponsesProvider` 继续委托 SDK 原生 Responses 客户端，在返回 ModelResponse 时检查状态。
模型 seam 通过官方 `openAIClient` 入口显式设置 `maxRetries:0`；直接声明 SDK 已使用的同版
`openai@7.8.0`，用于配置既有传输客户端，不另造客户端协议或 Agent loop。
每次 Runner 调用独立观察实际返回的响应，用于保留被拒绝响应及此前调用的用量，避免并发串账。
`incomplete` 是不可交付的 `invalid_output`，不走格式纠错；其他异常响应归 `provider_error`，
上下文超限仍单列。HTTP 传输层原有的有界重试保持；收到异常响应体后不盲重放请求。

五角色共用 `captures` 映射与既有工具上报机制，删除自由文本解析后备路径。
工具 Schema 验证通过后仍须通过冻结证据与领域验收；纯文本完成不等于提交 Artifact。
模型即使忽略工具的 `strict`、自行写错参数，本地校验也不能被绕过。
输出通路调整可能改变纠错次数、延迟与成本；后续实验须记录新的 Harness 代码版本，
不能把修改前后的批次当作同一实现直接合并。历史事实和预注册协议未修改。

当前只支持非流式 Runner 路径。适配器明确拒绝流式调用，未来启用前须验证 SSE 终态及工具事件顺序。
内置 web_search/code_interpreter/MCP、服务端 conversation、background 等并非当前实际消费者，
未因“OpenAI 兼容”标签而启用。

`reasoning.effort:none` 保持当前基线；不是结构化工具必须关闭思考的宣称。
线上 `low` 探针确实出现 reasoning 项，但未验证多轮思考工具循环或科学质量增益。
当前应用没有设置 `store`，沿用百炼默认值；诊断探针显式 `store:false`，不测试服务端续接。

## 如何复验

```sh
# 本地、零模型费用，包含 SDK + HTTP 状态/用量/工具合同回归
pnpm run test:agent

# 默认只显示说明，不发请求
pnpm run test:provider:live

# 显式在线诊断：使用现有 QWEN_* / LUUP_MODEL_ID 接线
pnpm run test:provider:live --live
pnpm run test:provider:live --live --case=structured-tool
```

在线诊断最多 6 个 HTTP 请求，每次最多 128 output tokens（截断用例为 16），不自动重试，
只使用合成输入和本地回显工具。JSON 报告写入 `outputs/diagnostics/qwen-responses-compatibility.json`，
不保存凭据、请求头或 reasoning 正文。`native-schema` 为信息性探针；其不通过不会冒充当前工具通路失败。
原生 Schema 探针遇到服务故障仍非零退出，不能把服务不可用当作不支持。
必需的工具循环、工具上报与截断拒收检查失败时命令非零退出。它不进入普通 CI，也不证明科研任务质量。

## 官方依据

- [百炼 Responses 参数、兼容限制、状态与用量](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-responses)
- [百炼结构化输出](https://help.aliyun.com/zh/model-studio/qwen-structured-output)
- [Agents SDK 模型与 provider 接口](https://openai.github.io/openai-agents-js/guides/models/)
