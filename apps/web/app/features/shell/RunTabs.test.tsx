import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, test, vi } from "vitest";

import type { RunTab } from "../../hooks/useRunWorkingSet";
import { RunTabs } from "./RunTabs";

const initialTabs: RunTab[] = [
  { id: "run-1", label: "问题一" },
  { id: "run-2", label: "问题二" },
  { id: "run-3", label: "问题三" },
];

describe("RunTabs close focus", () => {
  test("Delete 关闭 active tab 后聚焦并选中右侧相邻 tab", async () => {
    function Harness() {
      const [tabs, setTabs] = useState(initialTabs);
      const [active, setActive] = useState<string | null>("run-2");
      return (
        <RunTabs
          activeRunId={active}
          tabs={tabs}
          onSelect={setActive}
          onClose={(id) => {
            const index = tabs.findIndex((tab) => tab.id === id);
            const next = tabs[index + 1] ?? tabs[index - 1] ?? null;
            setTabs((current) => current.filter((tab) => tab.id !== id));
            if (id === active) setActive(next?.id ?? null);
          }}
        />
      );
    }
    render(<Harness />);
    const active = screen.getByRole("tab", { name: "问题二" });
    active.focus();
    fireEvent.keyDown(active, { key: "Delete" });
    const next = screen.getByRole("tab", { name: "问题三" });
    await waitFor(() => expect(next).toHaveFocus());
    expect(next).toHaveAttribute("aria-selected", "true");
  });

  test("关闭 inactive tab 不触发导航，并将焦点恢复到当前 active tab", async () => {
    const onSelect = vi.fn();
    function Harness() {
      const [tabs, setTabs] = useState(initialTabs);
      return (
        <RunTabs
          activeRunId="run-2"
          tabs={tabs}
          onSelect={onSelect}
          onClose={(id) => setTabs((current) => current.filter((tab) => tab.id !== id))}
        />
      );
    }
    render(<Harness />);
    const close = screen.getByTestId("close-run-run-1");
    fireEvent.click(close);
    await waitFor(() => expect(screen.getByRole("tab", { name: "问题二" })).toHaveFocus());
    expect(onSelect).not.toHaveBeenCalled();
  });

  test("Backspace 关闭最后一个 tab 后聚焦空 tablist", async () => {
    function Harness() {
      const [tabs, setTabs] = useState<RunTab[]>([{ id: "run-1", label: "问题一" }]);
      return <RunTabs activeRunId="run-1" tabs={tabs} onSelect={vi.fn()} onClose={() => setTabs([])} />;
    }
    render(<Harness />);
    const tab = screen.getByRole("tab", { name: "问题一" });
    tab.focus();
    fireEvent.keyDown(tab, { key: "Backspace" });
    const tablist = screen.getByRole("tablist", { name: "本机已打开的 Runs" });
    await waitFor(() => expect(tablist).toHaveFocus());
    expect(tablist).toHaveAttribute("tabindex", "0");
  });

  test("视觉关闭图标不进入可访问树或顺序 Tab 停靠点", () => {
    render(<RunTabs activeRunId="run-1" tabs={initialTabs} onSelect={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /关闭 Run/ })).not.toBeInTheDocument();
    const closeIcons = initialTabs.map((tab) => screen.getByTestId(`close-run-${tab.id}`));
    for (const close of closeIcons) {
      expect(close).toHaveAttribute("aria-hidden", "true");
      expect(close).toHaveAttribute("tabindex", "-1");
    }
    expect(screen.getAllByRole("tab")).toHaveLength(initialTabs.length);
    expect(screen.getByRole("tab", { name: "问题一" })).toHaveAttribute("aria-keyshortcuts", "Delete Backspace");
  });
});
