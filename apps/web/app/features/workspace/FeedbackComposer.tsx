import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import { submitFeedback } from "../../lib/api/runs";
import type { Snapshot } from "../../lib/types/wire";
import { useApiClient } from "../../providers/api";

export function FeedbackComposer({ snapshot, onSubmitted }: { snapshot: Snapshot; onSubmitted: () => void }) {
  const client = useApiClient();
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
      return submitFeedback(client, snapshot.id, {
        feedback_id: crypto.randomUUID(),
        feedback,
      });
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
      <section aria-labelledby="researcher-feedback-title" data-testid="feedback-composer-queued">
        <h2 id="researcher-feedback-title" className="font-mono text-xs uppercase tracking-widest text-neutral-500">
          研究者反馈
        </h2>
        <p className="text-xs text-neutral-500">人工反馈已排队，将进入下一轮修订。</p>
      </section>
    );
  }

  const submitting = feedbackMutation.isPending;

  return (
    <section className="space-y-2" aria-labelledby="researcher-feedback-title" data-testid="feedback-composer">
      <h2 id="researcher-feedback-title" className="font-mono text-xs uppercase tracking-widest text-neutral-500">
        研究者反馈
      </h2>
      <textarea
        value={feedback}
        onChange={(event) => setFeedback(event.target.value)}
        placeholder="指出计划需要修订的具体内容"
        rows={2}
        maxLength={2_000}
        disabled={submitting}
        className="w-full rounded border border-neutral-300 px-2 py-1 text-sm"
      />
      <input
        aria-label="API token"
        type="password"
        value={apiToken}
        onChange={(event) => setApiToken(event.target.value)}
        placeholder="API token（确定性本地模式可留空）"
        autoComplete="off"
        className="h-9 w-full border border-neutral-300 bg-transparent px-3 py-1 text-sm"
        disabled={submitting}
      />
      <button
        type="button"
        onClick={() => {
          setStatus(null);
          feedbackMutation.mutate();
        }}
        disabled={submitting || feedback.trim() === ""}
        className="rounded bg-neutral-900 px-3 py-1 text-sm text-white disabled:opacity-50"
      >
        {submitting ? "正在提交…" : "提交人工反馈"}
      </button>
      {status !== null && (
        <p className={`text-xs ${status.tone === "error" ? "text-red-600" : "text-emerald-600"}`}>{status.text}</p>
      )}
    </section>
  );
}
