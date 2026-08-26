import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderOptions } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import type { ReactElement, ReactNode } from "react";

import { ApiProvider } from "./providers/api";
import type { ApiClient } from "./lib/api/client";
import { createApiClient } from "./lib/api/client";

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

export type TestProvidersOptions = {
  client?: ApiClient;
  queryClient?: QueryClient;
  initialEntries?: string[];
};

export function createTestWrapper(options: TestProvidersOptions = {}) {
  const client = options.client ?? createApiClient({ fetchImpl: globalThis.fetch });
  const queryClient = options.queryClient ?? createTestQueryClient();
  const initialEntries = options.initialEntries ?? ["/"];

  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ApiProvider client={client}>
          <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>
        </ApiProvider>
      </QueryClientProvider>
    );
  };
}

export function renderWithProviders(
  ui: ReactElement,
  options: TestProvidersOptions & Omit<RenderOptions, "wrapper"> = {},
) {
  const { client, queryClient, initialEntries, ...renderOptions } = options;
  return render(ui, {
    wrapper: createTestWrapper({ client, queryClient, initialEntries }),
    ...renderOptions,
  });
}
