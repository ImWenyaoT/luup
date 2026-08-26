import { createContext, useContext, useMemo, type ReactNode } from "react";

import { createApiClient, type ApiClient } from "../lib/api/client";

const TOKEN_STORAGE_KEY = "luup_api_token";

function readStoredToken(): string | undefined {
  if (typeof localStorage === "undefined") return undefined;
  const token = localStorage.getItem(TOKEN_STORAGE_KEY);
  return token?.trim() ? token.trim() : undefined;
}

const ApiClientContext = createContext<ApiClient | null>(null);

export type ApiProviderProps = {
  children: ReactNode;
  client?: ApiClient;
};

export function ApiProvider({ children, client }: ApiProviderProps) {
  const value = useMemo(
    () =>
      client ??
      createApiClient({
        getToken: readStoredToken,
      }),
    [client],
  );

  return <ApiClientContext.Provider value={value}>{children}</ApiClientContext.Provider>;
}

export function useApiClient(): ApiClient {
  const client = useContext(ApiClientContext);
  if (!client) {
    throw new Error("useApiClient must be used within ApiProvider");
  }
  return client;
}
