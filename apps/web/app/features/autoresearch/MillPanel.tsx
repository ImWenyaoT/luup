"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@astryxdesign/core/Button";
import { TextInput } from "@astryxdesign/core/TextInput";
import { NumberInput } from "@astryxdesign/core/NumberInput";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { Badge } from "@astryxdesign/core/Badge";
import { Card } from "@astryxdesign/core/Card";
import { VStack, HStack, StackItem } from "@astryxdesign/core/Stack";
import { Banner } from "@astryxdesign/core/Banner";

import { getMillStatus, startMill, stopMill, type MillSnapshot } from "../../lib/api/mill";
import { useApiClient } from "../../providers/api";

export type MillPanelProps = {
  onPapersChange?: (titles: string[]) => void;
};

export function MillPanel({ onPapersChange }: MillPanelProps) {
  const api = useApiClient();
  const [topic, setTopic] = useState("open scientific frontiers");
  const [seed, setSeed] = useState("What is a high-leverage near-term experiment worth running?");
  const [targetPapers, setTargetPapers] = useState(3);
  const [maxTickets, setMaxTickets] = useState(12);
  const [snap, setSnap] = useState<MillSnapshot>({ status: "idle" });
  const [error, setError] = useState<string | null>(null);
  const running = snap.status === "running";

  useEffect(() => {
    let cancelled = false;
    const pull = async () => {
      try {
        const next = await getMillStatus(api);
        if (!cancelled) {
          setSnap(next);
          onPapersChange?.(next.papers?.map((p) => p.title) ?? []);
        }
      } catch {
        /* idle until first successful poll */
      }
    };
    void pull();
    const id = setInterval(() => void pull(), running ? 1500 : 4000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [api, running, onPapersChange]);

  async function onStart(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const next = await startMill(api, {
        topic: topic.trim(),
        seedQuestions: seed
          .split(/\n+/)
          .map((line) => line.trim())
          .filter(Boolean),
        targetPapers,
        maxTickets,
      });
      setSnap(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function onStop() {
    setError(null);
    try {
      setSnap(await stopMill(api));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const quantity = snap.quantity;

  return (
    <Card padding={4}>
      <VStack gap={3}>
        <HStack gap={3} vAlign="center">
          <StackItem size="fill">
            <Heading level={3}>Research Mill · 永动机</Heading>
          </StackItem>
          <Badge label={snap.status} />
        </HStack>

        <form onSubmit={(e) => void onStart(e)}>
          <VStack gap={3}>
            <TextInput label="Topic" value={topic} onChange={(value) => setTopic(value)} isDisabled={running} />
            <TextInput label="Seed question" value={seed} onChange={(value) => setSeed(value)} isDisabled={running} />
            <HStack gap={3}>
              <StackItem size="fill">
                <NumberInput
                  label="Target papers"
                  value={targetPapers}
                  onChange={(value) => setTargetPapers(value)}
                  isDisabled={running}
                  min={1}
                />
              </StackItem>
              <StackItem size="fill">
                <NumberInput
                  label="Max tickets"
                  value={maxTickets}
                  onChange={(value) => setMaxTickets(value)}
                  isDisabled={running}
                  min={1}
                />
              </StackItem>
            </HStack>
            <HStack gap={2}>
              {running ? (
                <Button label="停止战役" variant="secondary" onClick={() => void onStop()} />
              ) : (
                <Button label="启动永动机" variant="primary" type="submit" />
              )}
            </HStack>
          </VStack>
        </form>

        {quantity ? (
          <Text size="sm" color="secondary">
            产量 {quantity.papersProduced} / {quantity.targetPapers}
            {quantity.ok ? " · gate ok" : ""}
            {" · "}
            Tickets {snap.ticketsStarted ?? 0} / {snap.maxTickets ?? "—"}
          </Text>
        ) : null}

        {error ? <Banner status="error" title={error} /> : null}

        {snap.papers && snap.papers.length > 0 ? (
          <VStack gap={2}>
            {snap.papers.map((paper) => (
              <Card key={paper.id} variant="muted" padding={3}>
                <VStack gap={1}>
                  <Text weight="semibold">{paper.title}</Text>
                  <Text size="sm" color="secondary">
                    {paper.id} · {paper.evidenceIds.length} evidence
                  </Text>
                </VStack>
              </Card>
            ))}
          </VStack>
        ) : null}
      </VStack>
    </Card>
  );
}
