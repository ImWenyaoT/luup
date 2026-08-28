# apps/web 需求（C2a · G2 最小）

> 权威来源：`docs/design/criteria.md` G2、`docs/design/product-contract.md`。  
> 约束：**Mode A** — server HTTP/SSE 契约不变；前端只消费公开投影。

## G2 三路径

| 路径         | 用户故事                                              | 验收标准                                                                                                                                                                            |
| ------------ | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **选题**     | 作为评审，我从 Science 125 或自由输入选定一道研究问题 | 侧边栏加载 `/api/science125`；支持域筛选、搜索、随机选题；选中后填入输入框或直接开跑                                                                                                |
| **触发运行** | 作为用户，我提交问题并等待 Harness 推进               | `POST /api/runs` 返回 run id；URL 写入 `?run=<id>`；SSE 订阅 13 种核心事件并 refetch snapshot；终态为 `completed \| review_rejected \| failed`                                      |
| **查看结果** | 作为评审，我查看执行轨迹与最终研究计划                | 主画布展示 5 角色进度与终态摘要；Process / Artifact 通过同一 Inspector 按需展开；artifact 正文来自 `GET /api/artifacts/:id`；终态展示引用验收摘要（`verification.references` 事件） |

## 用户故事（补充）

| ID    | 故事                                | 验收                                                                         |
| ----- | ----------------------------------- | ---------------------------------------------------------------------------- |
| US-01 | 刷新或分享 `?run=` 链接后恢复工作台 | reload 后从 URL 拉 snapshot，SSE 从 `version` 续读                           |
| US-02 | live 模式下配置 Qwen 凭据           | 设置面板 `GET/PUT /api/config`；key 不回显；保存后状态行更新                 |
| US-03 | Reviewer 首轮运行中提交人工反馈     | `POST /api/runs/:id/feedback`；409 时展示明确错误，不静默丢弃                |
| US-04 | API 临时失败时不丢失当前 run        | 轮询/SSE 触发 refetch 带退避；错误 banner 可 dismiss；已有 snapshot 不被清空 |

## 测试先行

- **契约层**：`lib/api/`、`lib/sse/`、`lib/types/` 单元测试 ≥90% functions/lines（Vitest）。
- **集成层**：hooks 用 MSW/fetch mock 测 Query+SSE bridge 状态机。
- **E2E**：保留 `workspace.spec.ts` 语义（deterministic run 全流程、刷新恢复、错误隔离、无效输入）。
- **回归锚**：wire type 与 `apps/server/src/api/projection.ts` 字段对齐；变更须同步更新 `lib/types/` 与契约测试。

## Web Shell 基线

- 左侧项目树稳定承载 Science 125 题库、搜索和本机 Runs；水平 tabs 是浏览器本机 working set，并与 `?run=` 同步。
- Inspector 采用渐进披露：视口 `>=1200px` 时作为 `332px` 证据坞与主画布并排；中等视口覆盖主画布；移动视口使用全宽 modal drawer。
- 提供响应式布局、清晰焦点态和 tabs 键盘导航基线；这不等于原生移动应用或完整无障碍认证。

## 明确不做（G2 边界外）

- 原生移动应用、完整无障碍专项认证、WebSocket 替代 SSE
- 批跑 UI、125 题进度大盘、metrics 报表
- `/api/artifacts/:id/markdown` 专用视图（可后续加，非 MVP）
- import `apps/server/**` 或共享 server zod schema
- 演示视频、部署向导、多租户
