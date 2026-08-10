# Luup 架构

## 一句话

Luup 是一个文件事实源的科研 Agent 应用：普通 Python Harness 串行调度 Scientist 与 Reviewer，
最多允许一次定向返修，最后由确定性 verifier 决定能否交付。

```text
Vite UI → FastAPI adapter → Python CLI / Harness
                              ├─ Scientist + Tools
                              ├─ Reviewer + independent arXiv search
                              └─ deterministic Verify
                                           ↓
                                  runs/<id>/ artifacts
```

## 模块与 seam

### Harness

外部 interface 只有“给定问题和 run 目录，返回 passed/failed”。实现内部拥有：

- Agent 与模型接线；
- arXiv 串行节流、失败重试、query 去重和检索预算；
- Scientist/Reviewer handoff 与最多一次返修；
- usage、trace、tool event、失败证据落盘；
- 确定性引用验收。

代码：`backend/app/agent/`，平铺同 eve——harness 是运行时角色不是子目录：
`orchestrator.py`/`artifacts.py`/`verifier.py`（零 LLM）即 harness 本体，`tools/` 由它执行，
`model.py`/`specialists.py`/`prompts/` 是 agent 配置面。参照 eve 的 agent-目录与
default-harness 语义（eve 也没有 harness/ 目录，harness 是引擎）。

### HTTP adapter

FastAPI 只做输入防护、单写锁、子进程启动和只读工件投影。它不拥有第二套业务状态；
`runs/` 才是事实源。公开状态固定为 `working → passed | failed`。

代码：`backend/app/main.py`、`backend/app/api/`、`backend/app/services/`。

### Web adapter

Vite/React 只通过 HTTP 读取 Science-125、run 列表、详情、状态和工件。前端不得直接推断文件状态；
后端 OpenAPI 快照生成 `frontend/src/client/`。

代码：`frontend/`。

## Agent 流程

1. Scientist 最多提出两个新 arXiv 检索意图，保存 run-local paper cards，输出 Evidence 与 Proposal。
2. Reviewer 必须检索到 Scientist 未见的新文献；空结果、缓存复用或请求失败都不能满足该条件。
3. Reviewer `pass` 时直接验收；`revise` 时 Harness 只允许 Scientist 按明确修改项返修一次。
4. Verifier 以 run-local 权威卡检查 B1–B4；任何无法证明的引用事实均 fail-closed。
5. 所有阶段写 trace/tool-events；失败写 `FAILED.md`，成功写 proposal 与 verification report。

## 存储裁决

- `runs/`：每次执行的证据链和最终工件，必须保留。
- `memory/`：跨 run 的线索库，必须保留；不能替代本 run 引用核验。
- `backend/app/data/science125.json`：冻结的 125 题输入源。
- 数据库：当前不需要。未来只有在文件 interface 无法满足真实查询/并发需求时，才在 SQLite、PostgreSQL、MongoDB 中选择。
- `.active.json`、索引、缓存、依赖和构建目录：均为可重建派生物，不提交。

## 运行与并发

`POST /api/runs` 只预留目录并立即返回 run id；CLI 子进程完成实际工作。`runs/.active.json`
以跨进程 O_EXCL 锁保证单写者。锁的首次发布和后续更新都 fail-closed，读取状态必须验证 PID 存活。

## 评估

`backend/app/evaluation.py` 只读已有工件，全部是纯函数：版本择优链 gate → refs → token → run id
（M9/M10 已于 2026-08-11 退役，见 `criteria.md` H 节）；Tier1 聚合 M4/M5/M7/M8 与失败分类分组；
M11 出 `firstVsLatest` 与 `memoryArms` 两种 McNemar 精确配对。评估不调用模型或网络。

`backend/app/batch.py` 是 125 题的交付载具：按题号串行调用 `cli.run_cli` 这一个组合根，
已有终态 passed 的题跳过，单题异常记录后继续。

验收细则见 `criteria.md`，迁移设计与完成记录见 `fastapi-template-migration.md`。
