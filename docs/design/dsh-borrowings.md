# dsh 借鉴台账

deepseek-harness（dsh）是一套生产级 multi-agent OS。luup 是一次 125 题的科研 Agent 交付，
两者体量不在一个量级。这份台账记的是：**哪些模式抄了、抄在哪、解决了什么**，
以及**哪些明确不抄、为什么**。写下来是为了让「没抄」也成为一个有据可查的决定，
而不是没看见。

dsh 行号对应仓库 `/home/ail510/tian_wenyao/projects/oss/deepseek-harness`。

## 已采用

### 1. 合成工具结构化输出

| | |
|---|---|
| dsh | `packages/subagent/subagent-in-process-driver/src/structured.ts:49-141`（工具注册 74-97、提示词声明 26-29、终局守卫 109-111、staged→captured 提交 116-139） |
| luup | `apps/server/src/agent/roles/structured-output.ts`；接线在 `apps/server/src/agent/roles/researcher.ts`、`apps/server/src/roles.ts`（`capturedArtifact`、`capture.beginRound()`）；参数 schema 是 `apps/server/src/agent/contracts.ts` 的 `researchProposalSchema` |

**解决的问题**：researcher 是五个角色里唯一不能用 `outputType` 的 —— 它的产物要先与本轮检索
台账对账才算数。此前它交自由文本，由 `roles.ts` 剥围栏、`JSON.parse`、再 zod 校验；
「JSON 外面多说了两句话」和「某个字段写错了」在那条路上是同一类失败，都要多花一次模型调用。
换成合成工具后，schema 表达得了的失败由 SDK 把 zod 的逐条 issue 当作工具错误回灌，
模型在同一个 turn 内改；`corrections` 只留给 schema 表达不了的后置约束。

三件配套一件不少（缺一件工具就只是装饰）：

- **提示词声明**：`STRUCTURED_OUTPUT_INSTRUCTION` 明说只有工具调用算最终答案。
- **捕获后拒绝后续调用**：第二次上报直接拒，错误回灌而不是把 Attempt 打死。
- **staged→captured 的提交时机**：先有合法的值，才谈得上提交。

两处按 SDK 差异改写，不是照抄：

- dsh 用 `ToolArgsError(violations)` 把校验放进工具体；@openai/agents 若把 zod 交给
  `parameters`，解析失败会被 `dontLogToolData`（默认开）打码成一句 `Invalid JSON input for tool`，
  模型无从对照着改。所以 luup 传 JSON Schema 给 provider、自己在工具体内 `schema.parse`，
  达到同一个效果，不必去翻全局的敏感数据日志开关。
- dsh 在工具体内调 `exec.concludeTurn()` 收束本轮；@openai/agents 的等价物是
  `toolUseBehavior` 函数。判据必须是**捕获成功**而不是「调过这个工具」——
  参数写错时返回的也是一条 function_output，用 `stopAtToolNames` 会把出错那次也当成收尾，
  模型就没有机会在同一个 turn 内改。

### 2. 崩溃恢复（最小版，与 dsh 有明确差距）

| | |
|---|---|
| dsh | `packages/core/session/src/repair.ts:27` `interruptedTurnClosers()` |
| luup | `apps/server/src/store/store.ts:89`（重开数据库即把运行中的 run 判 `interrupted`）+ `apps/server/src/batch/runner.ts:292,299`（批跑给挂死/出错的题补终态 `infra_timeout` / `infra_error`） |

**解决的问题**：进程崩溃后，库里不能留下一个永远「running」的 run —— 那会让批跑的断点续跑
分不清「还没跑」和「跑挂了」，也会让评估的分母虚高。

**差距如实记录**：dsh 修的是**会话可续跑**：它扫描 durable log，为悬空的 tool call 合成
错误结果、补上 `step/end` 与 `turn/end`，让 transcript 重新变成 provider 认的形状，
崩溃点之后能接着跑。luup 修的是**记账可闭合**：它只把中断的 run 标成终态失败，
不恢复、不续跑，那个 run 的结论就是「这次没跑成」。

差距是有意的：luup 的最小执行单位是「一道题一个 run」，重跑整道题的代价是几分钟和几毛钱；
dsh 的会话可以是一整天的人机协作，丢掉不可接受。续跑要求把 tool call 边界持久化成可重放的
事件流，那是另一套存储契约 —— 为一个重跑成本很低的单位付这个价钱不划算。

### 3. 错误码归一：上下文超长

