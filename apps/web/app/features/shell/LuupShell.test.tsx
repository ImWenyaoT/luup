import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeAll, describe, expect, test, vi } from "vitest";

import { createApiClient } from "../../lib/api/client";
import type { ConfigStatus } from "../../lib/types/wire";
import { AstryxProvider } from "../../providers/astryx";
import { renderWithProviders } from "../../test-utils";
import { LuupShell } from "./LuupShell";

beforeAll(() => {
  if (typeof HTMLDialogElement === "undefined") return;
  const proto = HTMLDialogElement.prototype as HTMLDialogElement & {
    showModal: (this: HTMLDialogElement) => void;
    close: (this: HTMLDialogElement) => void;
  };
  if (typeof proto.showModal !== "function") {
    proto.showModal = function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
  }
  if (typeof proto.close !== "function") {
    proto.close = function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    };
  }
});

const mockConfig: ConfigStatus = {
  runtime: "deterministic",
  credential: "environment",
  model_id: "qwen-test",
  base_url: "https://api.example.com/v1",
  provider: "openai",
  api_surface: "responses",
};

function respond(status: number, body: unknown, ok = status < 400): Response {
  return {
    ok,
    status,
    statusText: `HTTP-${status}`,
    json: async () => body,
  } as unknown as Response;
}

function renderShell(
  ui: ReactElement,
  fetchImpl: typeof fetch = vi.fn(async (url: string) => {
    if (String(url).includes("/api/auth/siwc")) return respond(200, { signed_in: false });
    return respond(200, mockConfig);
  }) as unknown as typeof fetch,
) {
  const client = createApiClient({ fetchImpl });
  return {
    client,
    fetchImpl,
    ...renderWithProviders(<AstryxProvider>{ui}</AstryxProvider>, { client }),
  };
}

describe("LuupShell", () => {
  test("渲染顶栏与侧栏，并展示 children", async () => {
    renderShell(
      <LuupShell>
        <div>shell-body</div>
      </LuupShell>,
    );
    expect(screen.getByRole("navigation", { name: "Luup Autoresearch" })).toBeInTheDocument();
    expect(screen.getByText("shell-body")).toBeInTheDocument();
    expect(screen.getByText(/Mill · 永动机/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("open-settings")).toBeInTheDocument());
  });

  test("侧栏导航切到 chat / papers", async () => {
    renderShell(
      <LuupShell paperTitles={["Alpha paper"]}>
        <div>body</div>
      </LuupShell>,
    );
    fireEvent.click(screen.getByText("Single chat"));
    fireEvent.click(screen.getByText("Alpha paper"));
    expect(screen.getByText("Alpha paper")).toBeInTheDocument();
    fireEvent.click(screen.getAllByText("Papers")[0]!);
    expect(screen.getByText(/Mill · 永动机/)).toBeInTheDocument();
  });

  test("无 papers 时显示占位", () => {
    renderShell(
      <LuupShell paperTitles={[]}>
        <div>body</div>
      </LuupShell>,
    );
    expect(screen.getByText("(none yet)")).toBeInTheDocument();
  });

  test("打开设置对话框", async () => {
    renderShell(
      <LuupShell>
        <div>body</div>
      </LuupShell>,
    );
    await waitFor(() => expect(screen.getByTestId("open-settings")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("open-settings"));
    expect(await screen.findByTestId("settings-dialog")).toBeInTheDocument();
  });

  test("搜索框点击可打开命令面板", async () => {
    renderShell(
      <LuupShell>
        <div>body</div>
      </LuupShell>,
    );
    fireEvent.click(screen.getByPlaceholderText("Search · ⌘K"));
    expect(await screen.findByLabelText("Search commands")).toBeInTheDocument();
  });

  test("菜单项可切到 Mill / Chat / Papers / Palette", async () => {
    renderShell(
      <LuupShell>
        <div>body</div>
      </LuupShell>,
    );
    fireEvent.click(screen.getByRole("button", { name: "View" }));
    const menuChat = (await screen.findAllByText("Chat")).find((el) => el.closest("[role='menu'], [popover]"));
    expect(menuChat).toBeTruthy();
    fireEvent.click(menuChat!);

    fireEvent.click(screen.getByRole("button", { name: "View" }));
    const menuPapers = (await screen.findAllByText("Papers")).find((el) => el.closest("[role='menu'], [popover]"));
    fireEvent.click(menuPapers!);

    fireEvent.click(screen.getByRole("button", { name: "View" }));
    const menuMill = (await screen.findAllByText("Mill")).find((el) => el.closest("[role='menu'], [popover]"));
    fireEvent.click(menuMill!);

    fireEvent.click(screen.getByRole("button", { name: "View" }));
    fireEvent.click(await screen.findByText("Command Palette"));
    expect(await screen.findByLabelText("Search commands")).toBeInTheDocument();
  });

  test("Luup 菜单默认落到 mill；docs toast 路径可点", async () => {
    renderShell(
      <LuupShell>
        <div>body</div>
      </LuupShell>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Luup" }));
    fireEvent.click(await screen.findByText("Autoresearch"));
    fireEvent.click(screen.getByRole("button", { name: "Luup" }));
    fireEvent.click(await screen.findByText("Research Mill"));
  });

  test("顶栏 Mill 按钮可点", async () => {
    renderShell(
      <LuupShell>
        <div>body</div>
      </LuupShell>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Mill" }));
    fireEvent.click(screen.getByRole("button", { name: "Open mill" }));
  });

  test("命令面板选 About / mill / chat / papers", async () => {
    renderShell(
      <LuupShell>
        <div>body</div>
      </LuupShell>,
    );
    fireEvent.click(screen.getByPlaceholderText("Search · ⌘K"));
    expect(await screen.findByLabelText("Search commands")).toBeInTheDocument();
    fireEvent.click(await screen.findByText("About Luup Autoresearch"));
    fireEvent.click(screen.getByPlaceholderText("Search · ⌘K"));
    fireEvent.click(await screen.findByText("Focus Research Mill"));
    fireEvent.click(screen.getByPlaceholderText("Search · ⌘K"));
    fireEvent.click(await screen.findByText("Focus single-question chat"));
    fireEvent.click(screen.getByPlaceholderText("Search · ⌘K"));
    fireEvent.click(await screen.findByText("Show papers"));
  });
});
