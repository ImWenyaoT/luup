import { fireEvent, screen, waitFor } from "@testing-library/react";
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
    fireEvent.click(screen.getByTestId("open-settings"));
    await waitFor(() => expect(screen.getByTestId("settings-dialog")).toBeInTheDocument());
  });
});
