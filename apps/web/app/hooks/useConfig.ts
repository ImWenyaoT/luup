import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { toApiError } from "../lib/api/client";
import type { ApiClient } from "../lib/api/client";
import { fetchConfig, saveConfig } from "../lib/api/config";
import { useApiClient } from "../providers/api";

export const CONFIG_QUERY_KEY = ["config"] as const;

export type UseConfigOptions = {
  client?: ApiClient;
};

export function configQueryOptions(client: ApiClient) {
  return {
    queryKey: CONFIG_QUERY_KEY,
    queryFn: () => fetchConfig(client),
  };
}

export function useConfig(options?: UseConfigOptions) {
  const defaultClient = useApiClient();
  const client = options?.client ?? defaultClient;
  const queryClient = useQueryClient();

  const query = useQuery(configQueryOptions(client));

  const mutation = useMutation({
    mutationFn: (next: { api_key?: string; model_id?: string; base_url?: string }) => saveConfig(client, next),
    onSuccess: (data) => {
      queryClient.setQueryData(CONFIG_QUERY_KEY, data);
    },
  });

  const { mutateAsync, isPending: saving, error: mutationError } = mutation;

  const save = useCallback(
    async (next: { api_key?: string; model_id?: string; base_url?: string }) => {
      try {
        return await mutateAsync(next);
      } catch (cause) {
        throw toApiError(cause);
      }
    },
    [mutateAsync],
  );

  const reload = useCallback(async () => {
    // Cancel any in-flight mount fetch so open→reload is not deduped away
    // (SettingsDialog tests rely on a distinct GET before PUT).
    await queryClient.cancelQueries({ queryKey: CONFIG_QUERY_KEY });
    await queryClient.fetchQuery({
      ...configQueryOptions(client),
      staleTime: 0,
    });
  }, [client, queryClient]);

  const rawError = mutationError ?? query.error;

  return {
    config: query.data ?? null,
    loading: query.isLoading,
    saving,
    error: rawError ? toApiError(rawError) : null,
    save,
    reload,
  };
}
