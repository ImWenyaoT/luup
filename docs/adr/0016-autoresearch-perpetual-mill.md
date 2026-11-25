# ADR-0016 · Autoresearch 永动机（连续战役产论文）

## 状态

已接受，2026-11-25。叠在 ADR-0013 / ADR-0015 之上。

## 背景

赛题已结束。用户要的不是「再跑 125 题」，而是接好模型与工具之后的
**super-agent auto-research 永动机**：持续做实验、产论文草稿，至少在**产量**上有保证。

单次 chat → 单 Ticket 不够。需要：

- 研究议程（Agenda）可续写
- 战役环（Mill）按上界连续开 Ticket
- verified 结果沉淀为 Paper 工件
- 产量门（Quantity gate）：未达目标篇数不得宣称战役完成

Science-125 题库与五角色批跑退出产品主轴；可删（本里程碑先断产品入口，整树删除另开以免一次炸 CI）。

## 决定

1. **ResearchMill**（`autoresearch/mill/`）：宿主拥有的连续环，不是模型自循环。
2. 输入：`ResearchAgenda`（主题 + 种子问题队列）+ `targetPapers` + `maxTickets`。
3. 每步：从议程取下一问 → `ResearchEngine.runResearch` → Decision；
   - `verified` → 铸 `PaperDraft` 工件，并把 follow-ups 写回议程；
   - `fail_closed` → 记失败，可换下一问，**禁止**同 Ticket 改到过。
4. **产量门**：`papers.length >= targetPapers` 才 `completed`；否则 `exhausted`（票用尽）或 `stopped`。
5. API：`POST /api/autoresearch/mill/start|stop`、`GET .../status`；UI 挂在 `/autoresearch`。
6. Science-125：产品默认入口只认 Mill / chat；题库与 `/api/runs` 标 archive，删除日程另开。

## 后果

正：量可数、环可停、森林硬闸仍在每次 Ticket 上。

负：论文质量门（同行评审级）本刀不做，只保证产量与 verified 门槛；长跑 Effects/崩溃续跑仍浅。

## 验收

- 确定性 runtime 下 Mill 能跑满 `targetPapers`（注入假 Engine）并暴露产量计数
- 未达目标时 status ≠ `completed`
- verified Paper 落盘 `outputs/papers/<id>.md`（可盘点）
- 不依赖 `data/science125.json` 启动 Mill；产品入口 `/` → `/autoresearch`
- `pnpm run ci` 相关门绿
