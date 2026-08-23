# Luup 架构

> 2026-08-15 随 ADR-0004 改写为 TypeScript 栈的现实。此前版本描述的 FastAPI / `runs/<id>/` 目录制
> 已随 Python 栈退役，只存于 git 历史。仍成立的裁决（存储边界、单写者、评估只读、公开状态收窄）
> 逐条保留在下面，换了落点但没换主张。

## 一句话

Luup 是一个确定性 Harness 编排五个 LLM 角色的科研 Agent：固定五阶段串行，两条上界写死在控制流里，
最后由不问模型的 verifier 决定能否交付。

```text
apps/web (Vite/React)
        ↓ HTTP + SSE
apps/server/src/server.ts ── apps/server/src/harness.ts ── researcher
   （同进程）          │            ├─ hypothesis-generation
                      │            ├─ evidence-review
                      │            ├─ research-plan
                      │            └─ reviewer
                      ├─ apps/server/src/agent/tools/  arXiv + Crossref 检索
                      ├─ apps/server/src/verify/       B1–B4 确定性引用验收（零 LLM）
                      └─ apps/server/src/store/        node:sqlite 单文件事实存储
```

## 模块与 seam

### Harness

外部 interface 只有「给定 run id，推进到终态」。`apps/server/src/harness.ts` 拥有：

- 五阶段顺序与两条上界：补证 ≤2 轮、修订 ≤2 轮，写成能一眼读完的 `for` 循环；
- 每个 Attempt 的证据台账、用量、事件与失败分类落库；
- 终局引用验收的触发。

**顺序不由数据决定。** 这里曾把「下一个角色是谁」交给任务依赖图算；改回显式控制流，
是因为 luup 的主张就是「格子之间怎么走由代码决定」，上界要能被人和评委一眼看见。
store 只记账，不参与决定顺序。

角色的合同与提示词在 `apps/server/src/agent/roles/`（每个角色一对 `.ts` + `.md`），
结构化输出的形状在 `roles/structured-output.ts`。harness 是运行时角色，不是子目录。

### seam

可替换的东西全在 `apps/server/src/seams/index.ts` 点名，只有类型与一个工厂——每个接缝目前只有
一个生产实现加一个离线替身，两个实现撑不起注册表或容器。四个接缝：

| 接缝                          | 生产实现                    | 换实现的约定                                                                |
| ----------------------------- | --------------------------- | --------------------------------------------------------------------------- |
| 模型接线 `seams/model.ts`     | `qwenModelProvider()`       | `QWEN_*` / `LUUP_MODEL_ID` 的唯一读取点；缺凭据抛 `missing_credential`      |
| 验收器 `Verifier`             | `createReferenceVerifier()` | 不问模型；反查不通标 `infraError`，不扣造假帽子                             |
| Run 记账面 `RunStore`         | `SqliteStore`               | 运行中 append-only、终态后不可变；事件序号单调；失败 Attempt 也留证据与用量 |
| 记忆通道 `CampaignMemoryPort` | `CampaignMemory`            | 读确定性、写幂等追加；目录缺失即停用该通道，不打死 run                      |

### HTTP adapter

`apps/server/src/server.ts` 基于 Elysia / Node HTTP，同时做四件事：输入防护、两槽并发闸、
只读投影、静态产物托管。它不拥有第二套业务状态——SQLite 才是事实源。

- `POST /api/runs` 只建 run 并返回 202，执行在后台队列推进；
- `GET /api/runs/:id/events` 是 SSE，游标优先读 `Last-Event-ID`；
- 公开状态收窄为 `running → completed | review_rejected | failed`（`apps/server/src/store/schema.ts`）。

`apps/server/src/api/projection.ts` 是对外的字段 allowlist：审计与恢复字段不出网，未知字段默认不公开。

### Web adapter

