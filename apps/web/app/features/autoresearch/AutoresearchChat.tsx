"use client";

import styled from "@emotion/styled";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useMemo, useState, type FormEvent } from "react";

import { Button, colors, Input } from "../../styles";

const Shell = styled.main`
  min-height: 100dvh;
  display: grid;
  grid-template-rows: auto 1fr auto;
  background:
    radial-gradient(1200px 600px at 10% -10%, #ececec 0%, transparent 55%),
    radial-gradient(900px 500px at 100% 0%, #e8eee8 0%, transparent 50%), ${colors.canvas};
`;

const Header = styled.header`
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
  padding: 20px 24px 12px;
  border-bottom: 1px solid ${colors.border};
  background: color-mix(in srgb, ${colors.surface} 88%, transparent);
  backdrop-filter: blur(8px);
  h1 {
    margin: 0;
    font-size: 22px;
    letter-spacing: -0.04em;
  }
  p {
    margin: 4px 0 0;
    color: ${colors.muted};
    font-size: 13px;
  }
  a {
    color: ${colors.ink};
    font-size: 13px;
    font-weight: 600;
  }
`;

const Transcript = styled.div`
  overflow: auto;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-width: 880px;
  width: 100%;
  margin: 0 auto;
`;

const Bubble = styled.article<{ role: string }>`
  align-self: ${({ role }) => (role === "user" ? "flex-end" : "stretch")};
  max-width: ${({ role }) => (role === "user" ? "80%" : "100%")};
  padding: ${({ role }) => (role === "user" ? "10px 14px" : "0")};
  border-radius: ${({ role }) => (role === "user" ? "14px" : "0")};
  background: ${({ role }) => (role === "user" ? colors.accent : "transparent")};
  color: ${({ role }) => (role === "user" ? "#fff" : colors.ink)};
  font-size: 14px;
  line-height: 1.65;
  white-space: pre-wrap;
`;

const ToolNote = styled.div`
  margin-top: 8px;
  padding: 8px 10px;
  border-left: 2px solid ${colors.border};
  color: ${colors.muted};
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
`;

const Composer = styled.form`
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 10px;
  padding: 16px 24px 24px;
  max-width: 880px;
  width: 100%;
  margin: 0 auto;
`;

function messageText(parts: Array<{ type: string; text?: string }>): string {
  return parts
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("");
}

export function AutoresearchChat() {
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/autoresearch/chat",
      }),
    [],
  );
  const { messages, sendMessage, status, error, stop } = useChat({ transport });
  const [draft, setDraft] = useState("");
  const busy = status === "submitted" || status === "streaming";

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    void sendMessage({ text });
  }

  return (
    <Shell>
      <Header>
        <div>
          <h1>Luup Autoresearch</h1>
          <p>多 agent 森林编排 · literature / web / critique · AI SDK</p>
        </div>
        <a href="/">Science-125 工作台（legacy）</a>
      </Header>

      <Transcript>
        {messages.length === 0 ? (
          <Bubble role="assistant">
            输入一个开放科研问题。Coordinator 会委派文献与网页子代理检索，再经独立 critique 硬闸后给出可引用报告。
          </Bubble>
        ) : null}
        {messages.map((message) => (
          <Bubble key={message.id} role={message.role}>
            {messageText(message.parts as Array<{ type: string; text?: string }>)}
            {message.parts
              .filter((part) => part.type.startsWith("tool-"))
              .map((part, index) => (
                <ToolNote key={`${message.id}-tool-${index}`}>{part.type.replace(/^tool-/, "")}</ToolNote>
              ))}
          </Bubble>
        ))}
        {error ? <Bubble role="assistant">错误：{error.message}</Bubble> : null}
      </Transcript>

      <Composer onSubmit={onSubmit}>
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="例如：脉冲星形成机制的最新证据是什么？"
          disabled={busy}
          aria-label="研究问题"
        />
        {busy ? (
          <Button type="button" tone="quiet" onClick={() => void stop()}>
            停止
          </Button>
        ) : (
          <Button type="submit" tone="primary" disabled={!draft.trim()}>
            研究
          </Button>
        )}
      </Composer>
    </Shell>
  );
}
