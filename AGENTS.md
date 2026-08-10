# luup Agent App

Luup 使用 Python OpenAI Agents SDK，通过百炼的 OpenAI-compatible Responses 端点驱动 Qwen。
Agent 代码位于 `backend/app/agent/`（model/specialists/prompts 在伞顶，`harness/` 是循环
引擎与确定性验收，`tools/` 是模型可见能力）；模型接线唯一事实源是
`backend/app/agent/model.py`。修改模型或 Agent 前先查
<https://openai.github.io/openai-agents-python/>，不得回退到默认 OpenAI 客户端。

## 仓库布局

- `backend/`：FastAPI、Python Harness、领域契约、工具、离线评估和测试。
- `frontend/`：Vite/React 交付面；HTTP 契约由 `backend/openapi.json` 生成。
- `runs/`：运行中 append-only、终态后不可变的证据与工件；属于事实数据，不是缓存。
- `memory/`：跨 run 的战役记忆，属于事实数据。
- `docs/`：产品契约、架构、判据、赛题与报告材料。

## 验证

```sh
cd backend
UV_CACHE_DIR=.cache/uv uv run pytest -q --cov=app --cov-fail-under=85
UV_CACHE_DIR=.cache/uv uv run ruff check app tests scripts
UV_CACHE_DIR=.cache/uv uv run ty check app scripts

cd ../frontend
pnpm check:client   # 导出 openapi + 重新生成 client，diff 非空即失败
pnpm lint           # biome，会自动写回格式
pnpm build          # tsc --noEmit + vite，产物进 backend/app/frontend（不入库）
pnpm test:e2e       # Playwright E2E，须先 build；只读已提交 runs/，零 LLM 调用
```

验收锚点：`docs/design/criteria.md`；架构：`docs/design/architecture.md`；迁移记录：
`docs/design/fastapi-template-migration.md`。

Issue 与领域文档见 `docs/agents/`。
