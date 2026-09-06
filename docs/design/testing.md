# Luup 测试与技术栈职责

Luup 的核心交付是 Harness 控制下的科研 Agent。测试首先约束候选晋升、证据真实性、失败终态、
用量和共享记忆；Web E2E 验证用户能否正确操作和读取这些事实。
本页补充 [验收判据](criteria.md) 和 [森林理论 ADR](../adr/0012-forest-harness.md)，不修改预注册实验。

## 验证面与测试替身

| 验证面 | 真正执行的实现 | 替换的部分 | 关键测试 |
| --- | --- | --- | --- |
| Harness 与角色合同 | 五阶段编排、Zod 合同、冻结交接、真实 SQLite | 模型答案、外部检索与反查 | `harness.test.ts`、`structured-output.test.ts`、`reviewer.test.ts` |
| SDK/provider 合同 | 模型 seam、SDK Runner、Responses HTTP 编解码、工具调用、usage | HTTP 服务端为本地脚本响应，禁止外部请求 | `provider-contract.test.ts`、`executor.test.ts` |
| 预算与故障 | 取消、补证上界、传输重试、批跑并发和熔断、终态存储 | 受控延迟、网络错误、模型输出 | `batch.test.ts`、`executor.test.ts`、`store-invariants.test.ts` |
| 证据与共享记忆 | 证据台账、B1–B4、campaign 读写与注入、消融过滤 | 权威源反查 fixture，临时记忆目录 | `verify.test.ts`、`evidence-ledger.test.ts`、`campaign.test.ts` |
| 评估与成本 | 只读 SQLite 派生、manifest 分组、未知值传播 | 临时真实事实库 | `metrics.test.ts`、`scoring.test.ts`、`usage-export.test.ts` |
| 产品集成 | HTTP/SSE、Next 生产构建、真实 Chromium | 确定性 executor/verifier，零模型费用 | `apps/web/tests/` |

表中的单测均在 `apps/server/test/`，provider 合同测试走真实 SDK 但不证明百炼在线可用。
五角色测试重点检查最终工件与持久化结果，不能只断言某条日志或角色调用发生过。

目前明确守住的不变量：

- 原始 Hypothesis 保持冻结；planner 的输入和最终 prediction 指向 Harness 实际晋升的候选。
- Reviewer 拒收不回同一 planner 改稿；没有合格候选时 fail-closed。
- 批任务超时后的迟到 verifier 不能改变终态、伪报成功或向 campaign 写 SUCCESS。
- 已结束 Run 的重复执行不新增 Attempt，也不重复追加共享记忆。
- 缺失 provider usage、或纠错两轮中只知道一轮的 usage，不能成为零成本或精确总成本。
  已知部分保留在审计字段；公开 token 与成本为未知，不能按零参与报告。
- provider 请求保持 `/responses`、模型 seam 配置、结构化工具合同与真实工具回传。

## 覆盖率与 CI

```sh
pnpm run test:agent     # 后端全量：核心合同、SDK、store、评估；无付费调用
pnpm run test          # 前后端全量单测
pnpm run ci            # 类型、lint、格式、生产构建、两包覆盖率
pnpm run test:e2e      # 默认构建，确定性 API + Web
pnpm run test:e2e:webmcp # 显式开启构建，包含原生 WebMCP 验收
```

CI 的 `check` 已运行整个 server 测试集，不另设重复执行同一套测试的 Harness job。
`e2e` 矩阵验证 WebMCP 关闭和开启。失败的覆盖率、截图和 trace 作为 CI artifact 保留。

两包全局函数/行地板仍为 80%。Harness、roles、executor、store、campaign、verifier
还分别接受 Vitest 原生函数/行 80% 门禁，避免核心低覆盖被外围代码平均掉。
`coverage.include` 包括未被测试导入的源码。LCOV 检查保留全局门与空/损坏报告拒绝能力；
Vitest 原生生成 `coverage-summary.json` 供逐文件分析，原生 `coverage.clean` 负责清理旧结果。

覆盖率用于定位遗漏，不能证明断言有效。修复核心缺陷时先通过真实接口使测试失败，再验证修复使其通过；
尤其要检查错误候选、拒收、超时、取消、部分结果和未知状态。不得为提高数字排除低覆盖核心文件。

## 技术栈取舍

| 保持职责 | 原因 |
| --- | --- |
| Agents SDK：单角色工具循环、Zod 结构化输出、Runner 重试与生命周期钩子 | 已有实际消费者，避免另造 Agent loop 或叠加重试层 |
| 普通 TypeScript Harness：候选晋升、预算、硬闸、冻结输入 | 这是 Luup 的领域规则；SDK handoff 不等价于不可变工件交接 |
| SQLite：事务、单写者、终态与事件账本 | 终态来自持久化事实，不能由迟到协程的局部变量决定 |
| Campaign：仅合格结果注入；与全量审计分开 | SDK session 的对话历史不能替代经过验收的跨 Run 知识 |
| Vitest + Playwright：合同与集成分层 | 不为“测试更多”另引入 runner、浏览器框架或随机不稳定门禁 |
| Next/React Query：展示与请求状态 | 不把候选选择、Agent 循环或科学验收搬到 Web |

充分利用技术栈意味着把已有能力用于真实职责，不要求采用 SDK 的所有功能。
输出 schema 和 SDK guardrail 也不能替代基于冻结证据的 B1–B4。

## 仍需独立证据的结论

- 确定性测试不证明科学价值、方法有效性或五个角色各自有增益；A1/A2 仍需人工科学审查。
- `eval`/`score` 从已有事实派生。记忆与角色是否有效，需要按既定协议、固定题目与预算的比较；
  不为提高交付率重挑 cohort，不把高拒收当作必须降低的错误率。
- 百炼在线协议、限流和模型质量仍需明确预算的 live canary/批跑；不会在普通 CI 里调用模型。
- SDK 与百炼的兼容性需独立验证；已实测原生 JSON Schema 输出约束失效、截断响应被 SDK 当作完成。
  当前五角色使用工具上报与本地 Zod 校验，模型 seam 在执行工具前检查 Responses 状态。
  详见 [Qwen Responses 兼容性](qwen-responses-compatibility.md)。

官方能力依据：[Agents SDK 运行](https://openai.github.io/openai-agents-js/guides/running-agents/)、
[编排](https://openai.github.io/openai-agents-js/guides/multi-agent/)、
[测试](https://openai.github.io/openai-agents-js/guides/testing/)、
[Vitest 4 coverage](https://v4.vitest.dev/config/coverage)。

运行中控制的接口、冻结与取消语义见 [Harness 运行控制](./harness-control.md)。
E2E 的确定性服务器在角色返回前加入可取消延迟，给真实浏览器稳定的操作窗口；生产运行时不增加延迟。
