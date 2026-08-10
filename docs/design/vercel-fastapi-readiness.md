# 技术栈基线与 Vercel / FastAPI 预备边界

日期：2026-08-10。本文只记录已核对的一手资料和未来部署约束；它不代表 Luup
现在要部署 Vercel，也不引入尚无需求的云服务。

## 结论

1. **Hey API 不是 Luup 自创选型。** FastAPI 官方维护的 Full Stack FastAPI Template
   直接依赖 `@hey-api/openapi-ts`，并在官方生成脚本中先导出 FastAPI OpenAPI，再生成前端 client。
   但它是该官方模板的工程选择，不是 FastAPI 框架规定的唯一客户端生成器。
2. **TypeScript 7 已是 stable，但 Luup 现在不能升级。** 它不是 preview；官方于 2026-07-08
   发布 7.0，并称可用于生产。不过实测 `@hey-api/openapi-ts@0.99.0` 会读取 TypeScript
   programmatic API，使用 7.0.2 生成客户端时在 `ts.SyntaxKind.AnyKeyword` 崩溃。当前最大公约数
   是 TypeScript 6.0.3，等生成器支持 TS 7 后再升级。
3. **`ty` 适合现在引入为附加检查，不适合立刻替代 mypy。** Astral 官方仍把它标为 beta、
   采用 `0.0.x`，并明确诊断和行为可能在任意版本间发生 breaking change。先固定版本、与 mypy
   并行运行；待 Luup 零误报且 ty 稳定后再决定是否去掉 mypy。
4. **FastAPI 本身可零配置部署 Vercel；Luup 的当前持久化和长任务模型却不能原样搬。**
   阻力不在 ASGI，而在 `runs/`、`memory/` 的持久写入、请求返回后的子进程，以及长 Agent run。

## 当前技术栈的“最大公约数”

| 层 | 当前 / 建议基线 | 判断 |
|---|---|---|
| Python | 3.12+ | Vercel Python Runtime 当前支持 3.12、3.13、3.14，默认 3.12；继续以 3.12 为最低版本是兼容面最大的选择。 |
| Python 类型检查 | mypy 为 gate，固定版本的 ty 并行观察 | ty 很快且已可用，但仍是 beta；不能把“最新”误当成“稳定”。 |
| 前端 | React 19 + Vite 8 | 都是当前稳定主线；不为潜在部署改回 Next.js。Vite 静态产物可独立交付。 |
| TypeScript | 6.0.3 | TS 7 本身稳定，但 Hey API 0.99 实际依赖尚未提供的 programmatic API；生成链决定当前兼容下限。 |
| API 契约 | FastAPI OpenAPI → Hey API client | 沿用上游官方模板已验证的方向；生成物必须在 CI 中检查漂移。 |

### Hey API 的来源边界

