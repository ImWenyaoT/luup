import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { createApiClient } from "../../lib/api/client";
import type { ConfigStatus } from "../../lib/types/wire";
import { renderWithProviders } from "../../test-utils";
import { SettingsDialog } from "./SettingsDialog";

const mockConfig: ConfigStatus = {
  runtime: "deterministic",
  credential: "absent",
  model_id: "qwen-test",
  base_url: "https://api.example.com/v1",
};

function respond(status: number, body: unknown, ok = status < 400): Response {
  return {
    ok,
    status,
    statusText: `HTTP-${status}`,
    json: async () => body,
  } as unknown as Response;
}

describe("SettingsDialog", () => {
  test("打开时展示配置状态", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(respond(200, mockConfig))
      .mockResolvedValueOnce(respond(200, mockConfig));
    const client = createApiClient({ fetchImpl });
    renderWithProviders(<SettingsDialog open onOpenChange={vi.fn()} />, { client });

    await waitFor(() => expect(screen.getByText(/deterministic/)).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId("settings-model-id")).toHaveValue("qwen-test"));
    expect(screen.getByRole("dialog", { name: "系统与模型设置" })).toBeInTheDocument();
    const close = screen.getByRole("button", { name: "关闭设置" });
    await waitFor(() => expect(close).toHaveFocus());
    expect(screen.getByTestId("save-settings")).toHaveAccessibleName("保存");
    expect(screen.getByTestId("settings-api-key")).toHaveAttribute("type", "password");
    fireEvent.change(screen.getByTestId("settings-api-key"), { target: { value: "secret" } });
    expect(screen.queryByRole("button", { name: /Reveal value|Copy to clipboard/ })).not.toBeInTheDocument();
    screen.getByTestId("save-settings").focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(close).toHaveFocus();
  });

  test("保存调用 PUT 并更新", async () => {
    const updated: ConfigStatus = { ...mockConfig, model_id: "qwen-new" };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(respond(200, mockConfig))
      .mockResolvedValueOnce(respond(200, mockConfig))
      .mockResolvedValueOnce(respond(200, updated));
    const client = createApiClient({ fetchImpl });
    renderWithProviders(<SettingsDialog open onOpenChange={vi.fn()} />, { client });

    await waitFor(() => expect(screen.getByTestId("settings-model-id")).toHaveValue("qwen-test"));
    fireEvent.change(screen.getByTestId("settings-model-id"), { target: { value: "qwen-new" } });
    fireEvent.click(screen.getByTestId("save-settings"));

    await waitFor(() => {
      const putCall = fetchImpl.mock.calls.find(([, init]) => (init as RequestInit)?.method === "PUT");
      if (!putCall) throw new Error("expected PUT /api/config");
      const body = (putCall[1] as RequestInit).body;
      expect(putCall[0]).toBe("/api/config");
      expect(typeof body).toBe("string");
      expect(JSON.parse(body as string)).toEqual({
        model_id: "qwen-new",
        base_url: "https://api.example.com/v1",
      });
    });
    expect(await screen.findByRole("status")).toHaveTextContent("已保存，下一次运行即生效。");
  });

  test("保存失败时保留服务端反馈", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(respond(200, mockConfig))
      .mockResolvedValueOnce(respond(200, mockConfig))
      .mockResolvedValueOnce(respond(401, { detail: "API token 无效" }, false));
    const client = createApiClient({ fetchImpl });
    renderWithProviders(<SettingsDialog open onOpenChange={vi.fn()} />, { client });

    await waitFor(() => expect(screen.getByTestId("settings-model-id")).toHaveValue("qwen-test"));
    fireEvent.click(screen.getByTestId("save-settings"));

    expect(await screen.findByRole("alert")).toHaveTextContent("API token 无效");
  });

  test("关闭时不渲染", () => {
    const client = createApiClient({ fetchImpl: vi.fn() });
    renderWithProviders(<SettingsDialog open={false} onOpenChange={vi.fn()} />, { client });
    expect(screen.queryByTestId("settings-dialog")).not.toBeInTheDocument();
  });

  test("按 Escape 关闭并通过公开回调同步状态", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(respond(200, mockConfig));
    const client = createApiClient({ fetchImpl });
    const onOpenChange = vi.fn();
    renderWithProviders(<SettingsDialog open onOpenChange={onOpenChange} />, { client });

    await waitFor(() => expect(screen.getByTestId("settings-dialog")).toBeInTheDocument());
    fireEvent.keyDown(document, { key: "Escape" });

    expect(onOpenChange.mock.calls.at(-1)?.[0]).toBe(false);
  });
});
