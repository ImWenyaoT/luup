import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@ai-sdk/react", () => ({
  useChat: () => ({
    messages: [],
    sendMessage: vi.fn(),
    status: "ready",
    error: undefined,
    stop: vi.fn(),
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock("../../providers/api", () => ({
  useApiClient: () => ({
    getToken: () => "test-token",
    baseUrl: "",
    snapshotTimeoutMs: 10_000,
    get: vi.fn(async () => ({ status: "idle" })),
    post: vi.fn(),
    put: vi.fn(),
  }),
}));

import { AstryxProvider } from "../../providers/astryx";
import { AutoresearchChat } from "./AutoresearchChat";

describe("AutoresearchChat", () => {
  it("渲染 Astryx shell 与 Mill / chat 入口", () => {
    render(
      <AstryxProvider>
        <AutoresearchChat />
      </AstryxProvider>,
    );
    expect(screen.getByRole("heading", { name: "Luup Autoresearch" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Research Mill/i })).toBeInTheDocument();
    expect(screen.getByText(/连续战役/)).toBeInTheDocument();
    expect(screen.getByLabelText("研究问题")).toBeInTheDocument();
  });
});
