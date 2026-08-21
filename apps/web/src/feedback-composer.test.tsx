import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { FeedbackComposer } from "./feedback-composer";
import type { Snapshot } from "./types";

function snapshot(status: "running" | "completed" = "running"): Snapshot {
  return {
    id: "r1",
    question: "q",
    status,
    current_role: status === "running" ? "reviewer" : null,
    version: 1,
    error_code: null,
    final_artifact_id: null,
    attempts:
      status === "running"
        ? [
            {
              id: "a1",
              role: "reviewer",
              ordinal: 1,
              status: "running",
              corrections: 0,
              failure_code: null,
              started_at: "t",
              finished_at: null,
            },
          ]
        : [],
    subagents: [],
    tool_evidence: [],
    artifacts: [],
    recent_events: [],
  };
}

test("shows the researcher feedback form only while the first reviewer is running", () => {
  const running = renderToStaticMarkup(<FeedbackComposer snapshot={snapshot()} onSubmitted={() => undefined} />);
  expect(running).toContain("研究者反馈");
  expect(running).toContain("提交人工反馈");
  expect(
    renderToStaticMarkup(<FeedbackComposer snapshot={snapshot("completed")} onSubmitted={() => undefined} />),
  ).toBe("");
});

test("shows a durable queued status instead of accepting a duplicate", () => {
  const queued = snapshot();
  queued.recent_events.push({
    id: 2,
    version: 2,
    kind: "feedback.received",
    payload: { feedback_source: "human" },
    created_at: "t",
  });
  const html = renderToStaticMarkup(<FeedbackComposer snapshot={queued} onSubmitted={() => undefined} />);
  expect(html).toContain("人工反馈已排队，将进入下一轮修订。");
  expect(html).not.toContain("提交人工反馈");
});
