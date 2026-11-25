# ADR-0015 · Autoresearch Harness 采纳 dsh / Superagent 形制

## 状态

已接受，2026-11-25。修订 ADR-0005「赛后若仍有意愿再议 dsh 全套」：赛已结束，**采纳形制、不搬体量**。

## 背景

ADR-0013 把产品切到 Autoresearch，并用 AI SDK `ToolLoopAgent` 搭了第一版 multi/sub-agent。
那一版正确的是：多 Provider、流式 UI、宿主硬闸意图。不够的是 **harness 本体**：

- 没有 append-only Session log；模型上下文不可从日志重建
- Coordinator 自己委派、自己收尾，宿主 Engine 没有成为领域唯一写者
- Critique 是 tool，不是独立 Assessor / Decision 聚合
- 与 dsh（session → deriveMessages → agent-loop）和 dsh-superagent
  （Runtime / Engine / Assessor / Executor / Effects）的最佳实践差距过大

`docs/design/dsh-borrowings.md` 里「明确不采用」的多数条目，理由是 **Science-125 体量小、
重跑便宜**。Autoresearch 是开放式、可多轮、可桌面长驻的产品——那些理由失效。

仍成立的纪律（ADR-0004/0005）：**搬形制不搬体量**。不引入 Cordis 219 包树，不把
`@deepseek-ai/dsh` 升为运行时依赖；把会话日志、Engine 单写者、主会话/工人会话、
Assessor 硬闸、Executor 启动工人，写成 luup 自己的窄实现。

## 决定

### 1. 形制映射（Superagent → Autoresearch）

| Superagent / dsh | Autoresearch |
| --- | --- |
| Runtime | `autoresearch/runtime.ts` 组合根 |
| Engine（唯一写者） | `ResearchEngine`：Question / Ticket / Assignment / Report / Decision |
| Session log + `deriveMessages` | `SessionLog`；模型历史只从日志投影 |
| Main Session | `main` 会话：编排与对人交付 |
| Worker Session | `literature` / `web` / `critic` 会话，隔离上下文 |
| Assessor + Decision | `ForestAssessor`：硬闸；否决不 merge |
| Executor + Assignment | `WorkerExecutor`：启动工人、回收 Report |
| Effects（提交后副作用） | 同步里程碑先用 in-process queue；接口预留 |

### 2. 森林语义仍由宿主拥有

Propose → Critique → Hard gate → Merge（ADR-0012）不变。
Assessor / Engine 做 Decision；模型与工人 **不能** 自行宣布 verified。

### 3. AI SDK 降为执行器适配器

`ToolLoopAgent` / `generateText` 只实现「一步模型请求 + 工具」；不再充当编排 OS。
Provider seam（ADR-0013）继续是唯一凭据读取点。

### 4. Legacy Science-125

五角色 `@openai/agents` 流水线仍可跑，不在本 ADR 强迁；新能力只进 Autoresearch Engine。

## 后果

正：可审计、可续谈、可测的 harness；与公开 dsh / superagent 文档同构，便于后续加深。

负：短期代码面扩大；第一刀 Effects/崩溃续跑仍比 dsh 浅，须在台账写明差距。

## 验收

- 一次 Autoresearch 运行产生 main + worker 的 Session 事件；`deriveMessages` 可重建工人上下文
- Engine 是 Ticket/Assignment/Report/Decision 的唯一写路径（测试可钉）
- chat 交付只认 Engine Decision；Assessor 否决不交出 draft
- 不新增 `@deepseek-ai/dsh` 运行时依赖
- `pnpm run ci` 相关门绿
