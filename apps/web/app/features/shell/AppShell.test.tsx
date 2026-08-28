import { fireEvent, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, test, vi } from "vitest";

import { createApiClient } from "../../lib/api/client";
import { renderWithProviders } from "../../test-utils";
import { AppShell } from "./AppShell";

function configResponse(): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => ({
      runtime: "deterministic",
      credential: "absent",
      model_id: "test",
      base_url: "https://example.com",
    }),
  } as unknown as Response;
}

describe("AppShell", () => {
  test("渲染侧边栏与主内容", () => {
    renderWithProviders(
      <AppShell
        runId={null}
        onRunIdChange={vi.fn()}
        onStartResearch={vi.fn()}
        sidebar={<div data-testid="sidebar-content">sidebar</div>}
      >
        <div data-testid="main-content">main</div>
      </AppShell>,
    );

    expect(screen.getByTestId("app-shell")).toBeInTheDocument();
    expect(screen.getByTestId("sidebar-content")).toBeInTheDocument();
    expect(screen.getByTestId("main-content")).toBeInTheDocument();
  });

  test("切换侧边栏可见性", () => {
    renderWithProviders(
      <AppShell runId={null} onRunIdChange={vi.fn()} onStartResearch={vi.fn()} sidebar={<div>sidebar</div>}>
        main
      </AppShell>,
    );

    expect(screen.getByTestId("question-sidebar-panel")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("toggle-sidebar"));
    expect(screen.queryByTestId("question-sidebar-panel")).not.toBeInTheDocument();
  });

  test("同一时间只展示一个二级 Inspector", () => {
    renderWithProviders(
      <AppShell
        runId={null}
        onRunIdChange={vi.fn()}
        onStartResearch={vi.fn()}
        sidebar={<div>题库内容</div>}
        inspectorContent={<div>过程内容</div>}
      >
        main
      </AppShell>,
    );
    expect(screen.getByText("题库内容")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "过程" }));
    expect(screen.queryByText("题库内容")).not.toBeInTheDocument();
    expect(screen.getByText("过程内容")).toBeInTheDocument();
    expect(screen.getAllByTestId(/question-sidebar-panel|workspace-inspector/)).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "产物" }));
    expect(screen.getByRole("heading", { name: "证据与冻结产物" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "轨迹、审计与反馈" })).not.toBeInTheDocument();
    expect(screen.getAllByTestId(/question-sidebar-panel|workspace-inspector/)).toHaveLength(1);
  });

  test("移动 Inspector 管理焦点、Escape 与主区 inert", async () => {
    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    });
    renderWithProviders(
      <AppShell
        runId={null}
        onRunIdChange={vi.fn()}
        onStartResearch={vi.fn()}
        sidebar={<button>题库动作</button>}
        inspectorContent={<button>过程动作</button>}
      >
        <button>主区动作</button>
      </AppShell>,
    );

    const trigger = screen.getByRole("button", { name: "过程" });
    fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "轨迹、审计与反馈" });
    const close = screen.getByRole("button", { name: "关闭轨迹、审计与反馈" });
    await waitFor(() => expect(close).toHaveFocus());
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveAttribute("inert");
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(screen.getByRole("button", { name: "过程动作" })).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(close).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
    Object.defineProperty(window, "matchMedia", { configurable: true, value: originalMatchMedia });
  });

  test("从主画布受控入口打开 Inspector 后恢复焦点", async () => {
    function Harness() {
      const [inspector, setInspector] = useState<"artifacts" | null>(null);
      return (
        <AppShell
          runId={null}
          onRunIdChange={vi.fn()}
          onStartResearch={vi.fn()}
          sidebar={<div>题库</div>}
          inspector={inspector}
          onInspectorChange={(value) => setInspector(value === "artifacts" ? value : null)}
          inspectorContent={<div>产物内容</div>}
        >
          <button onClick={() => setInspector("artifacts")}>查看冻结产物</button>
        </AppShell>
      );
    }
    renderWithProviders(<Harness />);

    const canvasTrigger = screen.getByRole("button", { name: "查看冻结产物" });
    canvasTrigger.focus();
    fireEvent.click(canvasTrigger);
    expect(screen.getByText("产物内容")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "关闭证据与冻结产物" }));

    await waitFor(() => expect(screen.queryByText("产物内容")).not.toBeInTheDocument());
    await waitFor(() => expect(canvasTrigger).toHaveFocus());
  });

  test("打开设置弹窗", async () => {
    const fetchImpl = vi.fn(async () => configResponse());
    const client = createApiClient({ fetchImpl });
    renderWithProviders(
      <AppShell runId={null} onRunIdChange={vi.fn()} onStartResearch={vi.fn()} sidebar={<div>sidebar</div>}>
        main
      </AppShell>,
      { client },
    );

    await waitFor(() => expect(screen.getByTestId("open-settings")).toBeInTheDocument());
    const trigger = screen.getByTestId("open-settings");
    trigger.focus();
    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByTestId("settings-dialog")).toBeInTheDocument());

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("settings-dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
