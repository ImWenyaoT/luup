import { render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { ApiProvider, useApiClient } from "./api";

const TOKEN_STORAGE_KEY = "luup_api_token";

const memory = new Map<string, string>();

const localStorageMock = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => {
    memory.set(key, value);
  },
  removeItem: (key: string) => {
    memory.delete(key);
  },
  clear: () => {
    memory.clear();
  },
};

beforeEach(() => {
  memory.clear();
  vi.stubGlobal("localStorage", localStorageMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ApiProvider / useApiClient", () => {
  test("未注入 client 时从 localStorage 读取非空 token", () => {
    localStorage.setItem(TOKEN_STORAGE_KEY, "  secret-token  ");

    function Probe() {
      const client = useApiClient();
      return <span data-testid="token">{client.getToken() ?? "none"}</span>;
    }

    render(
      <ApiProvider>
        <Probe />
      </ApiProvider>,
    );

    expect(screen.getByTestId("token")).toHaveTextContent("secret-token");
  });

  test("空白 token 视为未配置", () => {
    localStorage.setItem(TOKEN_STORAGE_KEY, "   ");

    function Probe() {
      const client = useApiClient();
      return <span data-testid="token">{client.getToken() ?? "none"}</span>;
    }

    render(
      <ApiProvider>
        <Probe />
      </ApiProvider>,
    );

    expect(screen.getByTestId("token")).toHaveTextContent("none");
  });

  test("注入 client 时跳过默认建连", () => {
    const injected = {
      baseUrl: "https://example.test",
      snapshotTimeoutMs: 1,
      getToken: () => "injected",
      get: async () => {
        throw new Error("unused");
      },
      post: async () => {
        throw new Error("unused");
      },
      put: async () => {
        throw new Error("unused");
      },
    };

    function Probe() {
      const client = useApiClient();
      return <span data-testid="token">{client.getToken() ?? "none"}</span>;
    }

    render(
      <ApiProvider client={injected}>
        <Probe />
      </ApiProvider>,
    );

    expect(screen.getByTestId("token")).toHaveTextContent("injected");
  });

  test("useApiClient 在 Provider 外抛错", () => {
    expect(() => renderHook(() => useApiClient())).toThrow("useApiClient must be used within ApiProvider");
  });
});
