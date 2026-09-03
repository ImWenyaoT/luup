import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, test, vi } from "vitest";

import { useFocusTrap } from "./useFocusTrap";

function TrapHarness({
  active,
  trapFocus = true,
  suspended = false,
  onEscape = vi.fn(),
}: {
  active: boolean;
  trapFocus?: boolean;
  suspended?: boolean;
  onEscape?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  useFocusTrap({
    active,
    containerRef,
    onEscape,
    trapFocus,
    suspended,
    returnFocusRef,
  });
  return (
    <div>
      <button type="button" data-testid="outside">
        outside
      </button>
      <div ref={containerRef} data-testid="trap">
        <button type="button">first</button>
        <button type="button">last</button>
      </div>
    </div>
  );
}

describe("useFocusTrap", () => {
  test("激活时自动聚焦首个可聚焦元素；Escape 触发 onEscape", async () => {
    const onEscape = vi.fn();
    render(<TrapHarness active onEscape={onEscape} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "first" })).toHaveFocus());
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  test("在末项 Tab / 首项 Shift+Tab 时环绕", async () => {
    render(<TrapHarness active />);
    const first = screen.getByRole("button", { name: "first" });
    const last = screen.getByRole("button", { name: "last" });
    await waitFor(() => expect(first).toHaveFocus());

    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(first).toHaveFocus();

    first.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();
  });

  test("suspended 时忽略 Escape", () => {
    const onEscape = vi.fn();
    render(<TrapHarness active suspended onEscape={onEscape} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onEscape).not.toHaveBeenCalled();
  });
});
