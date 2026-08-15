# ADR-0004 · Python 栈退役与仓库结构定形

## 状态

已接受，2026-08-15。承接 ADR-0003 的收口条款。

## 背景

ADR-0003 给 TypeScript 全栈复活写了一条退出条件：**8/20 检查点**，TS 栈必须在那之前
具备端到端跑完 Science-125 Phase A 的能力，未绿即回退到 Python 栈。

条件已满足，且早于期限：五角色 + B1–B4 + 批跑 + 评估 + 交付面全部就位，163 条用例全绿，
**Phase A 已在 TS 栈上开跑**。回退路径的存在意义随之消失——回退是为了保住 Phase A 的机时，
而 Phase A 已经在跑了，此刻回退等于自己作废自己的数据。

ADR-0003 写的是「绿了则收口：Python 栈在 Phase A 跑完后删除」。本 ADR 执行这一句。

同时定形仓库结构。此前的目录形状是四次基底变更留下的地层：`backend/` + `frontend/`
是 Python 期的，`src/` + `frontend-ts/` 是 TS 期的，两套并存时靠「谁在哪个目录」区分，
Python 栈一删，`frontend-ts` 这个名字就只剩历史包袱。

## 决定

### 一、删除 Python 栈

`backend/`（58 文件）与 `frontend/`（88 文件，与 FastAPI 配对的 bun/biome 交付面）
从 HEAD 删除。git 历史保留一切；需要复核 Python 期实现时去历史里看。

**不做任何「顺手移植」**：删除前扫描过 TS 栈对 `backend/` 的引用，命中的全是注释里的
出处标注和文档里的路径，没有一处运行时依赖（`data/science125.json` 早已复制到仓根 `data/`，
与 Python 期的 `app/data/science125.json` 逐字节相同）。若日后发现遗漏功能，
按新需求另行安排，不以「移植」的名义绕过评审。

### 二、结构定形

学 `deepseek-harness` 的顶层形制——`apps/`（可执行入口）+ 按子系统组织的源码 + `docs/` + 根配置。
**搬形制不搬体量**：dsh 是 219 个包，luup 约 3K 行源码，分成 6 个微包是负资产。

| 落点 | 决定 |
|---|---|
| harness 本体 | **保持根单包**，`src/` 按子系统分目录（agent/api/batch/campaign/domain/eval/seams/store/verify） |
| 交付面 | `frontend-ts/` → **`apps/web/`**，pnpm workspace 收窄为 `apps/*` |
| `backend/`、`frontend/` | 删除 |
| `runs/` | 保留，降为**只读归档** |
| `memory/`、`docs/`、`data/`、`runs-ts/` | 原地不动 |

### 三、CI 重建

`test-backend` / `test-frontend` / `test-e2e` 三条 workflow 随 Python 栈删除全部失效，
换成单条 `.github/workflows/ts.yml`，两个 job：

- `check`：install → typecheck → lint → test:coverage → build，与 `pnpm run ci` 同序；
- `e2e`：Playwright 打确定性 runtime 的单进程交付形态，零 LLM 调用。

覆盖率地板（75/70/80/75）留在 `vitest.config.ts` 一处，不在 workflow 里复写第二份。
pnpm 版本由 corepack 从 `packageManager` 读，node 版本从 `.nvmrc` 读——都只有一个事实源。
action 继续钉 SHA。

## 后果

### 正

- 一套栈、一条 CI、一份 AGENTS.md。ADR-0003 记的那条代价（「`AGENTS.md` 在切换完成前
  只能同时指两处」）就此消失。
- 目录名不再需要「哪个是新的」这类背景知识才能读懂。
- 门矩阵从「Python 三门 + bun 四门 + 跨栈 e2e」收敛成 `pnpm run ci` 加一条 e2e。

### 负（如实记录）

- **回退路径消失。** Phase A 若在 TS 栈上出系统性问题，没有第二套实现可切——只能修。
  这是本 ADR 最贵的一条，但它是 ADR-0003 的退出条件被满足后的必然结果：
  同时保住两套栈的代价（认知负担 + 双份 CI + 每次改领域约束都要判断落在哪侧）
  已经超过它买到的保险。
- **`runs/` 成为只读归档的含义要说清楚**：Python 期跑出的 run 证据仍然有效、仍然入库、
  仍可引用，但 TS 栈既不写它也不读它，且**没有任何代码能再生成同格式的内容**。
  跨栈历史比对只能按题号人工映射（题库逐字节相同，题号可比）。这也是 125 题必须
  在同一个栈上跑完的原因——已经这么做了。
- 源码注释里留下一批「Python 期 `app/xxx.py`（ADR-0004 已删）」的出处标注。
  它们指向 git 历史而非工作区，读的人要多一跳。保留是因为那些实现细节的来由
  （为什么是 30 秒超时、为什么八个 EvidenceStatus）确实在那些文件里。

## 何时重新审视

本决定**不设重新审视条件**——它是 ADR-0003 退出条件的执行，不是一次新的基底选择。

luup 到此为止发生过四次基底变更（见 ADR-0003 的表）。第五次不会因为
「新工具/新框架看起来更好」而发生；那正是前三次的成因。竞赛交付（2026-09-05）之前，
基底话题关闭。
