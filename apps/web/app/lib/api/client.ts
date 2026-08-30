import type { ApiErrorBody } from "../types/wire";

export class ApiError extends Error {
  readonly status: number;
  readonly body?: ApiErrorBody;

  constructor(status: number, message: string, body?: ApiErrorBody, options?: ErrorOptions) {
    super(message, options);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }

  toJSON(): { name: string; status: number; message: string; body?: ApiErrorBody } {
    return {
      name: this.name,
      status: this.status,
      message: this.message,
      ...(this.body ? { body: this.body } : {}),
    };
  }
}

export type ApiClientOptions = {
  baseUrl?: string;
  getToken?: () => string | undefined;
  fetchImpl?: typeof fetch;
  snapshotTimeoutMs?: number;
};

export interface ApiClient {
  readonly baseUrl: string;
  readonly snapshotTimeoutMs: number;
  getToken: () => string | undefined;
  get<T>(path: string, init?: RequestInit): Promise<T>;
  post<T>(path: string, body: unknown, init?: RequestInit): Promise<T>;
  put<T>(path: string, body: unknown, init?: RequestInit): Promise<T>;
}

const DEFAULT_SNAPSHOT_TIMEOUT_MS = 10_000;

function resolveToken(getToken?: () => string | undefined): string | undefined {
  const fromGetter = getToken?.();
  if (fromGetter) return fromGetter;
  if (process.env.NEXT_PUBLIC_LUUP_API_TOKEN) {
    const envToken = process.env.NEXT_PUBLIC_LUUP_API_TOKEN;
    if (typeof envToken === "string" && envToken.trim()) return envToken.trim();
  }
  return undefined;
}

export async function parseJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch (cause) {
      const summary = response.statusText || `HTTP ${response.status}`;
      throw new ApiError(response.status, `${summary}：错误响应不是有效 JSON。`, undefined, { cause });
    }
    const body =
      typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as ApiErrorBody) : undefined;
    const detail = body?.detail;
    const message = detail ?? (response.statusText || `HTTP ${response.status}`);
    throw new ApiError(response.status, message, body);
  }
  return (await response.json()) as T;
}

export function createApiClient(options: ApiClientOptions = {}): ApiClient {
  const baseUrl = options.baseUrl ?? "";
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const snapshotTimeoutMs = options.snapshotTimeoutMs ?? DEFAULT_SNAPSHOT_TIMEOUT_MS;
  const getToken = () => resolveToken(options.getToken);

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetchImpl(`${baseUrl}${path}`, init);
    return parseJson<T>(response);
  }

  return {
    baseUrl,
    snapshotTimeoutMs,
    getToken,
    get<T>(path: string, init: RequestInit = {}): Promise<T> {
      return request<T>(path, init);
    },
    post<T>(path: string, body: unknown, init: RequestInit = {}): Promise<T> {
      const headers = new Headers(init.headers);
      if (!headers.has("content-type")) headers.set("content-type", "application/json");
      return request<T>(path, {
        ...init,
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
    },
    put<T>(path: string, body: unknown, init: RequestInit = {}): Promise<T> {
      const headers = new Headers(init.headers);
      if (!headers.has("content-type")) headers.set("content-type", "application/json");
      return request<T>(path, {
        ...init,
        method: "PUT",
        headers,
        body: JSON.stringify(body),
      });
    },
  };
}

export function withAuth(client: ApiClient, init: RequestInit = {}): RequestInit {
  const headers = new Headers(init.headers);
  const token = client.getToken();
  if (token) headers.set("authorization", `Bearer ${token}`);
  return { ...init, headers };
}
