import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import { ArtifactView } from "./artifact-view";
import type { Artifact } from "./types";

test("research-plan view displays every product field", () => {
  const artifact: Artifact = {
    id: "artifact_plan",
    type: "research-plan",
    content: {
      artifact_type: "research-plan",
      problem_statement: "问题陈述",
      rationale: "研究理由",
      technical_details: "技术细节",
      datasets: ["数据集"],
      source: "来源",
      target: "研究目标",
      paper_title: "论文标题",
      paper_abstract: "论文摘要",
      methods: "研究方法",
      experiments: {
        baselines: [
          { name: "基线一", evidence_id: "ev_1" },
          { name: "基线二", evidence_id: "ev_2" },
        ],
        metrics: [
          { name: "指标一", evidence_id: "ev_1" },
          { name: "指标二", evidence_id: "ev_2" },
        ],
        design: "实验设计",
      },
      results: {
        status: "pending_verification",
        validation_basis: "formula_derivation",
        feasibility_argument: "在固定指标和预设判断规则下，用指标关系推导实验设计可行。",
        expected_outcomes: [{ metric: "指标一", statement: "预期结果" }],
      },
      references: ["https://example.com/paper"],
    },
  };

  const html = renderToStaticMarkup(createElement(ArtifactView, { artifact }));
  for (const value of [
    "问题陈述",
    "研究理由",
    "技术细节",
    "数据集",
    "来源",
    "研究目标",
    "论文标题",
    "论文摘要",
    "研究方法",
    "基线一",
    "指标一",
    "实验设计",
    "pending_verification",
    "formula_derivation",
    "在固定指标和预设判断规则下，用指标关系推导实验设计可行。",
    "预期结果",
    "https://example.com/paper",
  ]) {
    expect(html).toContain(value);
  }
});

test("review view displays the independent evidence binding", () => {
  const artifact: Artifact = {
    id: "artifact_review",
    type: "review",
    content: {
      artifact_type: "review",
      accepted: true,
      independent_evidence_ids: ["ev_reviewer_01_arxiv"],
      scores: { scientific_value: 4, technical_depth: 4, application_potential: 4 },
      weaknesses: [],
      feedback: [],
    },
  };

  const html = renderToStaticMarkup(createElement(ArtifactView, { artifact }));
  expect(html).toContain("ev_reviewer_01_arxiv");
});
