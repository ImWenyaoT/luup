import styled from "@emotion/styled";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from "react";
import type { Science125Question } from "../../lib/types/wire";
import { Button, colors, mono, Surface, Textarea } from "../../styles";

export type ResearchQuestionInputVariant = "welcome" | "footer";

export type ResearchQuestionInputProps = {
  variant: ResearchQuestionInputVariant;
  onSubmit: (question: string) => Promise<void>;
  disabled?: boolean;
  selectedQuestion?: Science125Question | null;
  /** Clear textarea after a successful submit (footer default). */
  clearOnSuccess?: boolean;
  onBusyChange?: (busy: boolean) => void;
};

export type ResearchQuestionInputHandle = {
  submit: (override?: string) => Promise<void>;
};

const FooterBar = styled.div`
  flex: none;
  border-top: 1px solid ${colors.border};
  background: rgba(255, 255, 255, 0.96);
  padding: 12px 16px;
  @media (max-width: 700px) {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 20;
    padding: 8px;
  }
`;

const FooterInner = styled.div`
  max-width: 980px;
  margin: 0 auto;
  display: grid;
  gap: 6px;
`;

const WelcomeComposer = styled(Surface)`
  padding: 14px;
  box-shadow: 0 14px 40px rgba(16, 24, 40, 0.06);
`;

const WelcomeMeta = styled.div`
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
  color: ${colors.muted};
  font-family: ${mono};
  font-size: 10px;
`;

const WelcomeRow = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
  align-items: end;
  @media (max-width: 560px) {
    grid-template-columns: 1fr;
  }
`;

const FooterMeta = styled.div`
  display: flex;
  justify-content: space-between;
  color: ${colors.muted};
  font: 10px ${mono};
`;

const FooterRow = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  align-items: end;
  textarea {
    min-height: 52px;
  }
  @media (max-width: 520px) {
    button {
      min-width: 84px;
    }
  }
`;

function metaLabel(variant: ResearchQuestionInputVariant, selectedQuestion?: Science125Question | null): string {
  if (selectedQuestion) return `已选 #${selectedQuestion.id} · ${selectedQuestion.domain}`;
  return variant === "welcome" ? "研究课题输入" : "追加研究课题或问题";
}

export const ResearchQuestionInput = forwardRef<ResearchQuestionInputHandle, ResearchQuestionInputProps>(
  function ResearchQuestionInput(
    { variant, onSubmit, disabled, selectedQuestion, clearOnSuccess = variant === "footer", onBusyChange },
    ref,
  ) {
    const [question, setQuestion] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const busy = submitting || Boolean(disabled);

    useEffect(() => {
      if (selectedQuestion) setQuestion(selectedQuestion.question);
    }, [selectedQuestion]);

    useEffect(() => {
      onBusyChange?.(busy);
    }, [busy, onBusyChange]);

    const handleSubmit = useCallback(
      async (override?: string) => {
        const value = (override ?? question).trim();
        if (!value || submitting || disabled) return;
        setSubmitting(true);
        try {
          await onSubmit(value);
          if (clearOnSuccess) setQuestion("");
        } finally {
          setSubmitting(false);
        }
      },
      [clearOnSuccess, disabled, onSubmit, question, submitting],
    );

    useImperativeHandle(ref, () => ({ submit: handleSubmit }), [handleSubmit]);

    const meta = (
      <>
        <span>{metaLabel(variant, selectedQuestion)}</span>
        {question && <span>{question.length} 字符</span>}
      </>
    );

    const field = (
      <>
        <Textarea
          data-testid="welcome-question-input"
          placeholder="提出一个可以设计实验去检验的研究问题"
          value={question}
          rows={variant === "welcome" ? 3 : 2}
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
          type="button"
          data-testid="start-research"
          onClick={() => void handleSubmit()}
          disabled={!question.trim() || busy}
          style={variant === "welcome" ? { minHeight: 72 } : undefined}
        >
          {busy ? "运行中…" : "开始研究"}
        </Button>
      </>
    );

    if (variant === "footer") {
      return (
        <FooterBar>
          <FooterInner>
            <FooterMeta>{meta}</FooterMeta>
            <FooterRow>{field}</FooterRow>
          </FooterInner>
        </FooterBar>
      );
    }

    return (
      <WelcomeComposer>
        <WelcomeMeta>{meta}</WelcomeMeta>
        <WelcomeRow>{field}</WelcomeRow>
      </WelcomeComposer>
    );
  },
);
