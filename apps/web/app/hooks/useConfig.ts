import { useCallback, useEffect, useState } from "react";

import { ApiError } from "../lib/api/client";
import { fetchConfig, saveConfig } from "../lib/api/config";
import type { ConfigStatus } from "../lib/types/wire";
import { useApiClient } from "../providers/api";
import type { ApiClient } from "../lib/api/client";

export type UseConfigOptions = {
  client?: ApiClient;
};

export function useConfig(options?: UseConfigOptions) {
  const defaultClient = useApiClient();
  const client = options?.client ?? defaultClient;
  const [config, setConfig] = useState<ConfigStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await fetchConfig(client);
      setConfig(next);
    } catch (cause) {
      const apiError = cause instanceof ApiError ? cause : new ApiError(500, String(cause));
      setError(apiError);
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const save = useCallback(
    async (next: { api_key?: string; model_id?: string; base_url?: string }) => {
      setSaving(true);
      setError(null);
      try {
        const updated = await saveConfig(client, next);
        setConfig(updated);
      } catch (cause) {
        const apiError = cause instanceof ApiError ? cause : new ApiError(500, String(cause));
        setError(apiError);
        throw apiError;
      } finally {
        setSaving(false);
      }
    },
    [client],
  );

  return { config, loading, saving, error, save, reload };
}
