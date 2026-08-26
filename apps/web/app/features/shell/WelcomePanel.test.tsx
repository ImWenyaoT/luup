import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { createApiClient } from "../../lib/api/client";
import type { Science125Data } from "../../lib/types/wire";
import { renderWithProviders } from "../../test-utils";
import { WelcomePanel } from "./WelcomePanel";

const mockData: Science125Data = {
  source: "fixture",
  retrievedAt: "2025-01-01",
  total: 4,
  domains: [
    {
      domain: "Physics",
      count: 1,
      questions: [{ id: 2, domain: "Physics", question: "量子引力如何统一？" }],
    },
    {
      domain: "Biology",
      count: 3,
      questions: [
        { id: 10, domain: "Biology", question: "Will AI redefine the future of chemistry?" },
        { id: 13, domain: "Biology", question: "衰老能否逆转？" },
        { id: 61, domain: "Biology", question: "细胞衰老机制？" },
      ],
    },
  ],
};

function science125Response(): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => mockData,
  } as unknown as Response;
}

describe("WelcomePanel", () => {
  test("快捷题气泡直接开跑", async () => {
    const onStartResearch = vi.fn(async () => {});
    const fetchImpl = vi.fn(async () => science125Response());
    const client = createApiClient({ fetchImpl });
    renderWithProviders(<WelcomePanel onStartResearch={onStartResearch} />, { client });

    await waitFor(() => expect(screen.getByTestId("quick-question-10")).not.toBeDisabled());
    fireEvent.click(screen.getByTestId("quick-question-10"));
    await waitFor(() => expect(onStartResearch).toHaveBeenCalledWith("Will AI redefine the future of chemistry?"));
  });

  test("提交问题调用 onStartResearch", async () => {
    const onStartResearch = vi.fn(async () => {});
    const fetchImpl = vi.fn(async () => science125Response());
    const client = createApiClient({ fetchImpl });
    renderWithProviders(<WelcomePanel onStartResearch={onStartResearch} />, { client });

    fireEvent.change(screen.getByTestId("welcome-question-input"), {
      target: { value: "自定义研究问题" },
    });
    fireEvent.click(screen.getByTestId("start-research"));

    await waitFor(() => expect(onStartResearch).toHaveBeenCalledWith("自定义研究问题"));
  });
});
