import assert from "node:assert/strict";
import { test } from "bun:test";

import { researchPlanSchema, type ResearchPlan } from "../src/agent/contracts.ts";
import { researchPlanExecutionIssues, researchPlanQualityIssues } from "../src/agent/plan-quality.ts";

const validPlan = {
  artifact_type: "research-plan",
  problem_statement: "研究问题",
  rationale: "研究理由",
  technical_details: "技术细节",
  datasets: ["数据集"],
  source: "来源",
  target: "研究目标",
  execution_plan: {
    predictions: [
      {
        candidate_id: "candidate-1",
        prediction: "证据门组的无来源引用率低于基线组。",
        falsification_criterion: "若两组无来源引用率相同或证据门组更高，则否定该预测。",
      },
    ],
    data_requirements: [
      {
        source: "预注册问题集",
        variables: ["无来源引用率", "任务完成率"],
        conditions: ["同一模型、同一问题集和相同总 token 预算。"],
      },
    ],
    steps: [
      { order: 1, action: "冻结问题集并分别运行两种条件。", expected_output: "每题一份结构化产物。" },
      { order: 2, action: "按同一规则核验引用并汇总指标。", expected_output: "配对指标表和失败记录。" },
    ],
    analysis: [
      {
        method: "配对比例比较",
        inputs: ["两组逐题引用核验结果"],
        decision_rule: "报告差值及其置信区间，不以未执行的结果宣称假设成立。",
      },
    ],
    result_interpretations: [
      { observed_result: "无来源引用率下降且完成率不下降。", meaning: "支持继续验证证据门候选。" },
      { observed_result: "无来源引用率不下降或完成率下降。", meaning: "否定或回退证据门候选，并检查替代解释。" },
    ],
    stop_conditions: ["达到预注册样本量且所有题都有终态记录。"],
    rollback_conditions: ["引用核验无法复现或数据完整性门失败。"],
    supplement_evidence_conditions: ["关键变量缺少可用来源或出现无法解释的冲突证据。"],
  },
  paper_title: "标题",
  paper_abstract: "摘要",
  methods: "方法",
  experiments: {
    baselines: [
      { name: "基线一", evidence_id: "ev_1" },
      { name: "基线二", evidence_id: "ev_1" },
    ],
    metrics: [
      { name: "指标一", evidence_id: "ev_1" },
      { name: "指标二", evidence_id: "ev_1" },
    ],
    design: "实验设计",
  },
  results: {
    status: "pending_verification",
    validation_basis: "formula_derivation",
    feasibility_argument: "在固定问题集和预定义指标的条件下，比较基线与证据门的预期变化范围，并据此判断实验是否可行。",
    expected_outcomes: [{ metric: "指标一", statement: "预期结果" }],
  },
  references: ["https://example.com"],
  input_artifact_ids: ["a", "b", "c"],
  verification_evidence_ids: ["ev_1"],
} as const;

test("ResearchPlan 保留公式推导验证字段", () => {
  const parsed = researchPlanSchema.parse(validPlan);

  assert.equal(parsed.results.status, "pending_verification");
  assert.equal(parsed.results.validation_basis, "formula_derivation");
  assert.equal(parsed.results.feasibility_argument, validPlan.results.feasibility_argument);
  assert.equal(
    researchPlanSchema.safeParse({
      ...validPlan,
      results: { ...validPlan.results, validation_basis: "actual_execution" },
    }).success,
    false,
  );
  assert.equal(
    researchPlanSchema.safeParse({
      ...validPlan,
      results: { ...validPlan.results, feasibility_argument: "" },
    }).success,
    false,
  );
});

test("ResearchPlan 必须保留可执行研究计划的完整分支", () => {
  const parsed = researchPlanSchema.safeParse({
    ...validPlan,
    execution_plan: {
      predictions: [
        {
          candidate_id: "candidate-1",
          prediction: "证据门组的无来源引用率低于基线组。",
          falsification_criterion: "若两组无来源引用率相同或证据门组更高，则否定该预测。",
        },
      ],
      data_requirements: [
        {
          source: "预注册问题集",
          variables: ["无来源引用率", "任务完成率"],
          conditions: ["同一模型、同一问题集和相同总 token 预算。"],
        },
      ],
      steps: [
        { order: 1, action: "冻结问题集并分别运行两种条件。", expected_output: "每题一份结构化产物。" },
        { order: 2, action: "按同一规则核验引用并汇总指标。", expected_output: "配对指标表和失败记录。" },
      ],
      analysis: [
        {
          method: "配对比例比较",
          inputs: ["两组逐题引用核验结果"],
          decision_rule: "报告差值及其置信区间，不以未执行的结果宣称假设成立。",
        },
      ],
      result_interpretations: [
        { observed_result: "无来源引用率下降且完成率不下降。", meaning: "支持继续验证证据门候选。" },
        { observed_result: "无来源引用率不下降或完成率下降。", meaning: "否定或回退证据门候选，并检查替代解释。" },
      ],
      stop_conditions: ["达到预注册样本量且所有题都有终态记录。"],
      rollback_conditions: ["引用核验无法复现或数据完整性门失败。"],
      supplement_evidence_conditions: ["关键变量缺少可用来源或出现无法解释的冲突证据。"],
    },
  });

  assert.equal(parsed.success, true);
  if (parsed.success) assert.equal(parsed.data.execution_plan.steps.length, 2);
});

test("ResearchPlan 质量门一次报告空洞论证及其余绑定问题", () => {
  const plan = {
    ...validPlan,
    experiments: {
      ...validPlan.experiments,
      baselines: [{ name: "基线一", evidence_id: "ev_missing" }, ...validPlan.experiments.baselines.slice(1)],
    },
    results: {
      ...validPlan.results,
      feasibility_argument: "可行",
      expected_outcomes: [{ metric: "不存在的指标", statement: "预期结果" }],
    },
  } as unknown as ResearchPlan;

  const issues = researchPlanQualityIssues(plan);

  assert.match(issues.join("\n"), /可行性论证/);
  assert.match(issues.join("\n"), /基线一/);
  assert.match(issues.join("\n"), /不存在的指标/);
  assert.equal(issues.length, 3);
});

test("ResearchPlan 预测必须覆盖选中候选且步骤可连续执行", () => {
  const valid = researchPlanExecutionIssues(
    validPlan as unknown as ResearchPlan,
    new Set(["candidate-1"]),
    "candidate-1",
  );
  assert.deepEqual(valid, []);

  const invalid = researchPlanExecutionIssues(
    {
      ...validPlan,
      execution_plan: {
        ...validPlan.execution_plan,
        predictions: [{ ...validPlan.execution_plan.predictions[0], candidate_id: "unknown" }],
        steps: [
          { ...validPlan.execution_plan.steps[0], order: 1 },
          { ...validPlan.execution_plan.steps[1], order: 3 },
        ],
      },
    } as unknown as ResearchPlan,
    new Set(["candidate-1"]),
    "candidate-1",
  );
  assert.match(invalid.join("\n"), /不存在的候选/);
  assert.match(invalid.join("\n"), /覆盖选中的候选/);
  assert.match(invalid.join("\n"), /连续编号/);
});
