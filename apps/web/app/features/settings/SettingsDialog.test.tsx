import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { createApiClient } from "../../lib/api/client";
import type { ConfigStatus } from "../../lib/types/wire";
import { renderWithProviders } from "../../test-utils";
import { SettingsDialog, SettingsTrigger } from "./SettingsDialog";

const mockConfig: ConfigStatus = {
  runtime: "deterministic",
  credential: "absent",
  model_id: "qwen-test",
  base_url: "https://api.example.com/v1",
  provider: "openai-compatible",
  api_surface: "chat",
};

function respond(status: number, body: unknown, ok = status < 400): Response {
  return {
    ok,
    status,
    statusText: `HTTP-${status}`,
    json: async () => body,
  } as unknown as Response;
}

function mockFetch(
  config: ConfigStatus = mockConfig,
  siwc: { signed_in: boolean; email?: string | null; expires_at?: string | null } = { signed_in: false },
) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const path = String(url);
    if (path.includes("/api/auth/siwc/start") && init?.method === "POST") {
      return respond(200, { authorize_url: "https://auth.example/siwc" });
    }
    if (path.includes("/api/auth/siwc/logout") && init?.method === "POST") {
      return respond(200, { signed_in: false });
    }
    if (path.includes("/api/auth/siwc")) {
      return respond(200, siwc);
    }
    if (init?.method === "PUT") {
      const raw = typeof init.body === "string" ? init.body : "{}";
      const body = JSON.parse(raw) as ConfigStatus;
      return respond(200, { ...config, ...body, credential: "override" });
    }
    return respond(200, config);
  });
}

function clientFrom(fetchImpl: ReturnType<typeof mockFetch> | typeof fetch) {
  return createApiClient({ fetchImpl: fetchImpl as unknown as typeof fetch });
}