`apps/web/` 只通过 HTTP 读 run 快照、事件与 Artifact，不直接推断存储状态。
wire type 手写在 `apps/web/src/types.ts`，**不从服务端模块导入类型**——这条边界是故意的，
它让投影的收窄在两侧都是显式的。生产形态下 `dist/` 由 `apps/server/src/server.ts` 同端口托管，
只有一个进程。

## Agent 流程

1. **researcher** 检索 arXiv/Crossref，把命中写进证据台账并冻结成 Artifact。
2. **hypothesis-generation** 在冻结证据上提出至少两个可区分、可证伪的候选假说，逐条保留支持/反对证据、替代解释与不确定性，再留下比较筛选记录；选中只表示进入计划，不表示已证实。
3. **evidence-review** 找缺口；有 gaps 就回到检索，最多两轮。
4. **research-plan** 产出研究计划，引用必须能追溯到冻结 Artifact 的 citations
   （`apps/server/src/agent/plan-quality.ts` 的两道门）。
5. **reviewer** 必须检索到上游未见的新信息再表态；`revise` 触发定向修订，最多两轮，
   第二次拒绝必定终止。
6. **verify**（零 LLM）以 run-local 权威卡检查 B1–B4；任何无法证明的引用事实 fail-closed。

## 存储裁决

- **SQLite 单文件**是运行事实源：`apps/server/src/store/`，默认 `outputs/runtime/typescript-runs.db`，
  `LUUP_DATABASE` 可覆盖。单写者锁；重开数据库即把运行中的 run 判 `interrupted`。
- `memory/`：跨 run 线索库，维持文件制 Markdown、append-only，历史行逐字保留。
  **没有跟着换存储**——它是给人读的，也是竞赛材料的一部分；消融语义「关掉一个目录」
  可陈述，「关掉一张表的某几行」不可陈述。它只提供线索，引用仍必须在本 run 重新核验。
- `data/science125.json`：冻结的 125 题输入源，只读。
- 历史批证据（`runs-ts/` 的 pilot/v2/v3 部分批与 Python 期 `runs/`，ADR-0004）：已迁至
  git tag `archive/phase-a-evidence-20260816`，不在工作树（协议修订 #6，2026-08-16）；
  运营级聚合先行转录进 `memory/lessons.md`。正式批入库时重建 `runs-ts/`。
- `outputs/`、`dist/`、`node_modules/`、覆盖率报告：可重建派生物，不提交。

## 运行与并发

单进程内两个并发槽（`apps/server/src/server.ts` 的 `maxConcurrentRuns`）：够演示并发，
又不会让一批请求同时放大成无上限的付费调用。批跑走另一条路——`apps/server/src/batch/runner.ts`
通过有界并发池调用同一个 Harness；并发数由 CLI 显式给定，熔断按完成顺序计算，已派发题目会落到终态后再收束。

批跑的四条性质：续跑（已交付的题不再花第二次钱）、隔离（一题故障记下来、批次继续）、
有界并发、限时（`RUN_TIMEOUT_MS` 40 分钟，与单跑同一个数）。连续同类失败触发熔断停批——
批跑成立的前提是题与题独立，连续同类失败恰好证伪了这个前提。

## 评估

`apps/server/src/eval/metrics.ts` 只读一个跑完的 SQLite 库，纯函数，不调模型或网络：
版本择优链 gate → refs → token → run id；Tier1 聚合与失败分类分组；
`firstVsLatest` 与 `memoryArms` 两种 McNemar 精确配对。

失败分类的权威定义是 `apps/server/src/agent/failures.ts`；`INFRASTRUCTURE_CLASSES` 在
`metrics.ts` 里**写成字面量而非 import**——改 agent 不该改掉历史跑批的读数。

`apps/server/src/eval/scoring.ts` 给单个 Run 打过程分（六分制），与 metrics 故意不互相 import：
评估口径必须比被评的代码更稳定。

验收细则见 `criteria.md`；预注册协议见 `experiment-protocol.json`；
已定案、不再重提的决策见 `../adr/`。
