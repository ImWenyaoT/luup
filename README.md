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

```sh
cd backend
uv sync
export QWEN_API_KEY='your-key'
export QWEN_BASE_URL='your-openai-compatible-base-url'
UV_CACHE_DIR=.cache/uv uv run uvicorn app.main:app --host 127.0.0.1 --port 8000
```

另一终端：

```sh
cd frontend
pnpm install
pnpm generate:client
pnpm dev                    # http://127.0.0.1:5173，/api 代理到 8000
```

单进程交付（无需前端 dev server）：

```sh
cd frontend && pnpm build   # 产物写入 backend/app/frontend
# 重启 uvicorn 后，页面与 API 同端口：http://127.0.0.1:8000
```

直接跑题：

```sh
cd backend
UV_CACHE_DIR=.cache/uv uv run python -m app.cli --question "<科学问题>"
```

## 验证

```sh
cd backend
UV_CACHE_DIR=.cache/uv uv run pytest -q
UV_CACHE_DIR=.cache/uv uv run ruff check app tests scripts
UV_CACHE_DIR=.cache/uv uv run ty check app scripts
UV_CACHE_DIR=.cache/uv uv run mypy app scripts
UV_CACHE_DIR=.cache/uv uv run python -m app.evaluation --runs-root ../runs

cd ../frontend
pnpm check:client   # client 漂移门禁
pnpm lint           # biome
pnpm build
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
- 迁移设计与完成记录：`docs/design/fastapi-template-migration.md`
- Python 目录与依赖边界：`docs/design/python-project-structure.md`
- Vercel/FastAPI 部署兼容性：`docs/design/vercel-fastapi-readiness.md`
- 赛题原文：`docs/specs/`
