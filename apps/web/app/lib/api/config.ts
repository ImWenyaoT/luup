import type { ApiClient } from "./client";
import { withAuth } from "./client";
import type { ConfigStatus } from "../types/wire";

export function fetchConfig(client: ApiClient): Promise<ConfigStatus> {
  return client.get<ConfigStatus>("/api/config");
}

export function saveConfig(
  client: ApiClient,
  next: { api_key?: string; model_id?: string; base_url?: string },
): Promise<ConfigStatus> {
  return client.put<ConfigStatus>("/api/config", next, withAuth(client));
}
