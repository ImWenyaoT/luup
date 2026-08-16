# 运营级教训

append-only：新条目追加在文末，旧条目不改写、不删除。本文件由人手维护——没有工具会写它，模型也没有写本目录的通路。

记什么：跨题复用的运营判断 —— 哪些学科 arXiv 覆盖差、哪类检索词有效/无效、哪种假设方向在多题上反复被拒。
不记什么：单题结论（那属于 `questions/q<id>.md`）、文献元数据（那属于 `library/`）。

样本少的统计性断言请在正文里写明样本量（「跑了 3 题」不等于结论）。

## [2026-08-16] 三个部分批的运营读数（非正式读数；用户指示转录）

样本：pilot 99 / v2 20 / v3 38 已结算（库内实查；v2/v3 停批 commit 文案分别写 21 与 16/16/8，
库内为 20 与 15/15/8，以库为准）。三批 harness 版本互不相同、已被协议修订 #3/#4 围出正式读数，
跨批聚合只作运营参考。

- **学科梯度**（completed/已结算，三批合并）：Mathematical Sciences **0/9**、
  Information Science 0/4（仅 pilot）、Neuroscience 0/5（仅 pilot）、Chemistry 9/27、
  Physics 5/18（仅 pilot）、Medicine & Health 12/30、Biology 14/37、Astronomy 10/23（仅 pilot）、
  Engineering & Materials 2/4（仅 pilot）。
- **数学题全灭**：q1/q2/q3 在出现过的每一批全部非 completed（9 个终态，invalid_output 与
  review_rejected 各半）。「素数为何特殊」类开放理论题难以落成证据支撑的可验证计划——
  失败形状不是检索覆盖差，是问题形态与产出契约的错配。
- **q5（Chemistry）三批全部 invalid_output**——同因复发的确定性失败，值得单独调查产出契约在该题上
  卡在哪，而不是指望重跑撞运气。
- **跨批 ≥2 次失败共 24 题**，集中在 Chemistry(8)、Medicine(6)、Biology(7)、Math(3)；
  清单见 questions/ 对应题页。全量批期望通过率参考：最近 harness（v3）39%（15/38），
  三批合并 33%（52/157）。
- **v3 单题墙钟**：completed 中位 127s / 均值 150s；review_rejected 均值 177s；全体最大 383s。
  并发 3 跑全量 125 题约 2 小时量级，单题 40 分钟上界远未触及。

## [2026-08-16] 证据归档迁移（用户指示）

pilot/v2/v3 三个 db、phase-a-pilot-remaining.json 与 Python 期 `runs/`（10 run：3 OK / 7 FAILED）
自工作树删除，字节完整保存于 git tag `archive/phase-a-evidence-20260816`。本目录 log.md 与
questions/ 里的 `runs-ts/*.db#<runId>` 定位符按 append-only 契约不改写，经该 tag 解析。
处置记录：协议修订 #6。
