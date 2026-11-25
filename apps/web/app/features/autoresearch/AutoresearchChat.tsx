"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useMemo, useState, type FormEvent } from "react";
import { Layout, LayoutContent, LayoutHeader } from "@astryxdesign/core/Layout";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { Button } from "@astryxdesign/core/Button";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Card } from "@astryxdesign/core/Card";
import { VStack, HStack, StackItem } from "@astryxdesign/core/Stack";
import { Banner } from "@astryxdesign/core/Banner";

import { useApiClient } from "../../providers/api";
import { LuupShell } from "../shell/LuupShell";
import { MillPanel } from "./MillPanel";

function messageText(parts: Array<{ type: string; text?: string }>): string {
  return parts
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("");
}

export function AutoresearchChat() {
  const api = useApiClient();
  const [paperTitles, setPaperTitles] = useState<string[]>([]);
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/autoresearch/chat",
        headers: (): Record<string, string> => {
          const token = api.getToken();
          return token ? { Authorization: `Bearer ${token}` } : {};
        },
      }),
    [api],
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
    <LuupShell active="mill" paperTitles={paperTitles}>
      <Layout
        height="fill"
        header={
          <LayoutHeader hasDivider padding={4}>
            <VStack gap={1}>
              <Heading level={2}>Luup Autoresearch</Heading>
              <Text size="sm" color="secondary">
                ResearchMill 永动机 · Engine 硬闸 · Astryx shell-nav
              </Text>
            </VStack>
          </LayoutHeader>
        }
        content={
          <LayoutContent padding={4}>
            <VStack gap={4}>
              <MillPanel onPapersChange={setPaperTitles} />

              <Card padding={4}>
                <VStack gap={3}>
                  <Heading level={3}>Single-question chat</Heading>
                  <Text size="sm" color="secondary">
                    上面启动连续战役；下面可单次提问。每次 Ticket 仍过森林 Assessor。
                  </Text>

                  <VStack gap={2}>
                    {messages.length === 0 ? (
                      <Card variant="muted" padding={3}>
                        <Text color="secondary">等待问题…</Text>
                      </Card>
                    ) : null}
                    {messages.map((message) => (
                      <Card key={message.id} variant={message.role === "user" ? "blue" : "muted"} padding={3}>
                        <Text>{messageText(message.parts as Array<{ type: string; text?: string }>)}</Text>
                        {message.parts
                          .filter((part) => part.type.startsWith("tool-"))
                          .map((part, index) => (
                            <Text key={`${message.id}-tool-${index}`} size="sm" color="secondary">
                              {part.type.replace(/^tool-/, "")}
                            </Text>
                          ))}
                      </Card>
                    ))}
                    {error ? <Banner status="error" title={error.message} /> : null}
                  </VStack>

                  <form onSubmit={onSubmit}>
                    <HStack gap={2} vAlign="end">
                      <StackItem size="fill">
                        <TextInput
                          label="研究问题"
                          isLabelHidden
                          value={draft}
                          onChange={(value) => setDraft(value)}
                          isDisabled={busy}
                          placeholder="例如：脉冲星形成机制的最新证据是什么？"
                        />
                      </StackItem>
                      {busy ? (
                        <Button label="停止" variant="secondary" onClick={() => void stop()} />
                      ) : (
                        <Button label="研究" variant="primary" type="submit" isDisabled={!draft.trim()} />
                      )}
                    </HStack>
                  </form>
                </VStack>
              </Card>
            </VStack>
          </LayoutContent>
        }
      />
    </LuupShell>
  );
}
