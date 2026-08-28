import styled from "@emotion/styled";
import type { Snapshot } from "../../lib/types/wire";
import { colors, mono, SectionTitle } from "../../styles";
const Section = styled.section`
  display: grid;
  gap: 9px;
`;
const List = styled.ol`
  display: grid;
  gap: 9px;
  margin: 0;
  padding-left: 14px;
  border-left: 1px solid ${colors.border};
  list-style: none;
  font-size: 12px;
`;
const Muted = styled.span`
  margin-left: 7px;
  color: ${colors.muted};
`;
const Technical = styled.div`
  color: ${colors.muted};
  font: 10px/1.55 ${mono};
  overflow-wrap: anywhere;
`;
function text(payload: Record<string, string | number | boolean | null>, key: string) {
  const value = payload[key];
  return value == null ? "" : String(value);
}
export function FeedbackHistory({ snapshot }: { snapshot: Snapshot }) {
  const events = snapshot.recent_events.filter(
    (e) => e.kind === "feedback.received" || e.kind === "revision.applied" || e.kind === "evaluation.round",
  );
  if (!events.length) return null;
  return (
    <Section aria-labelledby="feedback-history-title" data-testid="feedback-history">
      <SectionTitle id="feedback-history-title">反馈与修订</SectionTitle>
      <List>
        {events.map((event) =>
          event.kind === "evaluation.round" ? (
            <li key={event.id}>
              <strong>第 {text(event.payload, "round")} 轮评价</strong>
              <Muted>
                {text(event.payload, "phase")} · {text(event.payload, "feedback_source")} · rubric{" "}
                {text(event.payload, "rubric_version")}
              </Muted>
              <Technical>
                score Δ {text(event.payload, "score_delta_total") || "未知"} · token Δ{" "}
                {text(event.payload, "cost_delta_tokens") || "未知"} · limitation Δ{" "}
                {text(event.payload, "limitation_delta_count") || "未知"}
              </Technical>
              <Technical>
                raw: {text(event.payload, "raw_plan_artifact_id")} / {text(event.payload, "raw_review_artifact_id")}
                {text(event.payload, "stop_reason") && ` · stop: ${text(event.payload, "stop_reason")}`}
                {text(event.payload, "retry_reason") && ` · retry: ${text(event.payload, "retry_reason")}`}
                {text(event.payload, "rollback_reason") && ` · rollback: ${text(event.payload, "rollback_reason")}`}
              </Technical>
            </li>
          ) : event.kind === "feedback.received" ? (
            <li key={event.id}>
              <strong>{text(event.payload, "feedback_source") === "human" ? "人工反馈" : "自动反馈"}</strong>
              <Muted>
                第 {text(event.payload, "round")} 轮 · {text(event.payload, "action")} · Reviewer
              </Muted>
              {text(event.payload, "feedback") && <Technical>{text(event.payload, "feedback")}</Technical>}
            </li>
          ) : (
            <li key={event.id}>
              <strong>修订</strong>
              <Muted>第 {text(event.payload, "round")} 轮</Muted>
              <Technical>changed: {text(event.payload, "changed_fields") || "无字段变化"}</Technical>
            </li>
          ),
        )}
      </List>
    </Section>
  );
}
