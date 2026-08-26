import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import type { Artifact } from "../../lib/types/wire";
import { ArtifactView } from "./ArtifactView";

describe("ArtifactView other types", () => {
  test("research 类型字段", () => {
    const artifact: Artifact = {
      id: "a1",
      type: "research",
      content: {
        artifact_type: "research",
        research_framing: {
          research_object: "对象",
          scope: "范围",
          variables: [{ name: "v", role: "dependent", operationalization: "op" }],
          known: ["已知"],
          controversies: ["争议"],
          unknowns: ["未知"],
          knowledge_gap: "缺口",
          constraints: ["约束"],
        },
        summary: "摘要",
        claims: [{ statement: "论断", evidence_ids: ["e1"] }],
        limitations: ["局限"],
      },
    };
    const html = renderToStaticMarkup(createElement(ArtifactView, { artifact }));
    expect(html).toContain("对象");
    expect(html).toContain("论断");
  });

  test("review rejected 类型", () => {
    const artifact: Artifact = {
      id: "a2",
      type: "review",
      content: {
        artifact_type: "review",
        accepted: false,
        independent_evidence_ids: ["ev-1"],
        scores: { scientific_value: 1, technical_depth: 2, application_potential: 3 },
        weaknesses: ["弱点"],
        feedback: ["反馈"],
      },
    };
    const html = renderToStaticMarkup(createElement(ArtifactView, { artifact }));
    expect(html).toContain("拒绝 (Rejected)");
    expect(html).toContain("弱点");
  });
});
