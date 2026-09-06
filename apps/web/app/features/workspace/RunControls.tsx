"use client";

import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import styled from "@emotion/styled";
import { cancelRun, submitInstruction, type InstructionReceipt, type RunInstruction } from "../../lib/api/runs";
import { ROLE_LABEL, ROLE_ORDER } from "../../lib/types/constants";
import type { Role, Snapshot } from "../../lib/types/wire";
import { useApiClient } from "../../providers/api";
import { Button, colors, SectionTitle, Surface, Textarea } from "../../styles";

const Panel = styled(Surface)`
  display: grid;
  gap: 12px;
  padding: 16px;
  p {
    margin: 0;
    font-size: 12px;
    color: ${colors.muted};
  }
  select {
    width: 100%;
    max-width: 320px;
    padding: 8px;
    border: 1px solid ${colors.border};
    border-radius: 8px;
    background: ${colors.surface};
    color: ${colors.ink};
  }
  details > div {
    display: grid;
    gap: 10px;
    margin-top: 12px;
  }
  summary {
    cursor: pointer;
    font-size: 12px;
  }
  ul {
    margin: 0;
    padding-left: 20px;
    font-size: 12px;
  }
`;
const Row = styled.div`
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 8px;
  align-items: center;
`;
const RECEIPT_LABEL = { queued: "已排队，等待角色启动", applied: "已应用到角色", discarded: "已丢弃，未应用" } as const;

export function RunControls({ snapshot, onRefetch }: { snapshot: Snapshot; onRefetch: () => void }) {
  const client = useApiClient();
  const [role, setRole] = useState<Role | "">("");
  const [instruction, setInstruction] = useState("");
  const [instructionOpen, setInstructionOpen] = useState(false);
  const [receipts, setReceipts] = useState<InstructionReceipt[]>([]);
  const [stopStatus, setStopStatus] = useState<"stopping" | "settled" | null>(null);
  const draft = useRef<RunInstruction | null>(null);
  const inFlight = useRef(false);
  const history = new Map(receipts.map((item) => [item.instruction_id, item]));
  for (const event of snapshot.recent_events) {
    if (!event.kind.startsWith("harness.instruction_")) continue;
    const status = event.kind.replace("harness.instruction_", "");
    const { instruction_id, role: target } = event.payload;
    if (
      (status === "queued" || status === "applied" || status === "discarded") &&
      typeof instruction_id === "string" &&
      ROLE_ORDER.includes(target as Role)
    ) {
      if (status !== "queued" || !history.has(instruction_id))
        history.set(instruction_id, { instruction_id, role: target as Role, status });
    }
  }
  const available = ROLE_ORDER.filter(
    (target) =>
      !snapshot.attempts.some((attempt) => attempt.role === target) &&
      ![...history.values()].some((item) => item.role === target),
  );
  const stopping =
    stopStatus !== null || snapshot.recent_events.some((event) => event.kind === "harness.stop_requested");
  const running = snapshot.status === "running";
  const queued =
    snapshot.recent_events.some((event) => event.kind === "harness.queued") &&
    !snapshot.recent_events.some((event) => event.kind === "harness.dispatched");
  const mutation = useMutation({
    mutationFn: async (action: "stop" | "instruct") => {
      if (action === "stop") return { action, value: await cancelRun(client, snapshot.id) } as const;
      const value = { role: role as Role, instruction: instruction.trim() };
      draft.current ??= { ...value, instruction_id: crypto.randomUUID() };
      return { action, value: await submitInstruction(client, snapshot.id, draft.current) } as const;
    },
    retry: false,
    onSuccess: (result) => {
      if (result.action === "stop") setStopStatus(result.value.status);
      else {
        setInstructionOpen(false);
        setInstruction("");
        setRole("");
        draft.current = null;
        setReceipts((current) => [
          ...current.filter((item) => item.instruction_id !== result.value.instruction_id),
          result.value,
        ]);
      }
      onRefetch();
    },
    onSettled: () => {
      inFlight.current = false;
    },
  });
  const canRetry = mutation.isError && mutation.variables === "instruct";
  const send = (action: "stop" | "instruct") => {
    if (inFlight.current) return;
    inFlight.current = true;
    mutation.mutate(action);
  };
  const edited = () => {
    draft.current = null;
    mutation.reset();
  };
  if (!running && !history.size && snapshot.error_code !== "interrupted") return null;
  return (
    <Panel as="section" aria-label="运行控制" data-testid="run-controls">
      <Row>
        <SectionTitle>运行控制</SectionTitle>
        {running && (
          <Button onClick={() => send("stop")} disabled={mutation.isPending || stopping}>
            {stopping ? "正在停止…" : "停止研究"}
          </Button>
        )}
      </Row>
      <p role="status">
        {running
          ? stopping
            ? "正在停止，等待当前工作退出。"
            : queued
              ? "已排队，等待开始研究。"
              : "研究正在运行。"
          : snapshot.error_code === "interrupted"
            ? "已停止，已冻结产物仍可查看。"
            : "运行已结束。"}
      </p>
      {running && !stopping && (
        <details open={instructionOpen} onToggle={(event) => setInstructionOpen(event.currentTarget.open)}>
          <summary>向后续角色追加指令</summary>
          <div>
            <label htmlFor="instruction-role">追加指令的目标角色</label>
            <select
              id="instruction-role"
              value={available.includes(role as Role) || canRetry ? role : ""}
              disabled={mutation.isPending || (available.length === 0 && !canRetry)}
              onChange={(event) => {
                setRole(event.target.value as Role);
                edited();
              }}
            >
              <option value="">{available.length ? "请选择尚未开始的角色" : "没有可追加指令的角色"}</option>
              {canRetry && role && !available.includes(role) && (
                <option value={role} disabled>
                  {ROLE_LABEL[role]}（重试原指令）
                </option>
              )}
              {available.map((target) => (
                <option key={target} value={target}>
                  {ROLE_LABEL[target]}
                </option>
              ))}
            </select>
            <p>仅在所选角色首次启动时生效，不重启当前角色。每个角色只能追加一条；运行提前结束时未应用的指令会丢弃。</p>
            <Textarea
              aria-label="追加指令"
              value={instruction}
              rows={3}
              maxLength={2000}
              disabled={mutation.isPending || (available.length === 0 && !canRetry)}
              onChange={(event) => {
                setInstruction(event.target.value);
                edited();
              }}
            />
            <Button
              onClick={() => send("instruct")}
              disabled={
                mutation.isPending ||
                (!available.includes(role as Role) && !canRetry) ||
                !instruction.trim() ||
                instruction.trim().length > 2000
              }
            >
              {mutation.isPending ? "正在提交…" : "追加指令"}
            </Button>
          </div>
        </details>
      )}
      {history.size > 0 && (
        <ul aria-label="追加指令状态">
          {[...history.values()].map((item) => (
            <li key={item.instruction_id}>
              {ROLE_LABEL[item.role]}：{RECEIPT_LABEL[item.status]}
            </li>
          ))}
        </ul>
      )}
      {mutation.error && <p role="alert">{mutation.error.message}</p>}
    </Panel>
  );
}
