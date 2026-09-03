# ADR-0012 · 森林理论 Harness（默认真错、高拒收、仅 verified merge）

## 状态

已接受，2026-09-01。授权后续 harness 语义落地（F1–F4）；本条不改运行时代码。

## 背景

现有五角色流水线已具备：Harness 拥有控制流、冻结 Artifact handoff、B1–B4 零 LLM 引用验收、
以及 PR #37 的每候选恰好一条 evidence-review assessment。偏离「森林理论」的三处是：

1. reviewer `revise` 把意见喂回 research-plan「改到过」——公司式互改环；
2. evidence-review 的 `contradicts` 等判定不挡选中候选晋升；
3. SQLite 全量审计与 campaign `prior_attempts` 注入面未分层，失败轨迹也可进入跨 run 线索。

森林理论把编排建成科学家式 peer-review：**默认真错 → 独立 critique → 硬闸 → 极少 merge**；
允许高拒收，禁止交付率借口下的互相改稿。

## 决定

- **默认不信任**：角色产出互不默认正确；下游以压力测试与硬闸对待上游，不以协商改稿为默认路径。
- **禁止公司式修订环**：reviewer 不接受即终止该支线（`review_rejected` 或 amendment 钉死的等价终态）；
  **不得**把 revise 意见喂回同一 planner 循环直至通过。若再试，只允许新开 attempt / 新候选支线，
  输入为冻结证据与拒收记录，不是「按上轮意见改到过」。
- **审计账本 ≠ 可注入 KB**：SQLite 全量 Artifact/事件保留给人读与评测；campaign 可注入的
  `prior_attempts` **仅** `SUCCESS`（`completed`）∧ B1–B4 通过。失败与拒收可写给人看的日志，
  不得进入注入面。
- **候选晋升硬闸**：进入 research-plan 的选中候选必须过 evidence-review 证据门；
  `contradicts` **不得**晋升。无合格候选 fail-closed（终态码由实现 amendment/代码钉死）。
- **Propose ≠ Select**：hypothesis-generation 可多候选与自评 ranking；自选不得单独决定晋升。
  高拒收率是设计目标，不是回归。
- **保留不变**：Harness 拥有顺序与上界；冻结 Artifact handoff；B1–B4 零 LLM fail-closed；
  PR #37 每候选 assessment 覆盖；工具分模块；不用 LLM 做终局「科学真理」裁判。

## 后果

正：共享 KB 保持小而干净；拒收可观测、可测；修订环消失后 `revisionRate` 等机制指标语义须随
amendment 重读。

负 / 代价：单题交付率可能下降；无合格候选与即时拒收会抬高质量类未交付；旧「改到过」路径上的
历史 canary / 部分批不得与森林语义批并列读数。

## 验收

代码落地（F1–F4）后须由单测与 CI 钉住 harness 语义，至少包括：

- `contradicts`（及 amendment 钉死的其它否决判定）挡晋升；无合格候选 fail-closed；
- reviewer 不接受后不存在「feedback → 同支线 planner rewrite」路径；
- campaign 注入过滤：非 `completed`∧B1–B4 的 prior 不得进入 researcher 开局注入；
- B1–B4、每候选 assessment 覆盖、冻结 handoff 既有门不回退；
- server 覆盖率地板不降；确定性 runtime / E2E 零 LLM 路径覆盖新终态。
