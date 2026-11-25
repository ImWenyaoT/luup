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

import { AutoresearchChat } from "./AutoresearchChat";

describe("AutoresearchChat", () => {
  it("渲染品牌与空态提示", () => {
    render(<AutoresearchChat />);
    expect(screen.getByRole("heading", { name: "Luup Autoresearch" })).toBeInTheDocument();
    expect(screen.getByText(/Coordinator 会委派/)).toBeInTheDocument();
    expect(screen.getByLabelText("研究问题")).toBeInTheDocument();
  });
});
