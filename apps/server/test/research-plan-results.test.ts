import assert from "node:assert/strict";
import { test } from "vitest";

import { researchPlanSchema, type ResearchPlan } from "../src/agent/contracts.ts";
import { researchPlanQualityIssues } from "../src/agent/plan-quality.ts";

const validPlan = {
  artifact_type: "research-plan",
  problem_statement: "研究问题",
  rationale: "研究理由",
  technical_details: "技术细节",
  datasets: ["数据集"],
  source: "来源",
  target: "研究目标",
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
