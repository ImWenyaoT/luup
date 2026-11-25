# ADR-0013 · Autoresearch：AI SDK 多 Provider 多 Agent 重写

## 状态

已接受，2026-11-25。产品从赛题交付切到可持续的 autoresearch-agent。

## 背景

Luup 原目标是挑战杯 XH-202619（Science-125）交付。赛题已结束且无后续，
`QWEN_*` / `@openai/agents` 的「百炼 Responses 单供应商」接线不再是约束。

同时保留仍成立的内核（ADR-0012 森林语义）：

- 默认真错 → 独立 critique → 硬闸 → 仅 verified merge
- Harness 拥有控制流与上界；角色产出默认不信任
- 审计账本 ≠ 可注入 KB；零 LLM 的确定性验收门仍可复用

需要换掉的是：**编排 SDK、模型供应商独占、以及产品面（从 125 题流水线 → 开放式自动科研）**。

## 决定

### 1. 产品主轴 = Autoresearch Agent

主交付物改为「给定科研问题，多 agent 自动检索 / 综合 / 批判 / 产出可引用研究报告」。
Science-125 五角色批跑降为 **legacy**（代码可留、默认入口不再是它）；新功能与文档以
autoresearch 为准。

### 2. 编排与 UI 栈 = Vercel AI SDK

| 层 | 选型 | 不选 |
| --- | --- | --- |
| 模型调用 / Agent 循环 | `ai` 的 `ToolLoopAgent` + `tool()` | `@openai/agents` |
| 结构化输出 | `generateText` + `Output.object` | Agents SDK `outputType` |
| 前端流式 | `@ai-sdk/react` 的 `useChat` + `toUIMessageStreamResponse` | 手写 SSE 投影（legacy 可并存） |
| 浏览器工具 | `agent-browser` CLI 封装为 tool / 专用 subagent | Playwright 内嵌驱动作为默认 |

换 SDK 不等于放弃 Harness：确定性阶段顺序、补证上界、critique 硬闸仍由宿主代码拥有；
`ToolLoopAgent` 只负责单角色内的 tool loop，不接管森林控制流。

### 3. 多 Provider Responses 接线（唯一 seam）

`apps/server/src/seams/providers.ts`（及既有 `seams/model.ts` 的演进）是**唯一**读取
provider 凭据与模型 id 的点。默认支持：

- `openai` — `@ai-sdk/openai`，默认走 Responses API
- `deepseek` — `@ai-sdk/deepseek`（优先 `.responses(modelId)`；不可用时显式降级并记录）
- `openai-compatible` — `@ai-sdk/openai-compatible` / `createOpenAI({ baseURL }).chat` /
  `.responses`，用于自建或百炼等兼容端点

环境变量约定：

```text
LUUP_PROVIDER=openai|deepseek|openai-compatible
LUUP_MODEL_ID=<provider-specific model id>
OPENAI_API_KEY / DEEPSEEK_API_KEY / LUUP_API_KEY
LUUP_BASE_URL=   # 仅 openai-compatible 需要
```

废弃新路径对 `QWEN_*` 的硬依赖；legacy Science-125 路径可继续读旧变量做过渡。

### 4. Multi-agent / Sub-agent 形状

```text
Coordinator (parent ToolLoopAgent)
  ├─ literature_research  → Literature subagent（arXiv / Crossref）
  ├─ web_research         → Web subagent（agent-browser + 开放网页）
  └─ critique             → Critic subagent（默认真错、独立压力测试）
Harness 硬闸：critique 否决不得 merge；无合格证据 fail-closed
```

- Subagent 经 parent 的 `tool({ execute })` 委派，各自独立上下文窗口
- 共享的是冻结 Artifact / 证据台账，不是隐藏对话历史（延续 handoff 纪律）
- Propose ≠ Select：综合报告前必须过 critique 门

### 5. 与 ADR-0005 宪章的关系

赛题锚（目标 = `docs/specs` 的 XH-202619）随赛题结束失效。本 ADR **修订**目标锚为：
**Autoresearch 产品契约**（`docs/design/autoresearch.md`）。理论锚（森林）与上限锚
（高质量 agent 系统参考）继续有效。所有权条款不变：宿主拥有工具、状态、预算与验证。

## 后果

正：供应商可换；UI 流式与 agent 循环同属一套协议；subagent 隔离上下文适合深度检索；
森林硬闸不被 LLM 编排吞掉。

负 / 代价：两套路径短期并存（legacy Science-125 vs autoresearch）增加维护面；
`@openai/agents` 与 AI SDK 的概念映射需在文档钉死；agent-browser 依赖本机/CI 浏览器能力。

## 验收

- 无 `QWEN_*` 时，用 `OPENAI_API_KEY` 或 `DEEPSEEK_API_KEY` 可跑通 live autoresearch
- Coordinator → literature / web / critique 委派可测（确定性 runtime 零 LLM）
- critique 否决挡 merge；无合格证据 fail-closed
- 前端 `useChat` 能消费 UI message stream
- `pnpm run ci` 绿；server/web 覆盖率地板不降
