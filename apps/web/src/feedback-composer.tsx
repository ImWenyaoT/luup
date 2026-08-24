import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { submitResearcherFeedback } from "./api";
import type { Snapshot } from "./types";

export function FeedbackComposer({ snapshot, onSubmitted }: { snapshot: Snapshot; onSubmitted: () => void }) {
  const firstReviewerRunning = snapshot.attempts.some(
    (attempt) => attempt.role === "reviewer" && attempt.ordinal === 1 && attempt.status === "running",
  );
  const alreadyQueued = snapshot.recent_events.some(
    (event) => event.kind === "feedback.received" && event.payload.feedback_source === "human",
  );
  const [feedback, setFeedback] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [status, setStatus] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const feedbackMutation = useMutation({
    mutationFn: async () => {
      return submitResearcherFeedback(
        snapshot.id,
        { feedback_id: crypto.randomUUID(), feedback },
        apiToken.trim() || undefined,
      );
    },
    onSuccess: () => {
      setFeedback("");
      setStatus({ tone: "ok", text: "人工反馈已排队，将进入下一轮修订。" });
      onSubmitted();
    },
    onError: (cause) => {
      setStatus({ tone: "error", text: cause instanceof Error ? cause.message : String(cause) });
    },
  });

  if (!firstReviewerRunning) return null;
  if (alreadyQueued) {
    return (
      <section aria-labelledby="researcher-feedback-title">
        <h2
          id="researcher-feedback-title"
          className="font-mono text-xs uppercase tracking-widest text-muted-foreground"
        >
          研究者反馈
        </h2>
        <p className="text-xs text-muted-foreground">人工反馈已排队，将进入下一轮修订。</p>
      </section>
    );
  }

  async function submit() {
    setStatus(null);
    feedbackMutation.mutate();
  }

  const submitting = feedbackMutation.isPending;

  return (
    <section className="space-y-2" aria-labelledby="researcher-feedback-title">
      <h2 id="researcher-feedback-title" className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
        研究者反馈
      </h2>
      <Textarea
        value={feedback}
        onChange={(event) => setFeedback(event.target.value)}
        placeholder="指出计划需要修订的具体内容"
        rows={2}
        maxLength={2_000}
        disabled={submitting}
      />
      <input
        aria-label="API token"
        type="password"
        value={apiToken}
        onChange={(event) => setApiToken(event.target.value)}
        placeholder="API token（确定性本地模式可留空）"
        autoComplete="off"
        className="flex h-9 w-full border border-input bg-transparent px-3 py-1 text-sm"
        disabled={submitting}
      />
      <Button onClick={() => void submit()} disabled={submitting || feedback.trim() === ""} size="sm">
        {submitting ? "正在提交…" : "提交人工反馈"}
      </Button>
      {status !== null && (
        <Alert variant={status.tone === "error" ? "destructive" : "default"}>
          <AlertDescription>{status.text}</AlertDescription>
        </Alert>
      )}
    </section>
  );
}
