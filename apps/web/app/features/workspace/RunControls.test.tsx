import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { createApiClient } from "../../lib/api/client";
import type { Snapshot } from "../../lib/types/wire";
import { renderWithProviders } from "../../test-utils";
import { RunControls } from "./RunControls";

const snapshot: Snapshot = {
  id: "run-1",
  question: "q",
  status: "running",
  current_role: null,
  version: 1,
  error_code: null,
  final_artifact_id: null,
  attempts: [],
  subagents: [],
  tool_evidence: [],
  omitted_evidence_count: 0,
  omitted_evidence_tools: [],
  artifacts: [],
  recent_events: [],
};
const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const event = (kind: string, payload: Snapshot["recent_events"][number]["payload"] = {}) => ({
  id: 1,
  version: 1,
  kind,
  payload,
  created_at: "2026-09-05T00:00:00Z",
});

function mount(fetchImpl: typeof fetch, value = snapshot) {
  const refetch = vi.fn();
  const view = renderWithProviders(<RunControls snapshot={value} onRefetch={refetch} />, {
    client: createApiClient({ fetchImpl, getToken: () => "test-token" }),
  });
  return { ...view, refetch };
}

test("停止请求只发送一次并等待实际终态", async () => {
  let finish!: (value: Response) => void;
  const fetchImpl = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  const view = mount(fetchImpl, { ...snapshot, recent_events: [event("harness.queued")] });
  expect(screen.getByRole("status")).toHaveTextContent("已排队");
  fireEvent.click(screen.getByRole("button", { name: "停止研究" }));
  fireEvent.click(screen.getByRole("button", { name: "停止研究" }));
  await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
  await act(async () => finish(response({ status: "stopping" })));
  expect(screen.getByRole("button", { name: "正在停止…" })).toBeDisabled();
  expect(view.refetch).toHaveBeenCalledTimes(1);
  view.rerender(
    <RunControls snapshot={{ ...snapshot, status: "failed", error_code: "interrupted" }} onRefetch={view.refetch} />,
  );
  expect(screen.getByRole("status")).toHaveTextContent("已停止");
  expect(screen.queryByRole("button", { name: "停止研究" })).not.toBeInTheDocument();
});

test("指令失败重试沿用ID，编辑后换ID，成功后不能再次追加到同一角色", async () => {
  const bodies: Array<{ instruction_id: string; role: string; instruction: string }> = [];
  const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof init?.body !== "string") throw new Error("Expected JSON request body");
    const body = JSON.parse(init.body);
    bodies.push(body);
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-token");
    return bodies.length < 3 ? response({ detail: "暂时无法确认" }, 500) : response({ ...body, status: "queued" });
  });
  mount(fetchImpl);
  fireEvent.click(screen.getByText("向后续角色追加指令"));
  fireEvent.change(screen.getByLabelText("追加指令的目标角色"), { target: { value: "research-plan" } });
  fireEvent.change(screen.getByRole("textbox", { name: "追加指令" }), { target: { value: "加强对照" } });
  fireEvent.click(screen.getByRole("button", { name: "追加指令" }));
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "追加指令" }));
  await waitFor(() => expect(bodies).toHaveLength(2));
  await waitFor(() => expect(screen.getByRole("button", { name: "追加指令" })).toBeEnabled());
  expect(bodies[1].instruction_id).toBe(bodies[0].instruction_id);
  fireEvent.change(screen.getByRole("textbox", { name: "追加指令" }), { target: { value: "增加新对照" } });
  fireEvent.click(screen.getByRole("button", { name: "追加指令" }));
  await screen.findByText(/已排队，等待角色启动/);
  expect(bodies[2].instruction_id).not.toBe(bodies[1].instruction_id);
  fireEvent.click(screen.getByText("向后续角色追加指令"));
  expect(screen.getByRole("button", { name: "追加指令" })).toBeDisabled();
  expect(screen.queryByRole("option", { name: "研究计划" })).not.toBeInTheDocument();
});

test("已开始角色不可选择，排队指令随着事件显示应用与丢弃", () => {
  const value: Snapshot = {
    ...snapshot,
    attempts: [
      {
        id: "a",
        role: "researcher",
        ordinal: 1,
        status: "running",
        corrections: 0,
        failure_code: null,
        started_at: "2026-09-05",
        finished_at: null,
      },
    ],
    recent_events: [
      event("harness.dispatched"),
      event("harness.instruction_applied", { instruction_id: "i1", role: "research-plan" }),
      event("harness.instruction_discarded", { instruction_id: "i2", role: "reviewer" }),
    ],
  };
  mount(vi.fn(), value);
  fireEvent.click(screen.getByText("向后续角色追加指令"));
  expect(screen.getByRole("status")).toHaveTextContent("正在运行");
  expect(screen.queryByRole("option", { name: "检索证据" })).not.toBeInTheDocument();
  expect(screen.getByText(/已应用到角色/)).toBeInTheDocument();
  expect(screen.getByText(/已丢弃，未应用/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "追加指令" })).toBeDisabled();
});

test("stop_requested 事件立即禁用控制，停止失败可见且可重试", async () => {
  const view = mount(vi.fn(async () => response({ detail: "无法停止" }, 500)));
  fireEvent.click(screen.getByRole("button", { name: "停止研究" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("无法停止");
  expect(screen.getByRole("button", { name: "停止研究" })).toBeEnabled();
  view.rerender(
    <RunControls
      snapshot={{ ...snapshot, recent_events: [event("harness.stop_requested")] }}
      onRefetch={view.refetch}
    />,
  );
  expect(screen.getByRole("button", { name: "正在停止…" })).toBeDisabled();
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
});
