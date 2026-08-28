import styled from "@emotion/styled";
import { useState } from "react";
import type { Science125Question } from "../../lib/types/wire";
import { Button, colors, mono, Surface, Textarea } from "../../styles";

const SUGGESTIONS = [
  { id: 61, label: "#61 脉冲星形成", text: "How are pulsars formed?" },
  { id: 2, label: "#2 黎曼猜想", text: "Is the Riemann hypothesis true?" },
  { id: 10, label: "#10 AI重塑化学", text: "Will AI redefine the future of chemistry?" },
  { id: 13, label: "#13 预测下一场大流行", text: "Can we predict the next pandemic?" },
] as const;
const Wrap = styled.div`
  max-width: 760px;
  margin: 0 auto;
  padding: clamp(32px, 8vh, 92px) 0;
`;
const Intro = styled.div`
  max-width: 620px;
  margin: 0 auto 28px;
  text-align: center;
  h2 {
    margin: 0;
    font-size: clamp(32px, 5vw, 54px);
    line-height: 1.05;
    letter-spacing: -0.05em;
  }
  p {
    margin: 14px auto 0;
    max-width: 560px;
    color: ${colors.muted};
    font-size: 14px;
    line-height: 1.7;
  }
`;
const Suggestions = styled.div`
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 7px;
  margin-bottom: 22px;
`;
const Composer = styled(Surface)`
  padding: 14px;
  box-shadow: 0 14px 40px rgba(16, 24, 40, 0.06);
`;
const ComposerMeta = styled.div`
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
  color: ${colors.muted};
  font-family: ${mono};
  font-size: 10px;
`;
const ComposerRow = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
  align-items: end;
  @media (max-width: 560px) {
    grid-template-columns: 1fr;
  }
`;
export type WelcomePanelProps = {
  onStartResearch: (question: string) => Promise<void>;
  disabled?: boolean;
  selectedQuestion?: Science125Question | null;
};
export function WelcomePanel({ onStartResearch, disabled, selectedQuestion }: WelcomePanelProps) {
  const [question, setQuestion] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = submitting || disabled;
  const handleSubmit = async (override?: string) => {
    const value = (override ?? question).trim();
    if (!value || busy) return;
    setSubmitting(true);
    setError(null);
    try {
      await onStartResearch(value);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <Wrap data-testid="welcome-panel">
      <Intro>
        <h2>AI Scientist</h2>
        <p>面向《Science》125 个前沿科学问题的科研 Agent 流水线。证据由代码冻结，模型只能引用。</p>
      </Intro>
      <Suggestions>
        {SUGGESTIONS.map((s) => (
          <Button
            compact
            key={s.id}
            data-testid={`quick-question-${s.id}`}
            onClick={() => void handleSubmit(s.text)}
            disabled={busy}
          >
            {s.label}
          </Button>
        ))}
      </Suggestions>
      <Composer>
        <ComposerMeta>
          <span>{selectedQuestion ? `已选 #${selectedQuestion.id} · ${selectedQuestion.domain}` : "研究课题输入"}</span>
          {question && <span>{question.length} 字符</span>}
        </ComposerMeta>
        <ComposerRow>
          <Textarea
            data-testid="welcome-question-input"
            placeholder="提出一个可以设计实验去检验的研究问题"
            value={question}
            rows={3}
            disabled={busy}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !busy && question.trim()) {
                e.preventDefault();
                void handleSubmit();
              }
            }}
          />
          <Button
            tone="primary"
            data-testid="start-research"
            onClick={() => void handleSubmit()}
            disabled={!question.trim() || busy}
            style={{ minHeight: 72 }}
          >
            {busy ? "运行中…" : "开始研究"}
          </Button>
        </ComposerRow>
        {error && (
          <p role="alert" style={{ color: colors.danger, fontSize: 12 }}>
            {error}
          </p>
        )}
      </Composer>
    </Wrap>
  );
}
