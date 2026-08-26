import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import type { Artifact } from "../../lib/types/wire";
import { ArtifactView } from "./ArtifactView";

describe("ArtifactView hypothesis", () => {
  test("hypothesis 与 evidence-review 类型", () => {
    const hypothesis: Artifact = {
      id: "h1",
      type: "hypothesis",
      content: {
        artifact_type: "hypothesis",
        question: "问题？",
        candidates: [
          {
            candidate_id: "c1",
            claim_status: "candidate",
            core_claim: "核心论断",
            basis: "依据",
            supporting_evidence_ids: ["e1"],
            opposing_evidence_ids: [],
            falsifiable_predictions: ["预测"],
            alternative_explanations: [],
            uncertainty: [],
            boundaries: [],
            validation_conditions: [],
          },
        ],
        comparison: {
          criteria: [{ criterion: "标准", rationale: "理由" }],
          evaluations: [
            {
              candidate_id: "c1",
              rank: 1,
              strengths: ["强"],
              weaknesses: ["弱"],
              evidence_ids: ["e1"],
              rationale: "评价",
            },
          ],
          selected_candidate_id: "c1",
          selection_rationale: "选中理由",
        },
        selection_status: "candidate_selected",
      },
    };

    const review: Artifact = {
      id: "er1",
      type: "evidence-review",
      content: {
        artifact_type: "evidence-review",
        assessments: [{ claim: "论断", verdict: "supports" }],
        gaps: [],
      },
    };

    const hHtml = renderToStaticMarkup(createElement(ArtifactView, { artifact: hypothesis }));
    expect(hHtml).toContain("核心论断");
    expect(hHtml).toContain("选中理由");

    const rHtml = renderToStaticMarkup(createElement(ArtifactView, { artifact: review }));
    expect(rHtml).toContain("[supports] 论断");
  });
});