上游 [`frontend/package.json`](https://github.com/fastapi/full-stack-fastapi-template/blob/master/frontend/package.json)
直接声明 `@hey-api/openapi-ts`，官方
[`scripts/generate-client.sh`](https://github.com/fastapi/full-stack-fastapi-template/blob/master/scripts/generate-client.sh)
从 FastAPI `app.openapi()` 导出 schema 后调用生成器。因此 Luup 是**继承 FastAPI 官方全栈模板的选型**，
不是自行发明。但应避免把它表述成“FastAPI 官方标准”：FastAPI 只提供 OpenAPI 契约，client
generator 仍是可替换的构建时工具。

### TypeScript 7 的采用条件

TypeScript 官方已发布 [TypeScript 7.0](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)，
它是新的 Go 原生实现。官方说明：

- 7.0 以兼容 TS 6.0 的类型检查和 CLI 行为为目标；
- 7.0 目前不提供 programmatic API，依赖该 API 的工具可与 `@typescript/typescript6` 并存；
- Vue、Svelte、Astro、Angular 等嵌入式语言场景仍可能需要 TS 6；
- TS 6 已废弃的配置在 TS 7 可能成为硬错误。

Luup 当前是 `.tsx` + Vite + `tsc --noEmit`，但 OpenAPI 生成器是上述 programmatic API
约束的真实使用者。2026-08-10 已实际将 TypeScript 6.0.3 升到 7.0.2，并执行：

```sh
cd frontend
pnpm generate:client
pnpm build
```

结果 `@hey-api/openapi-ts@0.99.0` 在读取 `ts.SyntaxKind.AnyKeyword` 时失败；回退 6.0.3 后客户端
生成和 Vite build 均恢复通过。因此不采用双 TypeScript 版本：这会为了一个尚无收益的升级增加
工具链复杂度。升级触发条件是 Hey API 宣布 TS 7 支持，并由上述两条命令再次实测。

### ty 的引入边界

[Astral ty 文档](https://docs.astral.sh/ty/)把它定义为 Rust 实现的 type checker 和 language server，
官方安装方式包含 `uv add --dev ty`。但其
[官方仓库](https://github.com/astral-sh/ty)仍明确标注 beta、`0.0.x` 且没有稳定 API。
因此首阶段应遵循：

- 在 `uv.lock` 固定版本，避免浮动到下一次 breaking diagnostic；
- `ty check` 作为附加 gate，mypy 暂时继续作为已有行为基线；
- 不为满足 ty 做降低类型安全或大范围 suppress 的改造；
- 连续稳定后再评估由 ty 替代 mypy，而不是长期维护两套同权规则。

## Vercel 对 Luup 的真实约束

```mermaid
flowchart LR
    Browser["Vite 静态前端"] --> API["Vercel FastAPI Function"]
    API --> Durable["外部持久工件存储"]
    API --> Executor["可持久执行的 Agent runner"]
    Executor --> Durable
    Durable --> API
```

图中后两项是当前 Luup 与 Vercel 之间的缺口，不能用函数本地文件或请求后的子进程冒充。

### 可以直接复用的部分

[Vercel FastAPI 官方文档](https://vercel.com/docs/frameworks/backend/fastapi)说明，平台能识别
`app.py` / `index.py` 等入口中的 `FastAPI` `app`，并把整个 FastAPI 应用打成一个 Vercel
Function；Python runtime 支持 ASGI、流式响应、`pyproject.toml` 和 `uv.lock`。当前支持 Python
3.12、3.13、3.14，且 Python bundle 的未压缩上限为 500 MB。Luup 保持一个可导入的纯
`app` 对象、把开发依赖留在 dev group、避免在 import 时启动任务，就已经保留了大部分可迁移性。

Vercel Labs 的
[`openai-agents-fastapi-starter`](https://github.com/vercel-labs/openai-agents-fastapi-starter)
也证明 OpenAI Agents SDK + FastAPI + `uv` 能直接运行于 Python Runtime；它每次请求创建独立
Sandbox，并明确提示重负载应考虑 Fluid Compute 或 Workflow。这个 starter 是部署形态参考，
不是 Luup Harness 架构的替代品，也不证明百炼 Qwen 接线可换成 Vercel AI Gateway。

### 不能直接复用的部分

根据 [Vercel Runtimes](https://vercel.com/docs/functions/runtimes) 和
[Functions Limits](https://vercel.com/docs/functions/limitations)：

- 函数文件系统只读；只有最多 500 MB 的 `/tmp` 可写临时空间；
- `/tmp` 不是跨调用、跨实例或跨部署的持久事实源；
- Python/FastAPI 应用成为单个 Function；官方稳定限制页列出 Fluid Compute 最长 300 秒
  （Hobby）或 800 秒（Pro / Enterprise），2026-06 又为 Pro / Enterprise 推出最长 1800 秒的
  beta；无论取哪档都不是无限长任务，超时会返回 `504 FUNCTION_INVOCATION_TIMEOUT`；
- 请求和响应 payload 各自最多 4.5 MB；
- FastAPI shutdown 收到 SIGTERM 后只有约 500 ms 清理时间。

因此当前设计中的以下假设在 Vercel 上不成立：

| 当前假设 | Vercel 冲突 | 未来需要的边界 |
|---|---|---|
| `runs/` 与 `memory/` 写在本地且是事实源 | 部署文件只读，`/tmp` 易失 | `ArtifactStore`：本地文件实现 + 外部持久存储实现，仍保持 append-only / immutable 语义 |
| HTTP 返回 `202` 后由本机子进程继续执行 | Function 生命周期不保证响应后子进程存活 | `RunExecutor`：本地 subprocess 实现 + durable workflow / queue / 外部 worker 实现 |
| 进程内锁保证全局单并发 | 平台会水平扩容为多个隔离实例 | 需要外部租约或幂等 run ownership；不能依赖 Python 全局变量 |
| 单次 Agent run 可任意久 | 受函数最大 duration 约束 | 短 run 可同步执行；长 run 必须拆成可恢复步骤或移到持久 worker |
| run 工件可直接作为 HTTP 大响应 | 4.5 MB payload 上限 | API 返回 metadata / signed URL，工件走对象存储 |

### 现在应做与不应做

现在只需保持以下可迁移接缝，不需要创建 Vercel 账号或配置：

1. FastAPI `app` 导入必须无副作用；启动 run 通过明确 service 接口。
2. 路径和文件读写集中在 storage boundary，领域层不硬编码部署根目录。
3. run 创建必须有幂等 ID、明确 ownership 和终态；这对本地与分布式都正确。
4. 前端只依赖公开 API base URL，不把后端与 Vite 构建强绑为同一进程。
5. 构建时排除测试、fixtures 和历史 `runs/`，避免把事实数据错误打进 500 MB Function bundle。

现在不应提前引入：`vercel.json`、Vercel Workflow、Sandbox、Blob、数据库、AI Gateway、
Fluid Compute 专用代码。它们都是部署选择，不是应用核心。只有真正决定部署且明确“工件放哪里、
长任务由谁拥有”后再选。Vercel 所说的
[framework-defined infrastructure](https://vercel.com/blog/framework-defined-infrastructure)
能根据 FastAPI/Vite 结构推导部署资源，但不会自动解决 Luup 的持久事实源和跨请求执行语义。

## 未来部署验收线

只有下面条件同时满足，才能声称 Luup 可部署到 Vercel：

1. Preview deployment 能启动 FastAPI，OpenAPI client 指向该 Preview URL；
2. run 在不同 Function 实例间仍可查询，冷启动或重新部署不会丢工件；
3. 请求返回后 run 能走到 `passed | failed`，且执行不依赖原 Function 继续存活；
4. 并发创建同一 run 不产生双执行或工件覆盖；
5. 超时、重试和中断后仍产生诚实终态与可审计 Evidence；
6. Python bundle、payload、duration、memory 均在平台上实测通过，而非仅本地 `vercel dev` 通过。