| | |
|---|---|
| dsh | `packages/llm/llm/src/error.ts:25`（`CONTEXT_WINDOW_EXCEEDED_CODE`）、`:80`（`isContextWindowExceededError()` 的正则并集） |
| luup | `apps/server/src/executor.ts` 的 `CONTEXT_OVERFLOW_PATTERNS` / `isContextOverflow()`；错误码 `context_overflow` 在 `apps/server/src/agent/failures.ts` |

**解决的问题**：provider 说「上下文放不下了」的措辞各不相同，原先全部落进 `provider_error`
兜底。这一类既不是 provider 宕机也不是模型写错格式，唯一能救它的动作（压缩、裁剪输入、
换更大窗口）都要先认出它。单列之后，「要不要做压缩兜底」这个问题第一次有了可数的事实依据。

抄的是**写法**：按「谁超了 + 超的是 context」两段来匹配，不做宽泛的 `too long` 全匹配 ——
那会把工具参数过长之类的失败一起吞掉。测试里那两条负例就是这个边界。

`context_overflow` **不进** `INFRASTRUCTURE_FAILURE_CODES`：责任在 harness（是我们塞多了），
该被质量分母看见。这一条与 Python 侧的 `INFRASTRUCTURE_CLASSES` 口径因此仍然一致。
2026-08-15 补：那个常量此后只作**熔断口径**，读数口径是 `apps/server/src/eval/metrics.ts` 的
`INFRASTRUCTURE_CLASSES`（五个码），两者不再是同一个集合；本裁决在两处都成立 ——
`context_overflow` 归 quality，见 `criteria.md` 的失败分类口径一条。

### 4. `qwenModelProvider` 接缝

| | |
|---|---|
| dsh | `packages/core/agent-default-model/src/index.ts:64` `AgentDefaultModelConfig`（模型选择集中在一个 Service 里，agent 不自己拼 provider） |
| luup | `apps/server/src/seams/model.ts`；接缝索引 `apps/server/src/seams/index.ts` |

**解决的问题**：模型接线原先散在 `apps/server/src/executor.ts`（凭据 + 端点）与 `apps/server/src/agent/config.ts`
（模型 id + modelSettings）两处。合成一个文件之后，`process.env.QWEN_*` 只在这里读，
换 provider 只改这一个文件 —— 继承 Python 期 `app/agent/model.py`（ADR-0004 已删）的地位。

同一个索引里另外三个接缝只导出类型（`Verifier` / `RunStore` / `CampaignMemoryPort`），
每个带一段「现有 provider 是谁、换实现要满足什么」。`Harness` 的构造签名认这三个类型，
不认具体类，所以接缝宽度是编译期可验证的事实，不是文档里的一句话。

## 明确不采用

| 模式 | dsh 位置 | 不采用的理由 |
|---|---|---|
| compaction 全套 | `packages/compaction/`（compaction / compaction-basic / tool-result-pruner / command-compact 四个包） | luup 单个 Attempt 至多两次模型调用、角色之间不共享对话，上下文根本长不到需要压缩；真撞上了现在也有 `context_overflow` 这个可数的信号，等它出现再说 |
| 并发调度池 | `packages/core/agent-loop/src/tool-calls.ts:113`（有界滚动池 + 独占屏障 + 启动前重分类） | luup 的编排是写死的五阶段串行，researcher 还显式关了 `parallelToolCalls`；一个没有并发的流水线不需要调度器 |
| scope 分层 | `packages/core/scope/`（cordis Context 树，逐层 provider 覆盖） | 分层的价值在「多个 agent 同时活着、各自要不同的 provider」。luup 一个 run 一条流水线，每个接缝只有一个生产实现加一个离线替身 —— 两个实现撑不起一层作用域机制 |
| guard 注册表 | `packages/core/tools/src/index.ts:1110` `tools.guard()`（全局层 + 作用域链、单调否决） | 注册表解决的是「多条守卫谁先谁后、谁能翻案」。luup 现在总共一条守卫（捕获后拒绝再上报），仲裁机制没有仲裁对象。deny-only 的**纪律**照收：守卫只拒绝或弃权，永不放行别人拒过的调用 —— 写成 `apps/server/src/agent/roles/structured-output.ts` 注册处的注释，不写成代码 |

## 复核

台账里每条 dsh 引用都带 file:line，可以直接对照原文。luup 侧的落点全部有测试：
合成工具三条（`apps/server/test/structured-output.test.ts`）、错误码归一一条（同文件）、
崩溃恢复两条（`apps/server/test/harness.test.ts`、`apps/server/test/batch.test.ts`）、接缝由 `tsc --noEmit` 兜底。
