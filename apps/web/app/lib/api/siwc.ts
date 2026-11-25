import type { ApiClient } from "./client";
import { withAuth } from "./client";
import type { SiwcStatus } from "../types/wire";

export type SiwcStartResponse = {
  authorize_url: string;
};

/** 发起 Sign in with ChatGPT；拿到 authorize_url 后由调用方 window.open。 */
export function startSiwc(client: ApiClient): Promise<SiwcStartResponse> {
  return client.post<SiwcStartResponse>("/api/auth/siwc/start", {}, withAuth(client));
}

export function fetchSiwcStatus(client: ApiClient): Promise<SiwcStatus> {
  return client.get<SiwcStatus>("/api/auth/siwc/status", withAuth(client));
}

export function logoutSiwc(client: ApiClient): Promise<SiwcStatus> {
  return client.post<SiwcStatus>("/api/auth/siwc/logout", {}, withAuth(client));
}
