# FAILED Report

## 科学问题
How are pulsars formed?（脉冲星是如何形成的？）

## 失败原因
**proposal 节点连续 3 轮均未能生成符合 10 字段契约的 JSON 结构**

### 判据未达标项

1. **proposal 10字段契约** ❌
   - 证据：subagent 在 3 轮中均返回错误结构
   - 第 1 轮：返回 problemStatement, technicalDetails, datasets, paperTitle, paperAbstract, methods, results 等非契约字段；缺少 question, hypothesis, risks
   - 第 2 轮：返工指令明确指出缺少字段后，仍返回相同错误结构
   - 第 3 轮：进一步简化指令后，subagent 仍无法输出正确的 10 字段结构
   - 正确结构应为：title, question, hypothesis, background, rationale, approach, experiments, expectedOutcomes, risks, references

2. **熔断器触发**
   - proposal 节点连续 3 次 reject，已达到重试上限
   - 根据规则"同一节点连续 3 次 reject → 不做第 4 次重试"，停止重试

### 其他节点状态

- **literature**: ✅ pass (r1)
  - 10 张事实卡片，覆盖现状方法和已知局限两个侧面
  - 产物：`evidence.md`, `verdicts/literature-r1.json`

- **hypothesis**: ✅ pass (r1)
  - 3 个候选假设，均有显式推导链
  - 产物：`hypotheses.md`, `verdicts/hypothesis-r1.json`

- **critique**: ✅ pass (r1)
  - 每假设 4 条实质性批判，含 checkedWith 工具核查
  - winner: H2（含 revisedStatement）
  - 6 条具体 requiredChanges
  - 产物：`critique.json`, `verdicts/critique-r1.json`

- **proposal**: ❌ fail (r1, r2, r3 均 reject)
  - 内容质量合格（rationale 逐条回应 requiredChanges，experiments 含 baselines 和 metrics，references 均来自 paper index）
  - 但 JSON 结构始终不符合 10 字段契约
  - 最近产物：subagent 返回的 JSON（未落盘为 proposal.json，因校验失败）

### 根本原因分析

proposal subagent 无法遵循严格的 JSON schema 约束。尽管提供了明确的字段列表和多次返工指令，subagent 始终输出包含非契约字段的 JSON。这可能是：
1. subagent 的系统提示与输出 schema 约束冲突
2. subagent 倾向于生成"论文式"结构而非"契约式"结构
3. 指令中的字段映射不够明确（尽管已多次强调）

### 可恢复路径

若需重试，建议：
1. 更换 proposal subagent 的实现策略（如使用 outputSchema 参数强制约束）
2. 在 master 层做字段映射后处理（将 subagent 输出手动映射到正确结构）
3. 缩小任务范围：分两步生成，先生成核心字段（title, question, hypothesis, background），再生成其余字段

## 最近产物路径

- evidence: `/home/ail510/tian_wenyao/projects/luup/runs/20260808-093646/evidence.md`
- hypotheses: `/home/ail510/tian_wenyao/projects/luup/runs/20260808-093646/hypotheses.md`
- critique: `/home/ail510/tian_wenyao/projects/luup/runs/20260808-093646/critique.json`
- verdicts: `/home/ail510/tian_wenyao/projects/luup/runs/20260808-093646/verdicts/`
  - literature-r1.json
  - hypothesis-r1.json
  - critique-r1.json
  - proposal-r1.json
  - proposal-r2.json
  - proposal-r3.json (未生成，因 subagent 第 3 轮返回仍不合契约)

## 结论

流水线在 proposal 节点失败，原因是 subagent 无法生成符合 10 字段契约的 JSON 结构。前 3 个节点（literature, hypothesis, critique）均通过认证，内容质量合格。proposal 的内容实质已生成（含 rationale 逐条回应、experiments 含 baselines/metrics、references 来自 paper index），但结构不符合契约要求，无法通过 verify_references 终审。

根据 fail-closed 原则和熔断器规则，如实报告失败，禁止用降低标准的方式让流程"通过"。
