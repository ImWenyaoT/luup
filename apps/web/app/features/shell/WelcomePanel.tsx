import { useState } from "react";

import type { Science125Question } from "../../lib/types/wire";

const SUGGESTIONS = [
  { id: 61, label: "#61 脉冲星形成", text: "How are pulsars formed?" },
  { id: 2, label: "#2 黎曼猜想", text: "Is the Riemann hypothesis true?" },
  { id: 10, label: "#10 AI重塑化学", text: "Will AI redefine the future of chemistry?" },
  { id: 13, label: "#13 预测下一场大流行", text: "Can we predict the next pandemic?" },
] as const;

export type WelcomePanelProps = {
  onStartResearch: (question: string) => Promise<void>;
  disabled?: boolean;
  selectedQuestion?: Science125Question | null;
};

export function WelcomePanel({ onStartResearch, disabled, selectedQuestion }: WelcomePanelProps) {
  const [question, setQuestion] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (override?: string) => {
    const trimmed = (override ?? question).trim();
    if (!trimmed || submitting || disabled) return;
    setSubmitting(true);
    setError(null);
    try {
      await onStartResearch(trimmed);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSubmitting(false);
    }
  };

  const busy = submitting || disabled;

  return (
    <div className="mx-auto max-w-2xl space-y-6 py-8" data-testid="welcome-panel">
      <div className="text-center space-y-2">
        <h2 className="font-mono text-3xl font-bold tracking-tight sm:text-4xl">AI Scientist</h2>
        <p className="text-sm text-neutral-600 leading-relaxed">
          面向《Science》125 个前沿科学问题的科研 Agent 流水线。证据由代码冻结，模型只能引用。
        </p>
      </div>

      <div className="flex flex-wrap justify-center gap-1.5 pt-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            data-testid={`quick-question-${s.id}`}
            className="rounded-full border border-neutral-300 bg-neutral-50 px-3 py-1 text-xs text-neutral-600 hover:border-neutral-400 hover:bg-white disabled:opacity-50"
            onClick={() => void handleSubmit(s.text)}
            disabled={busy}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="space-y-2 pt-2 text-left">
        <div className="flex items-center justify-between px-1">
          <span className="font-mono text-[11px] font-medium text-neutral-500">
            {selectedQuestion ? `已选 #${selectedQuestion.id} · ${selectedQuestion.domain}` : "研究课题输入"}
          </span>
          {question && <span className="font-mono text-[10px] text-neutral-500">{question.length} 字符</span>}
        </div>

        <div className="flex items-end gap-2">
          <textarea
            data-testid="welcome-question-input"
            className="min-h-[64px] flex-1 resize-none rounded-lg border border-neutral-300 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-neutral-400"
            placeholder="提出一个可以设计实验去检验的研究问题"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            rows={3}
            disabled={busy}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && !busy && question.trim()) {
                event.preventDefault();
                void handleSubmit();
              }
            }}
          />
          <button
            type="button"
            data-testid="start-research"
            className="h-[64px] min-w-[88px] shrink-0 rounded-lg bg-neutral-900 px-4 text-xs font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
            onClick={() => void handleSubmit()}
            disabled={!question.trim() || busy}
          >
            {busy ? "运行中…" : "开始研究"}
          </button>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </div>
  );
}
