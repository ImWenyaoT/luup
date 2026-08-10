# luup Agent App

Luup 使用 Python OpenAI Agents SDK，通过百炼的 OpenAI-compatible Responses 端点驱动 Qwen。
Agent 代码位于 `backend/app/harness/`；模型接线唯一事实源是
`backend/app/harness/model.py`。修改模型或 Agent 前先查
<https://openai.github.io/openai-agents-python/>，不得回退到默认 OpenAI 客户端。

## 仓库布局

- `backend/`：FastAPI、Python Harness、领域契约、工具、离线评估和测试。
- `frontend/`：Vite/React 交付面；HTTP 契约由 `backend/openapi.json` 生成。
- `runs/`：运行中 append-only、终态后不可变的证据与工件；属于事实数据，不是缓存。
- `memory/`：跨 run 的战役记忆，属于事实数据。
- `docs/`：产品契约、架构、判据、赛题与报告材料。

旧根目录 TypeScript/Next 实现仅作为迁移期 parity oracle；新 Python 真实 smoke 通过后整组删除，
不得继续向旧实现添加能力。

## 验证

```sh
cd backend
UV_CACHE_DIR=.cache/uv uv run pytest -q
UV_CACHE_DIR=.cache/uv uv run ruff check app tests scripts
UV_CACHE_DIR=.cache/uv uv run mypy app scripts

cd ../frontend
pnpm generate:client
pnpm build
```

验收锚点：`docs/design/criteria.md`；架构：`docs/design/architecture.md`；迁移停止线：
`docs/design/fastapi-template-migration.md`。

Issue 与领域文档见 `docs/agents/`。
