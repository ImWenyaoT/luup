import type { Snapshot } from "./types";

function text(payload: Record<string, string | number | boolean | null>, key: string): string {
  const value = payload[key];
  return value === null || value === undefined ? "" : String(value);
}

export function FeedbackHistory({ snapshot }: { snapshot: Snapshot }) {
  const events = snapshot.recent_events.filter(
    (event) =>
      event.kind === "feedback.received" || event.kind === "revision.applied" || event.kind === "evaluation.round",
  );
  if (events.length === 0) return null;

  return (
    <section className="space-y-2" aria-labelledby="feedback-history-title">
      <h2 id="feedback-history-title" className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
        反馈与修订
      </h2>
      <ol className="space-y-1 border-l pl-3 text-xs">
        {events.map((event) =>
          event.kind === "evaluation.round" ? (
            <li key={event.id}>
              <span className="font-medium">第 {text(event.payload, "round")} 轮评价</span>
              <span className="ml-2 text-muted-foreground">
                {text(event.payload, "phase")} · {text(event.payload, "feedback_source")} · rubric{" "}
                {text(event.payload, "rubric_version")}
              </span>
              <div className="font-mono text-[11px] text-muted-foreground">
                score Δ {text(event.payload, "score_delta_total") || "未知"} · token Δ{" "}
                {text(event.payload, "cost_delta_tokens") || "未知"} · limitation Δ{" "}
                {text(event.payload, "limitation_delta_count") || "未知"}
              </div>
              <div className="font-mono text-[11px] text-muted-foreground">
                raw: {text(event.payload, "raw_plan_artifact_id")} / {text(event.payload, "raw_review_artifact_id")}
                {text(event.payload, "stop_reason") && ` · stop: ${text(event.payload, "stop_reason")}`}
                {text(event.payload, "retry_reason") && ` · retry: ${text(event.payload, "retry_reason")}`}
                {text(event.payload, "rollback_reason") && ` · rollback: ${text(event.payload, "rollback_reason")}`}
              </div>
            </li>
          ) : event.kind === "feedback.received" ? (
            <li key={event.id}>
              <span className="font-medium">
                {text(event.payload, "feedback_source") === "human" ? "人工反馈" : "自动反馈"}
              </span>
              <span className="ml-2 text-muted-foreground">
                第 {text(event.payload, "round")} 轮 · {text(event.payload, "action")} · Reviewer
              </span>
              {text(event.payload, "feedback") && (
                <div className="text-muted-foreground">{text(event.payload, "feedback")}</div>
              )}
            </li>
          ) : (
            <li key={event.id}>
              <span className="font-medium">修订</span>
              <span className="ml-2 text-muted-foreground">第 {text(event.payload, "round")} 轮</span>
              <div className="font-mono text-[11px] text-muted-foreground">
                changed: {text(event.payload, "changed_fields") || "无字段变化"}
              </div>
            </li>
          ),
        )}
      </ol>
    </section>
  );
}
