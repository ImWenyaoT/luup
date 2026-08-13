# luup Agent App

Luup 使用 Python OpenAI Agents SDK，通过百炼的 OpenAI-compatible Responses 端点驱动 Qwen。
Agent 代码位于 `backend/app/agent/`，平铺同 eve——harness 是运行时角色不是子目录：
`orchestrator.py`/`artifacts.py`/`verifier.py` 即 harness 本体，`tools/` 由它执行，
`model.py`/`specialists.py`/`prompts/` 是 agent 配置面；模型接线唯一事实源是
`backend/app/agent/model.py`。修改模型或 Agent 前先查
<https://openai.github.io/openai-agents-python/>，不得回退到默认 OpenAI 客户端。
`QWEN_*` / `LUUP_MODEL_ID` 由 `model.py` 的 `QwenSettings`（pydantic-settings）读取：
系统环境变量优先于仓根 `.env`，`.env` 缺席照常工作；`LUUP_REPO_ROOT` 例外，它是定位 `.env`
的前提，只能直读 `os.getenv`。

## 仓库布局

- `backend/`：FastAPI、Python Harness、领域契约、工具、离线评估和测试。
- `frontend/`：Vite/React 交付面；HTTP 契约由 `backend/openapi.json` 生成。
- `runs/`：运行中 append-only、终态后不可变的证据与工件；属于事实数据，不是缓存。
- `memory/`：跨 run 的战役记忆，属于事实数据。
- `docs/`：产品契约、架构、判据、赛题与报告材料。

## 验证

```sh
cd backend
UV_CACHE_DIR=.cache/uv uv run pytest -q --cov=app --cov-fail-under=90
UV_CACHE_DIR=.cache/uv uv run ruff check app tests scripts
UV_CACHE_DIR=.cache/uv uv run ty check app scripts

cd ../frontend
bun run check:client   # 导出 openapi + 重新生成 client，diff 非空即失败
bun run lint           # biome，会自动写回格式
bun run test           # bun test（内置，零测试依赖）；只扫 src/**/*.test.ts，见 bunfig.toml
bun run build          # tsc --noEmit + vite，产物进 backend/app/frontend（不入库）
bun run test:e2e       # Playwright E2E，须先 build；只读已提交 runs/，零 LLM 调用
```

验收锚点：`docs/design/criteria.md`；架构：`docs/design/architecture.md`；迁移记录：
`docs/design/fastapi-template-migration.md`；已定案、不再重提的决策见 `docs/adr/`。

Issue 与领域文档见 `docs/agents/`。
