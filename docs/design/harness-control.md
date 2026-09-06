# Harness 运行控制

交互运行支持查询进度、停止当前研究和向尚未启动的角色追加指令。Run 是控制对象，Attempt 是子角色的一次执行事实；SQLite 仍是唯一事实源。调度器只持有进程内队列、执行 Promise 和 AbortController，不复制领域状态机。

## 接口与语义

| 操作     | 接口                              | 结果                                                                                                     |
| -------- | --------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 查询     | `GET /api/runs/:id` 和既有 SSE    | 排队、派发、停止请求及指令状态事件；每个子角色的起止时间、已观测工具次数和最近五条工具活动               |
| 停止     | `POST /api/runs/:id/cancel`       | 活动运行返回 `202 {status:"stopping"}`；排队取消或已有终态返回 `200 {status:"settled"}`                  |
| 追加指令 | `POST /api/runs/:id/instructions` | 请求 `{instruction_id,role,instruction}`；返回 `queued`、`applied` 或 `discarded`，应用后带 `attempt_id` |

两种写操作沿用创建 Run 的 Bearer token 授权；确定性运行且未配置 token 时允许本地测试。控制已有运行不会增加工具权限，也不增加模型调用预算。

## 停止与收尾

- 排队运行立即移出队列，零角色调用。活动运行先写 `harness.stop_requested` 再发出取消信号；并发名额只在执行 Promise 真正退出后释放。
- 信号经 Harness、runTask、SDK Runner 传到模型请求、检索、限速等待和终局引用反查。实现依赖 [SDK 的运行取消接口](https://openai.github.io/openai-agents-js/guides/running-agents/) 与底层工具的 AbortSignal。
- 停止请求与终态是两件事。活动调用尚未退出时显示“正在停止”；退出后沿用 `failed / interrupted`，Attempt 的 `error_type=UserCancellation` 区别主动停止与进程重启。已知用量正常收账，缺失仍为未知。
- 每次角色验收和最终引用验收后再次检查取消。迟到结果不能发布、推进下一个角色或写成 SUCCESS 战役记忆；已完成的终态也不能被迟来的取消覆盖。
- 关闭 HTTP 服务先禁止创建新 Run，再取消和等待已有执行退出。忽略 signal 的自定义执行器会继续占用名额，不能把尚在执行的工作伪装成已经释放。

## 指令冻结

- `instruction_id` 为 1–128 字符，正文去首尾空白后为 1–2000 字符；目标必须是现有五角色之一。
- 同一 Run 内，同 ID 同内容返回原回执；同 ID 不同内容拒绝。每个角色至多一条指令，目标角色一旦启动便不再接收指令。
- `startAttempt` 与 `harness.instruction_applied` 在同一 SQLite 事务内完成。正文作为冻结 `user_instruction` 进入该角色，结构化纠错沿用原值；原 question 和 Artifact 不被修改。
- 正文只保留在内部审计事件。公开快照与 SSE 暴露指令 ID、角色、应用 Attempt 和状态，不复制正文或工具参数。
- 运行提前终止或进程重启时，未消费指令写为 `discarded`；不隐式重放、不新建支线。
- 带 `science125_id` 或 `memory_arm` 的正式运行拒绝人工指令。现有预注册协议不变；交互控制不是新的实验臂。

ADR-0012 的独立 critique、候选硬闸、单次 reviewer 和 verified merge 保持原义。这里的“追加指令”不支持中断当前角色后续跑，也不把 reviewer 的反馈变成同支线 planner 改稿循环。

## 验证

`test/run-control.test.ts` 验证实际 Harness/Store/HTTP 的并发占位、停止竞态、关闭时禁止入场、指令应用、投影和记忆收尾；`test/store-instructions.test.ts` 验证持久化与幂等；`test/cancellation.test.ts` 使用真实 SDK 和本地 HTTP 证明请求中止及用量保留。

浏览器 E2E 使用生产 HTTP、Harness 和 Store，仅在确定性角色返回前加入可取消延迟，稳定复现运行中操作，不调用 LLM。覆盖追加指令后重载、应用状态、移动端停止和重载后终态。
