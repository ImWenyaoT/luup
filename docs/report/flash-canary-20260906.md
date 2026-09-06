# Qwen 3.8 Flash 单题试跑（2026-09-06）

本次是提交前诊断，不属于正式 Phase A/B，也不证明模型的全量质量。

## 约束与版本

- 用户授权总费用不超过 50 元，优先 `qwen3.8-flash`。
- 截止时间按用户转述的内部群最新通知：北京时间 2026-09-07 00:00。
- 试跑时 HEAD：`ddb989a`，源码工作树干净；包含 Harness 控制功能提交 `1ef56a6`。
- 非正式子集的现有 CLI 将 `source_identity_json` 记为 null；上述版本来自开跑前 Git 核对，不冒充数据库自证。
- 只用环境变量覆盖模型，没有改变默认模型或预注册正式批配置。

## 实际结果

| 项目 | 事实 |
|---|---|
| 题目 | Science-125 Q61：How are pulsars formed? |
| 数据库 | `outputs/runtime/flash-q61-20260906.db` |
| Manifest | `070c19132efd42b791c374d7ea34988f` |
| Run | `420ad036691c418391759cfad168b809` |
| 时间 | 2026-09-06 08:46:59–08:52:40（北京时间），340.9 秒 |
| 终态 | `failed / invalid_output`，未产出最终研究计划 |
| 已完成 | 首轮 researcher、hypothesis-generation、evidence-review |
| 停止原因 | 第二轮 researcher 的 `MaxTurnsExceededError`；12 次模型请求、18 次工具调用，未交结构化产物 |
| 总用量 | 输入 291,354 / 输出 33,535 / 合计 324,889 tokens；4 个 Attempt 用量均已落库 |
| 保守估算 | 输入 1 元/M、输出 3 元/M，合计 **0.391959 元**，不是账单实扣 |

价格参考：[百炼价格表](https://help.aliyun.com/zh/model-studio/model-pricing)。未扣除缓存或优惠。

工具事实中有 9 次 arXiv `fetch failed`，另有 4 次 arXiv 成功和 12 次 Crossref 成功。
网络失败与未收敛同时存在，不能仅凭本次结果把根因归于 Flash 能力不足。
试跑后独立请求 `all:pulsar`、`max_results=1` 返回 HTTP 200；这仅证明简单请求当时可达，不能解释或排除批内失败。

## 复现与证据

```sh
LUUP_MODEL_ID=qwen3.8-flash node --env-file=.env node_modules/tsx/dist/cli.mjs apps/server/src/batch/runner.ts --ids 61 --concurrency 1 --db outputs/runtime/flash-q61-20260906.db
```

重复诊断应另选新数据库，避免续跑跳过或混淆记录。凭据不进入报告。

- 逐题索引：`outputs/diagnostics/flash-q61-20260906-index.json`
- 用量明细：`outputs/diagnostics/flash-q61-20260906-usage.jsonl`
- 用量报告：`outputs/diagnostics/flash-q61-20260906-usage.md`

正式全量之前须解决检索故障下的收敛问题、核实人民币预算控制，并追加正式模型/运行策略的协议修订；当前批次故障熔断规则未改。不能将本次单题费用直接当作 125 题预算保证。

## 后续科学正文实跑

v9、v10 后续开发诊断及独立科学质量结论见 [Q61 科学正文复核](q61-scientific-output-audit-20260906.md)。v10 已完成全流程并生成 10 页正文，12 条引用全部通过，但独立复核仍发现科学判据与来源解释问题；不能仅据流程完成视为可提交成果。以上首轮结果保持原记录。
