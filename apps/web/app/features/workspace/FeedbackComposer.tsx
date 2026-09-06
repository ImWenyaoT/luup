import styled from "@emotion/styled";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { submitFeedback } from "../../lib/api/runs";
import type { Snapshot } from "../../lib/types/wire";
import { useApiClient } from "../../providers/api";
import { Button, colors, Input, SectionTitle, Textarea } from "../../styles";

const Section = styled.section`
  display: grid;
  gap: 9px;
`;
const Note = styled.p<{ tone?: "ok" | "error" }>`
  margin: 0;
  color: ${({ tone }) => (tone === "error" ? colors.danger : tone === "ok" ? colors.success : colors.muted)};
  font-size: 12px;
`;
export function FeedbackComposer({ snapshot, onSubmitted }: { snapshot: Snapshot; onSubmitted: () => void }) {
  const client = useApiClient();
  const firstReviewerRunning = snapshot.attempts.some(
    (a) => a.role === "reviewer" && a.ordinal === 1 && a.status === "running",
  );
  const alreadyQueued = snapshot.recent_events.some(
    (e) => e.kind === "feedback.received" && e.payload.feedback_source === "human",
  );
  const [feedback, setFeedback] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [status, setStatus] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const mutation = useMutation({
    mutationFn: () => submitFeedback(client, snapshot.id, { feedback_id: crypto.randomUUID(), feedback }),
    onSuccess: () => {
      setFeedback("");
      setStatus({ tone: "ok", text: "人工反馈已排队，评审收尾时将终止当前支线，不会自动修订。" });
      onSubmitted();
    },
    onError: (cause) => setStatus({ tone: "error", text: cause instanceof Error ? cause.message : String(cause) }),
  });
  if (!firstReviewerRunning) return null;
  if (alreadyQueued)
    return (
      <Section aria-labelledby="researcher-feedback-title" data-testid="feedback-composer-queued">
        <SectionTitle id="researcher-feedback-title">研究者反馈</SectionTitle>
        <Note>人工反馈已排队，评审收尾时将终止当前支线，不会自动修订。</Note>
      </Section>
    );
  const submitting = mutation.isPending;
  return (
    <Section aria-labelledby="researcher-feedback-title" data-testid="feedback-composer">
      <SectionTitle id="researcher-feedback-title">研究者反馈</SectionTitle>
      <Textarea
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
        placeholder="指出计划需要修订的具体内容"
        rows={2}
        maxLength={2000}
        disabled={submitting}
      />
      <Input
        aria-label="API token"
        type="password"
        value={apiToken}
        onChange={(e) => setApiToken(e.target.value)}
        placeholder="API token（确定性本地模式可留空）"
        autoComplete="off"
        disabled={submitting}
      />
      <Button
        tone="primary"
        onClick={() => {
          setStatus(null);
          mutation.mutate();
        }}
        disabled={submitting || !feedback.trim()}
      >
        {submitting ? "正在提交…" : "提交人工反馈"}
      </Button>
      {status && <Note tone={status.tone}>{status.text}</Note>}
    </Section>
  );
}
