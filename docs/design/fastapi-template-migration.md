# 从 TypeScript 全栈迁移到 Full Stack FastAPI Template：迁移前对齐

> 状态：已于 2026-08-10 完成 cutover。真实 Qwen run `20260810-092300` 通过全部引用验收，
> 随后删除旧 Next/TypeScript 实现。本文件保留为设计与决策记录。
>
> 补记（2026-08-10，同日第二阶段）：前端骨架已对齐模板——TanStack Router 文件路由 +
> TanStack Query、Tailwind v4 + shadcn/ui、Biome；vite 构建产物写入 `backend/app/frontend`，
> 由 `app.frontend()` 单进程托管（fastapi 下界随之提到 0.141.1，目录存在才挂载）。
> 与模板的保留差异：hey-api client-fetch（非 axios）、手写 `src/types.ts`
> （后端未声明 response_model，生成类型全 unknown）、无 Playwright/CI/docker（后议）。
> 三页行为与生成客户端链路字节级不变。

日期：2026-08-10。上游快照固定为
[`fastapi/full-stack-fastapi-template@66f444a`](https://github.com/fastapi/full-stack-fastapi-template/tree/66f444a63a11ce7b4b6df6c4fbe9e15b2fa7aa3a)，
避免把持续变化的 `master` 当成稳定契约。

## 结论

可迁，但应把它视为**目录、API、测试和部署基线**，不是把模板的 SaaS 示例业务全部搬进 Luup。
对 Luup 最小且稳妥的目标是：`backend/app` 承接 Python/FastAPI Harness，`backend/tests`
承接后端测试，`frontend` 保留 React/TypeScript 并改为 Vite；前后端通过 OpenAPI 生成客户端。

真正需要先拍板的不是 FastAPI，而是下面四个所有权边界。以下决定已于
2026-08-10 确认，不再作为开放问题：

1. Agent Harness 与后端一并迁到 Python `openai-agents`；
2. `runs/`、`memory/` 与工件链继续以文件为权威，当前不引入数据库；
3. HTTP 只负责接纳和查询，独立 Python 子进程拥有一次长任务；
4. 删除用户、JWT、邮件、SQL CRUD、Docker 与部署示例。

## 上游当前提供什么

| 层 | 官方基线 | 对 Luup 的含义 |
|---|---|---|
| 后端 | Python 3.14、FastAPI、Pydantic、SQLModel、PostgreSQL、Alembic、uv；pytest、mypy、ty、Ruff | 依赖与检查项见 [`backend/pyproject.toml`](https://github.com/fastapi/full-stack-fastapi-template/blob/66f444a63a11ce7b4b6df6c4fbe9e15b2fa7aa3a/backend/pyproject.toml)。Python 3.14 是当前模板选择，不应未经依赖验证直接变成 Luup 的要求。 |
| 前端 | React 19、TypeScript、Vite 8、TanStack Router/Query、Tailwind、shadcn/ui、Playwright、Biome；当前推荐 Bun | 依赖与命令见 [`frontend/package.json`](https://github.com/fastapi/full-stack-fastapi-template/blob/66f444a63a11ce7b4b6df6c4fbe9e15b2fa7aa3a/frontend/package.json) 和 [`frontend/README.md`](https://github.com/fastapi/full-stack-fastapi-template/blob/66f444a63a11ce7b4b6df6c4fbe9e15b2fa7aa3a/frontend/README.md)。Luup 已于 2026-08-12 从 pnpm 切到 Bun，与上游包管理器一致；脚本集仍是 Luup 自有的一套。 |
| 契约 | FastAPI 导出 OpenAPI，`@hey-api/openapi-ts` 生成并提交前端 client | 官方脚本先导出 schema，再生成 client 并 lint；后端接口变化后必须再生成，见 [`scripts/generate-client.sh`](https://github.com/fastapi/full-stack-fastapi-template/blob/66f444a63a11ce7b4b6df6c4fbe9e15b2fa7aa3a/scripts/generate-client.sh)。 |
| 运行 | Docker Compose 包含 Postgres、prestart migration、backend、Adminer；开发覆盖层另加 Traefik、Mailcatcher、Playwright | 这是一套完整 SaaS/部署基线，不是 FastAPI 本身的硬依赖，见 [`compose.yml`](https://github.com/fastapi/full-stack-fastapi-template/blob/66f444a63a11ce7b4b6df6c4fbe9e15b2fa7aa3a/compose.yml) 与 [`compose.override.yml`](https://github.com/fastapi/full-stack-fastapi-template/blob/66f444a63a11ce7b4b6df6c4fbe9e15b2fa7aa3a/compose.override.yml)。 |
| CI | 后端以 uv 运行迁移、pytest/coverage，覆盖率门槛 90%；另有 Playwright、Compose 与 pre-commit 工作流 | 不应照抄门槛；先把 Luup 现有可观察行为迁成测试，再决定覆盖率目标。官方后端流程见 [`test-backend.yml`](https://github.com/fastapi/full-stack-fastapi-template/blob/66f444a63a11ce7b4b6df6c4fbe9e15b2fa7aa3a/.github/workflows/test-backend.yml)。 |

## 必须提前对齐的决定

### 1. 迁移边界：Web 壳与 Agent Harness 一起迁

Luup 当时的模型、tools、编排、验收、批处理都在 TypeScript。只换 Next.js API 为 FastAPI
会形成 Python API + Node Agent worker 两套后端，违背“减少系统表面积”的迁移动机。
确定边界为：前端继续 TypeScript，后端和 Agent Harness 一次迁到 Python；最终删除 Node 后端。

Python Agents SDK 同样提供 agent loop、function tools、agents-as-tools/handoffs、sessions 和 tracing，
且默认使用 Responses API；OpenAI-compatible provider 可注入 `base_url` 与 `api_key`。但这只说明能力存在，
**不证明百炼兼容行为与 JS 版逐项相同**，必须做最小探针验证 Responses、结构化输出、tool calling、usage
和错误映射。来源：[`openai-agents-python` 概览](https://openai.github.io/openai-agents-python/)、
[`Models`](https://openai.github.io/openai-agents-python/models/)、
[`Configuration`](https://openai.github.io/openai-agents-python/config/)。

### 2. 文件是当前唯一权威；数据库不是迁移组成部分

模板默认把用户/Item 放进 PostgreSQL，并用 SQLModel + Alembic 管迁移；Luup 的验收证据却天然是
`runs/<id>/`、verdict、usage、文献卡和 proposal 文件。建议首阶段保持：

- 文件系统是科研工件和审计证据的 source of truth；
- 当前不引入数据库；若以后出现真实需求，只在 SQLite、PostgreSQL、MongoDB 三者中按数据形态选择；
- 如果以后引入 DB，只存运行索引/任务状态，文件路径和内容 hash 指向不可变工件，不复制第二份业务真相。

这也意味着模板中的 SQLModel、Alembic、Postgres、Adminer、示例 Item CRUD 可先删除，而 FastAPI、Pydantic、
配置、测试目录与 OpenAPI client 保留。模板官方也明确前端可整块移除，说明它本来就是可裁剪起点，
见 [`frontend/README.md#removing-the-frontend`](https://github.com/fastapi/full-stack-fastapi-template/blob/66f444a63a11ce7b4b6df6c4fbe9e15b2fa7aa3a/frontend/README.md#removing-the-frontend)。

### 3. 长任务协议：接纳进程与执行进程分离

Luup 单次 pipeline 远长于普通 HTTP 请求。迁移前应冻结 API 语义，而非先选任务队列：

```text
POST /api/runs -> 立即返回 runId + working
GET  /api/runs/{runId} -> working | passed | failed + 可用工件
```

首阶段不引入 Celery、Redis、消息队列或数据库任务表，也不让长任务依附请求生命周期：

1. FastAPI 校验输入、获取全局单并发锁、创建 `runs/<id>/`；
2. 启动一个独立 Python 子进程，并立即返回 `202 + runId`；
3. 子进程独占该 run，按原子写入方式产出工件，成功或失败都落盘；
4. 查询端点只从锁与工件派生 `working | passed | failed`。

这不是“后台任务框架”，而是保留当前 one-shot runner 的最小进程边界。HTTP 断开不等于 Agent
失败；FastAPI 重启后仍可从文件判断旧 run。只有多机或多任务并发成为真实需求后，才重新评估队列。

### 4. 身份、邮件与部署拓扑

模板默认带 JWT、密码哈希、注册/找回密码、首个超级用户、SMTP/Mailcatcher、Sentry、Traefik 与 HTTPS。
这些能力可从 [`README`](https://github.com/fastapi/full-stack-fastapi-template/blob/66f444a63a11ce7b4b6df6c4fbe9e15b2fa7aa3a/README.md)
和 [`config.py`](https://github.com/fastapi/full-stack-fastapi-template/blob/66f444a63a11ce7b4b6df6c4fbe9e15b2fa7aa3a/backend/app/core/config.py)
核对。它们对当前比赛演示并非自然需求；无明确多人访问与公网部署要求时应裁掉，避免新增密钥、数据表、
迁移和安全维护面。

## Luup 的建议保留 / 替换 / 裁剪

| 动作 | 内容 |
|---|---|
| 保留 | `docs/`、`runs/`、`memory/`、Science-125、Proposal Schema 语义、B1–B4 引用核验、预算/锁/失败诚实、现有 E2E 用户路径 |
| 替换 | Next.js App/API → Vite React + FastAPI；Zod 后端边界 → Pydantic；手写前后端类型连接 → OpenAPI 生成 client；Node scripts → Python CLI/服务层 |
| 删除/不引入 | Docker/Compose、PostgreSQL/SQLModel/Alembic、JWT 用户体系、邮件、Sentry、Traefik、Adminer、生产 CD |
| 禁止隐式改变 | 状态机 `working → passed | failed`、工件文件名与目录、CLI 输入输出、Qwen/百炼 Responses 接线、现有可验证失败语义 |

## 同步落地的 Luup Pro 约束

本次迁移不是逐行翻译 TypeScript，而是把已经验证有价值的 Pro 约束迁入唯一 Python Harness：

- 固定拓扑：`Scientist → Reviewer → 最多一次定向返修 → deterministic verifier`；
- Master 不再是 LLM Agent；Harness 用普通 Python 控制流调度两个 specialist；
- Scientist 最多两个检索意图；每个意图只有一次正常请求和一次瞬时错误恢复；
- arXiv 全进程串行、至少三秒间隔、同一 run 内规范化 query 去重；
- 模型默认串行，只对明确瞬时错误做有限退避；
- 工件写入采用临时文件 + 原子替换，同一逻辑步骤只有一次有效副作用；
- Reviewer 返修只携带上一版方案和 `requiredChanges`，不得重新从零探索；
- 超预算、结构错误、引用失败或进程异常都诚实写 `FAILED.md`，不进入人工续跑；
- rubric 不进入 Agent prompt；确定性 gate 与自动评估继续分权（迁移当时写的是 M9/M10/M11；**M9/M10 已于 2026-08-11 退役且不重建**，评估链里已无 judge，A1/A2 改由 schema 必填 + 维护者人工终审核验，代价是方案实质性质量失去自动化覆盖，只剩引用真实性 B1–B4 有。裁决见 [criteria.md](criteria.md) H 节）；
- 文件 memory 继续作为可删除、可做消融实验的能力，不引入向量数据库。

“Pro”在这里表示更少的运行时机制、更硬的确定性边界，不表示增加一个通用工作流框架。

## 实际迁移顺序与停止线

1. **冻结契约**：把现有 API、CLI、工件目录、状态与错误码写成 characterization tests。
2. **做 Python Agent 探针**：只验证百炼 Responses、tool call、结构化输出、usage 和错误；任一关键项不等价即暂停全迁。
3. **迁核心而不迁 UI**：先让 Python CLI 对同一 fixture 产出并通过现有 deterministic verifier。
4. **接 FastAPI**：只实现 runs 列表、创建、详情和 Science-125 四类核心端点。
5. **生成前端 client，再迁 Vite 页面**：以真实浏览器回归选题、启动、查看结果和诚实失败。
6. **最后删除旧 TypeScript backend**：Python 路径、离线检查、真实界面与 Qwen smoke 均通过后删除；实际执行遵守了该停止线。

首个可验收里程碑应是：同一 Science 问题经 Python CLI/FastAPI 运行后，产物 schema、引用核验、终态、
usage 与现有系统等价；不是“模板已能启动”。