describe("SettingsDialog", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("打开时展示配置状态与 provider 控件", async () => {
    const fetchImpl = mockFetch();
    const client = clientFrom(fetchImpl);
    renderWithProviders(<SettingsDialog open onOpenChange={vi.fn()} />, { client });

    await waitFor(() => expect(screen.getByText(/deterministic/)).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId("settings-model-id")).toHaveValue("qwen-test"));
    expect(screen.getByRole("dialog", { name: "系统与模型设置" })).toBeInTheDocument();
    expect(screen.getByTestId("settings-provider")).toHaveValue("openai-compatible");
    expect(screen.getByTestId("settings-api-surface")).toHaveValue("chat");
    expect(screen.getByText(/OpenAI \/ DeepSeek \/ OpenAI-compatible/)).toBeInTheDocument();
    expect(screen.getByTestId("siwc-sign-in")).toBeInTheDocument();
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

  test("保存调用 PUT 并带上 provider / api_surface", async () => {
    const fetchImpl = mockFetch();
    const client = clientFrom(fetchImpl);
    renderWithProviders(<SettingsDialog open onOpenChange={vi.fn()} />, { client });

    await waitFor(() => expect(screen.getByTestId("settings-model-id")).toHaveValue("qwen-test"));
    fireEvent.change(screen.getByTestId("settings-provider"), { target: { value: "deepseek" } });
    fireEvent.change(screen.getByTestId("settings-api-surface"), { target: { value: "responses" } });
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
        provider: "deepseek",
        api_surface: "responses",
      });
    });
    expect(await screen.findByText("已保存，下一次运行即生效。")).toBeInTheDocument();
    expect(screen.getByText(/DEEPSEEK_API_KEY/)).toBeInTheDocument();
  });

  test("保存失败时保留服务端反馈", async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes("/api/auth/siwc")) return respond(200, { signed_in: false });
      if (init?.method === "PUT") return respond(401, { detail: "API token 无效" }, false);
      return respond(200, mockConfig);
    }) as unknown as typeof fetch;
    const client = createApiClient({ fetchImpl });
    renderWithProviders(<SettingsDialog open onOpenChange={vi.fn()} />, { client });

    await waitFor(() => expect(screen.getByTestId("settings-model-id")).toHaveValue("qwen-test"));
    fireEvent.change(screen.getByTestId("settings-model-id"), { target: { value: "changed-model" } });
    fireEvent.click(screen.getByTestId("save-settings"));

    expect(await screen.findByRole("alert")).toHaveTextContent("API token 无效");
  });

  test("openai 环境配置用 provider_* 初始化，不写回 Qwen/DashScope", async () => {
    const openaiConfig: ConfigStatus = {
      runtime: "live",
      credential: "environment",
      model_id: "qwen3.8-max",
      base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      provider: "openai",
      api_surface: "responses",
      provider_credential: "environment",
      provider_model_id: "gpt-5.4",
      provider_base_url: null,
    };
    const fetchImpl = mockFetch(openaiConfig);
    const client = clientFrom(fetchImpl);
    renderWithProviders(<SettingsDialog open onOpenChange={vi.fn()} />, { client });

    await waitFor(() => expect(screen.getByTestId("settings-model-id")).toHaveValue("gpt-5.4"));
    expect(screen.getByTestId("settings-base-url")).toHaveValue("");
    expect(screen.getByTestId("settings-provider")).toHaveValue("openai");
    fireEvent.click(screen.getByTestId("save-settings"));
    expect(await screen.findByText("没有要保存的改动。")).toBeInTheDocument();
  });

  test("关闭时不渲染", () => {
    const client = clientFrom(vi.fn());
    renderWithProviders(<SettingsDialog open={false} onOpenChange={vi.fn()} />, { client });
    expect(screen.queryByTestId("settings-dialog")).not.toBeInTheDocument();
  });

  test("按 Escape 关闭并通过公开回调同步状态", async () => {
    const fetchImpl = mockFetch();
    const client = clientFrom(fetchImpl);
    const onOpenChange = vi.fn();
    renderWithProviders(<SettingsDialog open onOpenChange={onOpenChange} />, { client });

    await waitFor(() => expect(screen.getByTestId("settings-dialog")).toBeInTheDocument());
    fireEvent.keyDown(document, { key: "Escape" });

    expect(onOpenChange.mock.calls.at(-1)?.[0]).toBe(false);
  });

  test("Sign in with ChatGPT 打开授权 URL", async () => {
    const openSpy = vi.fn();
    vi.stubGlobal("open", openSpy);
    const fetchImpl = mockFetch();
    const client = clientFrom(fetchImpl);
    renderWithProviders(<SettingsDialog open onOpenChange={vi.fn()} />, { client });

    await waitFor(() => expect(screen.getByTestId("siwc-sign-in")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("siwc-sign-in"));
    await waitFor(() =>
      expect(openSpy).toHaveBeenCalledWith("https://auth.example/siwc", "_blank", "noopener,noreferrer"),
    );
    expect(await screen.findByText(/已打开 ChatGPT 登录窗口/)).toBeInTheDocument();
  });

  test("已登录时展示状态并可退出", async () => {
    const fetchImpl = mockFetch(mockConfig, {
      signed_in: true,
      email: "user@example.com",
      expires_at: "2026-12-01",
    });
    const client = clientFrom(fetchImpl);
    renderWithProviders(<SettingsDialog open onOpenChange={vi.fn()} />, { client });

    expect(await screen.findByText(/已登录 · user@example.com/)).toBeInTheDocument();
    expect(screen.getByTestId("siwc-sign-in")).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(screen.getByTestId("siwc-logout"));
    expect(await screen.findByText(/已退出 ChatGPT 登录/)).toBeInTheDocument();
  });

  test("SettingsTrigger 在有 config 时渲染", async () => {
    const fetchImpl = mockFetch();
    const client = clientFrom(fetchImpl);
    const onOpen = vi.fn();
    renderWithProviders(<SettingsTrigger onOpen={onOpen} />, { client });
    await waitFor(() => expect(screen.getByTestId("open-settings")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("open-settings"));
    expect(onOpen).toHaveBeenCalled();
  });

  test("点击遮罩关闭", async () => {
    const fetchImpl = mockFetch();
    const client = clientFrom(fetchImpl);
    const onOpenChange = vi.fn();
    renderWithProviders(<SettingsDialog open onOpenChange={onOpenChange} />, { client });
    await waitFor(() => expect(screen.getByTestId("settings-dialog")).toBeInTheDocument());
    fireEvent.mouseDown(screen.getByTestId("settings-dialog").parentElement!);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  test("OpenAI provider 展示 SIWC 提示文案", async () => {
    const fetchImpl = mockFetch({ ...mockConfig, provider: "openai", api_surface: "responses" });
    const client = clientFrom(fetchImpl);
    renderWithProviders(<SettingsDialog open onOpenChange={vi.fn()} />, { client });
    await waitFor(() => expect(screen.getByTestId("settings-provider")).toHaveValue("openai"));
    expect(screen.getByTestId("siwc-sign-in")).toHaveTextContent("Sign in with ChatGPT");
    expect(screen.getByText(/OPENAI_API_KEY/)).toBeInTheDocument();
  });

  test("SIWC logout 失败展示错误", async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url);
      if (path.includes("/api/auth/siwc/logout") && init?.method === "POST") {
        return respond(500, { detail: "logout_failed" }, false);
      }
      if (path.includes("/api/auth/siwc")) {
        return respond(200, { signed_in: true, email: "a@b.c" });
      }
      return respond(200, mockConfig);
    });
    const client = clientFrom(fetchImpl);
    renderWithProviders(<SettingsDialog open onOpenChange={vi.fn()} />, { client });
    expect(await screen.findByText(/已登录 · a@b.c/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("siwc-logout"));
    expect(await screen.findByRole("alert")).toHaveTextContent("logout_failed");
  });

  test("SIWC start 失败展示错误", async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes("/api/auth/siwc/start") && init?.method === "POST") {
        return respond(503, { detail: "siwc_unavailable" }, false);
      }
      if (String(url).includes("/api/auth/siwc")) return respond(200, { signed_in: false });
      return respond(200, mockConfig);
    });
    const client = clientFrom(fetchImpl);
    renderWithProviders(<SettingsDialog open onOpenChange={vi.fn()} />, { client });
    await waitFor(() => expect(screen.getByTestId("siwc-sign-in")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("siwc-sign-in"));
    expect(await screen.findByRole("alert")).toHaveTextContent("siwc_unavailable");
  });
});
