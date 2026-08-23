import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { SubagentLineage } from "./subagent-lineage";
import type { Snapshot } from "./types";

test("subagent lineage exposes parent, role identity, mode and terminal reason", () => {
  const snapshot = {
    id: "run_1",
    question: "如何检验候选假设？",
    status: "failed",
    current_role: null,
    version: 9,
    error_code: "infra_timeout",
    final_artifact_id: null,
    attempts: [],
    subagents: [
      {
        id: "attempt_1",
        parent_run_id: "run_1",
        role: "researcher",
        ordinal: 1,
        mode: "one-shot",
        status: "failed",
        stop_reason: "infra_timeout",
        started_at: "2026-08-21T00:00:00.000Z",
        finished_at: "2026-08-21T00:00:01.000Z",
      },
    ],
    tool_evidence: [],
    artifacts: [],
    recent_events: [],
  } satisfies Snapshot;

  const html = renderToStaticMarkup(<SubagentLineage snapshot={snapshot} />);
  expect(html).toContain("控制面");
  expect(html).toContain("run_1");
  expect(html).toContain("检索证据");
  expect(html).toContain("one-shot");
  expect(html).toContain("infra_timeout");
});
