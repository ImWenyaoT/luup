import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const chatState = {
  messages: [] as Array<{ id: string; role: string; parts: Array<{ type: string; text?: string }> }>,
  status: "ready" as string,
  error: undefined as Error | undefined,
  sendMessage: vi.fn(),
  stop: vi.fn(),
};

vi.mock("@ai-sdk/react", () => ({
  useChat: () => ({
    get messages() {
      return chatState.messages;
    },
    get status() {
      return chatState.status;
    },
    get error() {
      return chatState.error;
    },
    sendMessage: (...args: unknown[]) => chatState.sendMessage(...args),
    stop: (...args: unknown[]) => chatState.stop(...args),
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
    get: vi.fn(async (path: string) => {
      if (path.includes("/api/config")) {
        return {
          runtime: "deterministic",
          credential: "absent",
          model_id: "qwen-test",
          base_url: "https://api.example.com/v1",
          provider: "openai",
          api_surface: "responses",
        };
      }
      if (path.includes("/api/auth/siwc")) {
        return { signed_in: false };
      }
      return { status: "idle" };
    }),
    post: vi.fn(async () => ({ status: "idle" })),
    put: vi.fn(),
  }),
}));

import { AstryxProvider } from "../../providers/astryx";
import { AutoresearchChat } from "./AutoresearchChat";

function renderChat() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AstryxProvider>
        <AutoresearchChat />
      </AstryxProvider>
    </QueryClientProvider>,
  );
}

describe("AutoresearchChat", () => {
  beforeEach(() => {
    chatState.messages = [];
    chatState.status = "ready";
    chatState.error = undefined;
    chatState.sendMessage.mockReset();
    chatState.stop.mockReset();
  });

  it("渲染 Astryx shell 与 Mill / chat 入口", () => {
    renderChat();
    expect(screen.getByRole("heading", { name: "Luup Autoresearch" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Research Mill/i })).toBeInTheDocument();
    expect(screen.getByText(/连续战役/)).toBeInTheDocument();
    expect(screen.getByLabelText("研究问题")).toBeInTheDocument();
  });

  it("提交问题调用 sendMessage 并清空草稿", async () => {
    renderChat();
    const input = screen.getByLabelText("研究问题");
    fireEvent.change(input, { target: { value: "脉冲星是什么？" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "研究" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "研究" }));
    await waitFor(() => expect(chatState.sendMessage).toHaveBeenCalledWith({ text: "脉冲星是什么？" }));
    expect(input).toHaveValue("");
  });

  it("busy 时不重复提交，展示停止按钮", () => {
    chatState.status = "streaming";
    chatState.messages = [
      {
        id: "m1",
        role: "user",
        parts: [{ type: "text", text: "hello" }],
      },
      {
        id: "m2",
        role: "assistant",
        parts: [
          { type: "text", text: "world" },
          { type: "tool-search", text: "ignored" },
        ],
      },
    ];
    renderChat();
    expect(screen.getByText("hello")).toBeInTheDocument();
    expect(screen.getByText("world")).toBeInTheDocument();
    expect(screen.getByText("search")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "停止" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "停止" }));
    expect(chatState.stop).toHaveBeenCalled();
  });

  it("展示 chat error Banner", () => {
    chatState.error = new Error("upstream_timeout");
    renderChat();
    expect(screen.getByText("upstream_timeout")).toBeInTheDocument();
  });

  it("busy 时提交被忽略；空草稿不提交", () => {
    chatState.status = "submitted";
    renderChat();
    expect(screen.getByRole("button", { name: "停止" })).toBeInTheDocument();
    fireEvent.submit(screen.getByLabelText("研究问题").closest("form")!);
    expect(chatState.sendMessage).not.toHaveBeenCalled();
  });
});
