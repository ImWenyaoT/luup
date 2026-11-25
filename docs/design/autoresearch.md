# Autoresearch 产品与架构

> 配套 ADR-0013 / ADR-0015。赛题结束后的主产品契约；Science-125 流水线见历史
> `architecture.md` / `product-contract.md`，标为 legacy。

## 一句话

Luup Autoresearch 是一个**森林语义**的研究 OS：`ResearchEngine` 拥有 Ticket /
Assignment / Decision；工人 Session 隔离提出证据与批判；Assessor 硬闸后才交付。
UI 用 AI SDK 流式呈现。形制学 dsh / dsh-superagent（搬形制不搬体量）。

## 用户故事

1. 研究者输入一个开放科研问题（不限于 science125 题库）。
2. Engine 开 Ticket，串行派出 literature / web / critic Assignment（各独占 Session）。
3. Critic 默认真错；Assessor 只看冻结证据 + critique，不问模型「过不过」。
4. 仅 Decision=`verified` 的结论进入交付；失败与拒收留 Session log。
5. UI 实时展示 Engine 事件与最终报告。

## 控制流（宿主拥有）

```text
question
  → ResearchEngine.open Ticket + main Session
  → WorkerExecutor：literature / web Assignment（冻结证据）
  → WorkerExecutor：critic Assignment（独立 Session）
  → ForestAssessor → Decision（verified | fail_closed）
  → 仅 verified merge 交付文本
```

上界写在代码里（示例默认值，可配置）：

- 文献检索轮次 ≤ 3
- 网页浏览步数（agent-browser 命令）≤ 20 / 任务
- Critic 否决后**不得**同支线改到过；只允许新开 Ticket / Assignment

## 技术分层

| 层 | 落点 |
| --- | --- |
| Provider seam | `apps/server/src/seams/providers.ts` |
| Runtime 组合根 | `apps/server/src/autoresearch/runtime.ts` |
| Engine / Assessor / Executor | `autoresearch/engine/`、`executor/` |
| Session log + deriveMessages | `autoresearch/session/` |
| 流式 HTTP | `POST /api/autoresearch/chat` → Engine Decision 后的 UI message stream |
| UI | `apps/web`：Astryx `LuupShell`（shell-nav 形制）+ Mill 面板 + `@ai-sdk/react` |
| Design system | `@astryxdesign/core` + `theme-neutral`；模板参考 `apps/web/astryx-templates/` |
| 连续战役 | `ResearchMill`（ADR-0016）：Agenda → Ticket 流水 → Paper → 产量门 |
| Paper 落盘 | `outputs/papers/<id>.md`（`createFsPaperStore`） |
| Desktop | `apps/desktop` Electron 壳（ADR-0014），默认开 `/autoresearch` |
| Legacy Science-125 | `/legacy` + `harness.ts` / `POST /api/runs`；`/` 重定向到 Autoresearch |
| Legacy thin ToolLoopAgent 编排 | `orchestrator.ts`（deprecated；对照测试用） |

## Provider

`LUUP_PROVIDER` ∈ `openai | deepseek | openai-compatible`。
模型工厂只从 seam 读环境变量 / 进程内覆盖；别处不碰密钥。
`ToolLoopAgent` / `generateText` 只做工人执行器适配，不充当编排 OS。

## 与森林理论的对齐

- Propose ≠ Select：工人 Report 只进入 Ticket 冻结面，不单独决定交付
- Critique 独立：Critic Session 只拿冻结证据，看不到「想过关」提示
- Merge 极窄：只有 Assessor Decision=`verified` 进入最终报告
