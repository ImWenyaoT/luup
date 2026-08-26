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
      expect(putCall).toBeTruthy();
    });
  });

  test("关闭时不渲染", () => {
    const client = createApiClient({ fetchImpl: vi.fn() });
    renderWithProviders(<SettingsDialog open={false} onOpenChange={vi.fn()} />, { client });
    expect(screen.queryByTestId("settings-dialog")).not.toBeInTheDocument();
  });
});
