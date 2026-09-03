import styled from "@emotion/styled";
import { useRef, useState } from "react";
import type { Science125Question } from "../../lib/types/wire";
import { Button, colors } from "../../styles";
import { ResearchQuestionInput, type ResearchQuestionInputHandle } from "./ResearchQuestionInput";

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

export type WelcomePanelProps = {
  onStartResearch: (question: string) => Promise<void>;
  disabled?: boolean;
  selectedQuestion?: Science125Question | null;
};

export function WelcomePanel({ onStartResearch, disabled, selectedQuestion }: WelcomePanelProps) {
  const inputRef = useRef<ResearchQuestionInputHandle>(null);
  const [inputBusy, setInputBusy] = useState(false);
  const busy = inputBusy || disabled;
  // Errors bubble to parent (research-workspace error-banner); onStartResearch swallows and surfaces there.
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
            onClick={() => void inputRef.current?.submit(s.text)}
            disabled={busy}
          >
            {s.label}
          </Button>
        ))}
      </Suggestions>
      <ResearchQuestionInput
        ref={inputRef}
        variant="welcome"
        onSubmit={onStartResearch}
        disabled={disabled}
        selectedQuestion={selectedQuestion}
        clearOnSuccess={false}
        onBusyChange={setInputBusy}
      />
    </Wrap>
  );
}
