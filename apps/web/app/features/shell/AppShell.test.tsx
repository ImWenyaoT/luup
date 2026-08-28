import { fireEvent, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, test, vi } from "vitest";

import { createApiClient } from "../../lib/api/client";
import type { InspectorKind } from "../../lib/types/inspector";
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

function mockMobile() {
  const original = window.matchMedia;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  });
  return () => Object.defineProperty(window, "matchMedia", { configurable: true, value: original });
}

describe("AppShell", () => {
  test("渲染稳定项目树与本机 working set", () => {
    const onRunIdChange = vi.fn();
    renderWithProviders(
      <AppShell
        runId="run-1"
        onRunIdChange={onRunIdChange}
        onStartResearch={vi.fn()}
        sidebar={<div data-testid="sidebar-content">题库内容</div>}
        runs={[
          { id: "run-1", label: "第一个研究问题" },
          { id: "run-2", label: "第二个研究问题" },
        ]}
      >
        <div data-testid="main-content">main</div>
      </AppShell>,
    );

    expect(screen.getByRole("list", { name: "Science 125 项目导航层级" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Science 125" })).toHaveAttribute("aria-expanded", "true");
    const questionBank = screen.getByRole("button", { name: /Science 125 题库/ });
    expect(questionBank).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(questionBank);
    expect(screen.getByRole("dialog", { name: "Science 125 题库" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Runs/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/项目树保存组织上下文/)).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "第一个研究问题" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "第二个研究问题" })).toHaveAttribute("aria-selected", "false");
    fireEvent.click(screen.getByRole("tab", { name: "第二个研究问题" }));
    expect(onRunIdChange).toHaveBeenCalledWith("run-2");
  });

  test("tabs 使用单一 roving tabIndex 并支持方向键、Home 与 End", () => {
    function Harness() {
      const [active, setActive] = useState<string | null>(null);
      return (
        <AppShell
          runId={active}
          onRunIdChange={setActive}
          onStartResearch={vi.fn()}
          sidebar={<div>题库</div>}
          runs={[
            { id: "run-1", label: "问题一" },
            { id: "run-2", label: "问题二" },
            { id: "run-3", label: "问题三" },
          ]}
        >
          main
        </AppShell>
      );
    }
    renderWithProviders(<Harness />);
    const first = screen.getByRole("tab", { name: "问题一" });
    const second = screen.getByRole("tab", { name: "问题二" });
    const third = screen.getByRole("tab", { name: "问题三" });
    expect(first).toHaveAttribute("tabindex", "0");
    expect(second).toHaveAttribute("tabindex", "-1");
    expect(third).toHaveAttribute("tabindex", "-1");

    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(second).toHaveFocus();
    expect(second).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(second, { key: "End" });
    expect(third).toHaveFocus();
    expect(third).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(third, { key: "Home" });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: "ArrowLeft" });
    expect(third).toHaveFocus();
  });

  test("桌面折叠保留固定布局宽度", () => {
    renderWithProviders(
      <AppShell runId={null} onRunIdChange={vi.fn()} onStartResearch={vi.fn()} sidebar={<div>sidebar</div>}>
        main
      </AppShell>,
    );
    const reserve = screen.getByTestId("sidebar-layout-reserve");
    expect(reserve).toHaveAttribute("data-layout-strategy", "fixed-reserve");
    expect(getComputedStyle(reserve).width).toBe("288px");
    fireEvent.click(screen.getByTestId("toggle-sidebar"));
    expect(screen.getByTestId("question-sidebar-panel")).toHaveAttribute("data-collapsed", "true");
    expect(getComputedStyle(reserve).width).toBe("288px");
  });

  test("workspace 内部入口维持单一二级 Inspector", () => {
    function Harness() {
      const [kind, setKind] = useState<InspectorKind>(null);
      return (
        <AppShell
          runId={null}
          onRunIdChange={vi.fn()}
          onStartResearch={vi.fn()}
          sidebar={<div>题库</div>}
          inspector={kind}
          onInspectorChange={setKind}
          inspectorContent={<div>{kind === "process" ? "过程内容" : "产物内容"}</div>}
        >
          <button onClick={() => setKind("process")}>查看执行轨迹</button>
          <button onClick={() => setKind("artifacts")}>查看冻结产物</button>
        </AppShell>
      );
    }
    renderWithProviders(<Harness />);
    expect(screen.queryByRole("button", { name: "过程" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "查看执行轨迹" }));
    expect(screen.getByText("过程内容")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "查看冻结产物" }));
    expect(screen.queryByText("过程内容")).not.toBeInTheDocument();
    expect(screen.getByText("产物内容")).toBeInTheDocument();
    expect(screen.getAllByTestId("workspace-inspector")).toHaveLength(1);
  });

  test("桌面 Inspector 使用稳定二级 dock，关闭后仍保持 Main 布局契约", () => {
    function Harness() {
      const [kind, setKind] = useState<InspectorKind>(null);
      return (
        <AppShell
          runId={null}
          onRunIdChange={vi.fn()}
          onStartResearch={vi.fn()}
          sidebar={<div>题库</div>}
          inspector={kind}
          onInspectorChange={setKind}
          inspectorContent={<div>Inspector 内容</div>}
        >
          <button onClick={() => setKind("process")}>打开 Inspector</button>
        </AppShell>
      );
    }
    renderWithProviders(<Harness />);
    const main = screen.getByTestId("app-main");
    const mainFlex = getComputedStyle(main).flex;
    expect(main).toHaveAttribute("data-inspector-layout", "responsive-dock");
    fireEvent.click(screen.getByRole("button", { name: "打开 Inspector" }));
    const inspector = screen.getByTestId("workspace-inspector");
    expect(getComputedStyle(inspector).position).toBe("relative");
    expect(getComputedStyle(inspector).width).toBe("332px");
    expect(getComputedStyle(main).flex).toBe(mainFlex);
    fireEvent.click(screen.getByRole("button", { name: "关闭轨迹、审计与反馈" }));
    expect(screen.queryByTestId("workspace-inspector")).not.toBeInTheDocument();
    expect(getComputedStyle(main).flex).toBe(mainFlex);
  });

  test("移动端项目树使用 drawer 并恢复主任务", async () => {
    const restoreMatchMedia = mockMobile();
    renderWithProviders(
      <AppShell runId={null} onRunIdChange={vi.fn()} onStartResearch={vi.fn()} sidebar={<button>题库动作</button>}>
        <button>主区动作</button>
      </AppShell>,
    );
    const trigger = screen.getByTestId("toggle-sidebar");
    await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "false"));
    expect(screen.queryByRole("dialog", { name: "Science 125 项目导航" })).not.toBeInTheDocument();
    fireEvent.click(trigger);
    expect(await screen.findByRole("dialog", { name: "Science 125 项目导航" })).toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveAttribute("inert");
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Science 125 项目导航" })).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
    restoreMatchMedia();
  });

  test("移动 Inspector 管理焦点、Tab、Escape 与焦点恢复", async () => {
    const restoreMatchMedia = mockMobile();
    function Harness() {
      const [kind, setKind] = useState<InspectorKind>(null);
      return (
        <AppShell
          runId={null}
          onRunIdChange={vi.fn()}
          onStartResearch={vi.fn()}
          sidebar={<div>题库</div>}
          inspector={kind}
          onInspectorChange={setKind}
          inspectorContent={<button>Inspector 动作</button>}
        >
          <button onClick={() => setKind("process")}>查看执行轨迹</button>
          <button onClick={() => setKind("artifacts")}>查看冻结产物</button>
        </AppShell>
      );
    }
    renderWithProviders(<Harness />);
    await waitFor(() => expect(screen.getByTestId("toggle-sidebar")).toHaveAttribute("aria-expanded", "false"));
    const trigger = screen.getByRole("button", { name: "查看执行轨迹" });
    trigger.focus();
    fireEvent.click(trigger);
    const close = await screen.findByRole("button", { name: "关闭轨迹、审计与反馈" });
    await waitFor(() => expect(close).toHaveFocus());
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(screen.getByRole("button", { name: "Inspector 动作" })).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("workspace-inspector")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());

    const secondTrigger = screen.getByRole("button", { name: "查看冻结产物" });
    secondTrigger.focus();
    fireEvent.click(secondTrigger);
    const secondClose = await screen.findByRole("button", { name: "关闭证据与冻结产物" });
    await waitFor(() => expect(secondClose).toHaveFocus());
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("workspace-inspector")).not.toBeInTheDocument());
    await waitFor(() => expect(secondTrigger).toHaveFocus());
    restoreMatchMedia();
  });

  test("视觉关闭图标保持鼠标可用但不进入 tablist 可访问树", () => {
    const onCloseRun = vi.fn();
    renderWithProviders(
      <AppShell
        runId="run-1"
        onRunIdChange={vi.fn()}
        onStartResearch={vi.fn()}
        sidebar={<div>题库</div>}
        runs={[{ id: "run-1", label: "第一个研究问题" }]}
        onCloseRun={onCloseRun}
      >
        main
      </AppShell>,
    );
    expect(screen.queryByRole("button", { name: "关闭 Run 第一个研究问题" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("close-run-run-1"));
    expect(onCloseRun).toHaveBeenCalledWith("run-1");
  });

  test("打开设置弹窗后 Escape 关闭并恢复焦点", async () => {
    const client = createApiClient({ fetchImpl: vi.fn(async () => configResponse()) });
    renderWithProviders(
      <AppShell runId={null} onRunIdChange={vi.fn()} onStartResearch={vi.fn()} sidebar={<div>sidebar</div>}>
        main
      </AppShell>,
      { client },
    );
    const trigger = await screen.findByTestId("open-settings");
    trigger.focus();
    fireEvent.click(trigger);
    await screen.findByTestId("settings-dialog");
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("settings-dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
