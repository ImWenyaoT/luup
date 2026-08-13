# luup

面向《Science》125 前沿科学问题的科研 Agent：Scientist 检索证据并形成研究计划，Reviewer 通过独立检索审稿，
Harness 最多允许一次定向返修，最后由确定性 verifier 决定是否交付。

赛题：挑战杯揭榜挂帅 XH-202619，赛道一·方向一·维度 A。

## 设计边界

- `Agent = Model + Harness`；Tools、状态、预算、Evidence 与确定性验证由 Harness 拥有。
- 普通 Python 调度，不使用 LLM Master、Eve、数据库或 durable workflow 框架。
- `runs/` 与 `memory/` 是文件事实源；PostgreSQL、SQLite、MongoDB 只有出现真实需求时才考虑。
- 公开运行状态固定为 `working → passed | failed`。
- Reviewer 必须检索到 Scientist 未见的新信息；无法证明即失败。

## 仓库

```text
backend/   FastAPI、Python Harness、工具、契约、评估与测试
frontend/  Vite/React 交付面与 OpenAPI 生成客户端
docs/      产品契约、架构、验收标准、赛题和报告材料
runs/      运行中 append-only、终态后不可变的证据链与工件（事实数据）
memory/    跨 run 的战役记忆（事实数据）
```

## 本地运行

凭据二选一。写进仓根 `.env`（自动读取，无需 export；路径按仓根解析，与 cwd 无关）：

```sh
cp .env.example .env   # 填 QWEN_API_KEY / QWEN_BASE_URL
```

或直接 export 系统环境变量——同名时**系统环境变量优先**，`.env` 只是兜底：

```sh
export QWEN_API_KEY='your-key'
export QWEN_BASE_URL='your-openai-compatible-base-url'
```

起服务：

```sh
cd backend
uv sync
UV_CACHE_DIR=.cache/uv uv run uvicorn app.main:app --host 127.0.0.1 --port 8000
```

另一终端：

```sh
cd frontend
bun install
bun run generate:client
bun run dev                    # http://127.0.0.1:5173，/api 代理到 8000
```

单进程交付（无需前端 dev server）：**必须先 build 再起 uvicorn**——进程只在启动时检查
`backend/app/frontend` 是否存在，先起服务后构建的话 `/` 一直 404，得重启一次（`/api` 不受影响）。

```sh
cd frontend && bun run build   # 产物写入 backend/app/frontend
cd ../backend && UV_CACHE_DIR=.cache/uv uv run uvicorn app.main:app --port 8000
# 页面与 API 同端口：http://127.0.0.1:8000
```

直接跑题：

```sh
cd backend
UV_CACHE_DIR=.cache/uv uv run python -m app.cli --question "<科学问题>"
```

批量跑 Science-125（串行、断点续跑：已有终态 passed 的题自动跳过）：

```sh
cd backend
UV_CACHE_DIR=.cache/uv uv run python -m app.batch --ids 1-125 --dry-run   # 先看计划，零执行
UV_CACHE_DIR=.cache/uv uv run python -m app.batch --ids 3,54,61
```

## 验证

```sh
cd backend
UV_CACHE_DIR=.cache/uv uv run pytest -q --cov=app --cov-fail-under=90
UV_CACHE_DIR=.cache/uv uv run ruff check app tests scripts
UV_CACHE_DIR=.cache/uv uv run ty check app scripts
UV_CACHE_DIR=.cache/uv uv run python -m app.evaluation --runs-root ../runs

cd ../frontend
bun run check:client   # client 漂移门禁
bun run lint           # biome
bun run build
bun run test:e2e       # Playwright 打真实单进程交付形态；首次先 bunx playwright install chromium
```

## 运行工件

每个 `runs/<id>/` 至少可能包含：

- `question.md`、`meta.json`、`exit.json`
- `evidence.md`、`proposal.json`、`proposal.md`
- `review.json`、`verification.json`、`verification-report.md`
- `trace.jsonl`、`tool-events.jsonl`、`usage.jsonl`
- `memory/papers/`、`memory/index.md`
- `FAILED.md`（失败时必须存在）

引用只允许使用本 run 已经 arXiv 实检并落盘的 paper card；标题、作者、第一作者与数量由代码 fail-closed 验证。

## 文档

- 产品契约：`docs/design/product-contract.md`
- 当前架构：`docs/design/architecture.md`
- 验收标准：`docs/design/criteria.md`
- 已定案决策：`docs/adr/`
- 赛题原文：`docs/specs/`
