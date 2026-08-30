# ADR-0011 · 百炼 Responses、Qwen3.8 与 pnpm 稳定线

## 状态

已接受，2026-08-30。

## 决定

- `@openai/agents` 升到 0.17.0；继续由 Agents SDK 的 `Runner`、`Agent`、tools、structured output、
  retry 和 `OpenAIProvider` 承担模型编排，不增加自造 OpenAI HTTP 层。
- `OpenAIProvider` 显式 `useResponses: true`；默认模型改为 `qwen3.8-max`，仍允许
  `LUUP_MODEL_ID` 覆盖。
- 结构化输出使用标准 `reasoning.effort=none`，删除百炼已声明将废弃的 `enable_thinking`。
- `QWEN_BASE_URL` 继续是唯一 endpoint seam。无 Workspace ID 时保留兼容域名默认值；生产应配置百炼
  业务空间专属 `/compatible-mode/v1` base URL。
- 包管理器固定 pnpm 11.24.0：这是当前 Node 24 环境已安装并能完成 frozen install 的稳定线。
  11.25 虽是 2026-08-30 上游 Latest，但本机 pnpm 启动器无法验证它的 registry 签名；pnpm 12 的
  Corepack/原生 CLI 引导同样未通过。这里取可运行、可复现的最大公约数，不提交只在纸面上更新的 pin。
- workspace 直接依赖升级到 registry 当前 stable；`@types/node` 唯一例外，固定在 24 LTS 线而不使用
  Node 26 Current 的类型。Node 运行时基线同步到 24.20.0 Latest LTS。

## 验收

- seam 测试证明字符串模型解析为 `OpenAIResponsesModel`；
- TypeScript、全量单测、覆盖率、Next build 与确定性浏览器 E2E 全绿；
- live canary 只有在显式提供付费凭据时执行，不用离线测试伪造。
