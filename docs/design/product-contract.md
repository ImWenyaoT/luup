# Luup Pro：最小产品契约

本文件从比赛目标向下推导能力，不从现有代码反推需求。来源优先级为：

1. [比赛官网](https://university.aliyun.com/action/tzbjbgs2026)当前页面；
2. [`docs/specs/` FAQ](../specs/【阿里云】挑战杯揭榜挂帅阿里云赛题答疑.md)；
3. [`XH-202619.pdf`](../specs/XH-202619.pdf)中未被官网更新的信息。

## 一句话目标

基于百炼 Qwen，为《Science》125 个问题生成有真实证据、可验证、能够自动改进的《科学假设与研究计划》，并让评审可以复现结果。

## 三项官方约束

| 官方约束 | 最小能力 | 验收证据 |
|---|---|---|
| 方向 A：完成“问题理解—知识整合—候选假设—证据梳理—研究计划—反馈修正”；提交 125 题结果 | 生成一份符合标准字段的研究计划；失败时补证据或修改方案；批量断点续跑 | `proposal.json/md`、真实引用核验、至少一个同题改进案例、125 题索引 |
| 基座使用 Qwen，并通过百炼或官网认可工具调用，保留凭证 | 所有模型调用走同一个 Qwen provider adapter | 模型配置、请求与 usage 凭证 |
| 提交技术方案、代表案例、源码、工作流、上下文工程、数据来源和迭代过程 | 运行过程可复算，关键判断有明确证据 | ≤20 页技术文档素材、源码、可重放案例与验收报告 |

可交互前端、测试 API 和演示视频是官网“鼓励/推荐”或“附加提交（可选）”，不是官方硬性要求。Luup 主动选择交付基本桌面前端与测试 API，用于运行和展示核心闭环；明确不制作演示视频，也不扩张部署、移动端或无障碍专项。

## 三项系统能力

1. **Scientist**：检索证据，提出假设并写成可验证的研究计划。
2. **Reviewer**：通过独立检索或确定性工具引入新信息，指出证据、推导和验证设计的缺口。
3. **Harness**：由普通 Python 控制流与 OpenAI Agents SDK 共同负责调度、预算、持久化和最终验收；Agent 的自我宣称不能决定通过。

Harness 是确定性薄管理者，不是第三个 LLM Agent。Scientist 是否需要再拆出 Literature Agent，必须由同预算消融实验证明；在此之前默认不拆。

```text
question → Scientist → verify → Reviewer → 最多一次返修 → final verify
```

上下文默认不共享完整轨迹。只传问题、证据、方案和具体失败项；Harness 只落可复算的 handoff trace、usage 和工件，不引入通用 workflow runtime。

对用户只暴露三种状态：`working → passed | failed`。内部恢复所需事实继续从工件推导，不扩展成第二套业务状态机。

## 现有系统裁决

### 保留

- Qwen/Bailian 单一模型接线与调用凭证；
- Science-125 题库、批量运行与断点续跑；
- Proposal Schema、真实引用 B1–B4 和离线交付验证；
- OpenAI Agents SDK 两 specialist、独立上下文及文件工件恢复；
- 基本桌面前端与测试 API，维护“选题/触发运行/查看结果”的核心路径。

### 先实验再决定

- Literature 是否值得成为独立 Agent：比较“Scientist 自搜”与“Researcher 移交证据包”；
- 跨 run memory 是否提高交付率或证据质量；
- Reviewer 的收益：必须以独立检索、反例或工具验证带来的缺陷检出衡量；
- LLM judge：校准不合格时只作诊断，不参与晋级。

### 删除或合并候选

- 删除“至少三个 subagent”的人为门槛；
- 合并 Hypothesis 与 Writer：二者属于同一次科学论证，不因输出字段拆成两个 Agent；
- 删除每条 DAG 边都由 LLM master 重复认证的要求，能由 Schema 或 verifier 判断的交给代码；
- 将多节点、每节点三轮返工收敛为一次 Reviewer 返修；
- 前端/API 保留为团队主动选择的交付面，但不得反向增加 Agent 复杂度；不做移动端、无障碍、部署和实时通信专项；
- 不新增消息总线、通用 tracing 平台、向量库、仿真环境或更多生命周期状态；只保留 E3 要求的最小 JSONL handoff trace。

## 下一项实验

先做 Agent 边界消融，不新增框架：在冻结题目和相同总步骤/token 预算下比较：

- A：Scientist 自行检索、生成计划；
- B：独立 Researcher 检索后向 Scientist 移交证据包。

只看三项：确定性交付、证据质量、成本。B 不能取得足以覆盖额外成本的提升，就删除 Literature Agent。
