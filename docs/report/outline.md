# 技术报告骨架（≤20 页 PDF，提交期完稿）

对应官网提交要求逐项映射。每节标注页数预算与素材来源。

| # | 节 | 页 | 内容与素材 |
|---|----|----|-----------|
| 1 | 封面与摘要 | 1 | 题目/队伍/一句话：判据驱动的对抗式多智能体 AI Scientist |
| 2 | 研究问题与解决方法 | 2 | 维度A任务拆解；核心主张：引用可信度=机制层约束而非 prompt 约束（四道防线）；对比常见 RAG 方案的取舍 |
| 3 | 架构设计与讲解 | 4 | 架构图（architecture.md）：确定性 Harness 串 Scientist → Reviewer → 至多一次返修 → B1-B4 验收器，流程控制是普通 Python 不是 LLM 主控；fail-closed 三处（Reviewer 必须带新证据、返修必须真改、契约不合格不重试）与失败分类；上下文工程（显式 handoff、不共享上下文、文件式 run/campaign 两层 memory）；Python Agents SDK 装配（工具所有权分离、function_tool docstring 即 description、maxTurns 熔断） |
| 4 | 基于 Qwen 的模型层 | 2 | 百炼 responses API 接线与兼容层（enable_thinking 实测）；thinking 分档策略；调用凭证截图（百炼控制台 + usage.jsonl） |
| 5 | 真实案例 | 3 | Q61 完整案例：输入→evidence→hypotheses→critique→proposal.md（节选）→verification-report ALL PASS；作者虚构被 B4 拦截的对照案例（负样本展示验证有效性） |
| 6 | 质量保障 | 2 | criteria.md 判据体系；确定性验收器（B1-B4）；eval 脚本（smoke + full-run gate）；goal-driven E2E 方法论 |
| 7 | API 与前端入口 | 2 | 可调用测试 API（端点表+curl 示例）；前端截图（仪表台/run 详情/reasoning spine 时间线） |
| 8 | 125 题结果文档 | 1 | 批量 runner（断点续跑）说明；全量结果文档的组织方式（runs 索引 + 逐题 proposal.md 汇编）；完成度统计表 |
| 9 | 可复现性与源码 | 1 | 仓库结构；pnpm 三命令复现；运行成本表（token/时长）|
| 10 | 局限与展望 | 1 | arXiv 领域覆盖偏物理/CS（医学/生态题的文献源扩展路径：PubMed/Crossref）；SFT/多模态扩展路径 |
| 11 | 附录索引 | 1 | 全量 125 输出文档、源码、演示入口的链接/网盘 |

素材缺口（提交前补）：百炼控制台用量截图、前端截图、125 全量跑完成度表。
