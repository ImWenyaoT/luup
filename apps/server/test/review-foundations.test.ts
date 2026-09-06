import assert from "node:assert/strict";
import { test } from "vitest";

import {
  reviewCanAccept,
  reviewFoundationCheckSchema,
  reviewFoundationChecksSchema,
  reviewFoundationPathIssues,
  type ReviewFoundationChecks,
} from "../src/agent/review-foundations.ts";

function allPass(): ReviewFoundationChecks {
  const check = () => ({ verdict: "pass" as const, reason: "核对该字段后未发现根基缺陷。", plan_paths: ["methods"] });
  return {
    premise: check(),
    falsifiability: check(),
    evidence_support: check(),
    executability: check(),
    citation_relevance: check(),
  };
}

test("acceptance requires all five explicit passes and preserves model rejection", () => {
  assert.equal(reviewCanAccept({ accepted: true, foundation_checks: allPass() }), true);
  assert.equal(reviewCanAccept({ accepted: false, foundation_checks: allPass() }), false);
  assert.equal(reviewCanAccept({ accepted: true }), false);
  assert.equal(reviewCanAccept({ accepted: true, foundation_checks: null }), false);
  for (const key of Object.keys(allPass()) as (keyof ReviewFoundationChecks)[]) {
    const checks = allPass();
    checks[key].verdict = "fail";
    assert.equal(reviewCanAccept({ accepted: true, foundation_checks: checks }), false, key);
    const missing: Record<string, unknown> = { ...allPass() };
    delete missing[key];
    assert.equal(reviewCanAccept({ accepted: true, foundation_checks: missing }), false, key);
  }
});

test("v10 recognized scientific failures cannot be overridden by accepted true", () => {
  const cases = [
    ["premise", "把流体动力学 kick 当成总观测速度。", "technical_details"],
    ["executability", "嵌套模型的训练似然正差不构成分量检出。", "execution_plan.analysis[0].decision_rule"],
    [
      "falsifiability",
      "同参数支持规则与跨参数证伪规则可同时成立。",
      "execution_plan.predictions[0].falsification_criterion",
    ],
  ] as const;
  const plan = {
    technical_details: "流体动力学模型",
    execution_plan: {
      analysis: [{ decision_rule: "似然增加" }],
      predictions: [{ falsification_criterion: "存在竞争参数" }],
    },
    methods: "方法",
  };
  for (const [key, reason, path] of cases) {
    const checks = allPass();
    checks[key] = { verdict: "fail", reason, plan_paths: [path] };
    assert.deepEqual(reviewFoundationPathIssues(checks, plan), []);
    assert.equal(reviewCanAccept({ accepted: true, foundation_checks: checks }), false);
  }
});

test("checks require nonblank explanations and paths, exact keys, and legal verdicts", () => {
  for (const patch of [
    { reason: "  " },
    { plan_paths: [] },
    { plan_paths: ["  "] },
    { verdict: "unknown" },
    { extra: true },
  ]) {
    assert.equal(reviewFoundationCheckSchema.safeParse({ ...allPass().premise, ...patch }).success, false);
  }
  assert.equal(reviewFoundationChecksSchema.safeParse({ ...allPass(), extra: allPass().premise }).success, false);
});

test("paths resolve concrete JSON values including null, false, zero and nested arrays", () => {
  const checks = allPass();
  checks.premise.plan_paths = ["methods", "nested.value", "nested.flag", "nested.zero", "rows[0][1].name"];
  assert.deepEqual(
    reviewFoundationPathIssues(checks, {
      methods: "",
      nested: { value: null, flag: false, zero: 0 },
      rows: [[null, { name: "" }]],
    }),
    [],
  );
});

test("paths reject missing fields, array metadata, syntax tricks and prototype traversal", () => {
  const paths = [
    "missing",
    "rows[1]",
    "rows.length",
    "rows[-1]",
    "rows[01]",
    "rows[*]",
    "rows.0",
    "methods.name",
    "nil.name",
    "void",
    "methods.",
    "$",
    "$.methods",
    "nested.toString",
    "__proto__.value",
    "nested.constructor",
    "nested.prototype",
    'nested["value"]',
  ];
  const checks = allPass();
  checks.premise.plan_paths = paths;
  const issues = reviewFoundationPathIssues(checks, {
    methods: "text",
    rows: [1],
    nil: null,
    void: undefined,
    nested: {},
  });
  assert.equal(issues.length, paths.length);
  for (const path of paths)
    assert.ok(
      issues.some((issue) => issue.endsWith(`: ${path}`)),
      path,
    );
  assert.equal(reviewFoundationPathIssues(allPass(), null).length, 5);
});
