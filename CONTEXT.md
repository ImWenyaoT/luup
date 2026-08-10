# luup 领域词汇

| 术语 | 含义 | 代码锚点 |
|------|------|---------|
| **run** | 一次 `question → Scientist → Reviewer → 最多一次定向返修 → Verify` 的执行；全部事实落在 `runs/<id>/` | `backend/app/agent/harness/orchestrator.py` |
| **Harness** | 普通 Python 确定性调度器（循环引擎）；拥有工具执行、预算、状态、证据和验证，不是另一个 LLM Agent | `backend/app/agent/harness/` |
| **Scientist** | 检索 run-local 证据并提交结构化研究计划；单次最多两个新检索意图 | `backend/app/agent/specialists.py` |
| **Reviewer** | 必须独立检索到 Scientist 未见的新信息，再给出 `pass` 或具体返修项 | `backend/app/agent/tools/runtime.py` |
| **工件（artifact）** | Agent 输出、工具事件、trace、proposal、review、verification 与失败证据 | `backend/app/agent/harness/artifacts.py` |
| **handoff** | Scientist 输出、Reviewer 输入输出和返修请求的显式文件传递；角色不共享隐藏上下文 | `trace.jsonl`、`tool-events.jsonl` |
| **独立验收** | 零 LLM 的确定性契约与引用真实性检查；失败必须 fail-closed；模型不可见，归 harness | `backend/app/agent/harness/verifier.py` |
| **run outcome** | 对外只有 `working → passed | failed`；内部 phase 不扩大 HTTP 契约 | `backend/app/services/runs.py` |
| **单写者假设** | `runs/.active.json` 的跨进程锁保证同时最多一个可变 run | `backend/app/services/launch.py` |
| **战役记忆** | 根 `memory/`；只提供线索，引用仍必须在本 run 重新经 arXiv 核验并落盘 | `backend/app/agent/tools/memory.py` |
| **离线评估** | 从既有工件复算 gate、版本选择、M9/M10 授权与 McNemar 配对比较，不调用模型 | `backend/app/evaluation.py` |
| **HTTP adapter** | FastAPI 暴露运行接口；Vite 只消费 HTTP，不直接读取 Python 模块 | `backend/app/main.py` |
