# Autoresearch 产品与架构

> 配套 ADR-0013。本文是赛题结束后的主产品契约；Science-125 流水线见历史
> `architecture.md` / `product-contract.md`，标为 legacy。

## 一句话

Luup Autoresearch 是一个**森林语义**的多 agent 自动科研系统：Coordinator 委派文献 /
网页 / 批判子代理，Harness 拥有硬闸与证据台账，UI 用 AI SDK 流式呈现。

## 用户故事

1. 研究者输入一个开放科研问题（不限于 science125 题库）。
2. 系统并行或串行派出 literature / web 子代理搜集证据。
3. Critic 子代理默认真错，对主张做压力测试。
4. 仅通过硬闸的结论进入最终研究报告；失败与拒收留审计。
5. UI 实时展示委派、工具调用与最终报告。

## 控制流（宿主拥有）

```text
question
  → Coordinator.propose（可开多条检索支线）
  → Literature / Web subagents（冻结证据 Artifact）
  → Critic.critique（独立上下文；默认真错）
  → hard gate（否决 / 无证据 → fail-closed）
  → merge 最终报告（仅 verified）
```

上界写在代码里（示例默认值，可配置）：

- 文献检索轮次 ≤ 3
- 网页浏览步数（agent-browser 命令）≤ 20 / 任务
- Critic 否决后**不得**同支线改到过；只允许新开 attempt

## 技术分层

| 层 | 落点 |
| --- | --- |
| Provider seam | `apps/server/src/seams/providers.ts` |
| Autoresearch 编排 | `apps/server/src/autoresearch/` |
| 流式 HTTP | `POST /api/autoresearch/chat` → `toUIMessageStreamResponse` |
| UI | `apps/web` + `@ai-sdk/react` `useChat` |
| Legacy Science-125 | 既有 `harness.ts` / `POST /api/runs`，默认不再作为产品入口 |

## Provider

`LUUP_PROVIDER` ∈ `openai | deepseek | openai-compatible`。
模型工厂只从 seam 读环境变量 / 进程内覆盖；别处不碰密钥。

## 与森林理论的对齐

- Propose ≠ Select：文献/网页子代理的命中与自评排名不单独决定交付
- Critique 独立：Critic 看不到 Coordinator 的「想过关」提示，只拿冻结证据
- Merge 极窄：只有过硬闸的主张进入最终报告与可选 campaign 注入面
