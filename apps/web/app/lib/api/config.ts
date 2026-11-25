import type { ApiClient } from "./client";
import { withAuth } from "./client";
import type { ConfigSaveBody, ConfigStatus } from "../types/wire";

export function fetchConfig(client: ApiClient): Promise<ConfigStatus> {
  return client.get<ConfigStatus>("/api/config");
}

export function saveConfig(client: ApiClient, next: ConfigSaveBody): Promise<ConfigStatus> {
  return client.put<ConfigStatus>("/api/config", next, withAuth(client));
}
