# apps/web 模块公开接口（C2a）

> 仅 TypeScript 签名；实现细节见 C3。wire types 对齐 `apps/server/src/api/projection.ts`。

## `lib/types/wire.ts`

```typescript
export type RunStatus = "running" | "completed" | "review_rejected" | "failed";
export type Role = "researcher" | "hypothesis-generation" | "evidence-review" | "research-plan" | "reviewer";
export type AttemptStatus = "running" | "completed" | "failed";

export type Attempt = { /* 对齐 publicAttemptSchema */ };
export type Subagent = { /* 对齐 publicSubagentSchema */ };
export type Evidence = { /* 对齐 publicEvidenceSchema */ };
export type RunEvent = { id: number; version: number; kind: string; payload: Record<string, string | number | boolean | null>; created_at: string };
export type Snapshot = { /* 对齐 publicRunSnapshotSchema */ };
export type Artifact = { /* 对齐 publicArtifactSchema */ };
export type ArtifactContent = { /* 对齐 publicArtifactContentSchema discriminated union */ };

export type ConfigStatus = {
  runtime: "live" | "deterministic";
  credential: "override" | "environment" | "absent";
  model_id: string;
  base_url: string;
};

export type Science125Question = { id: number; domain: string; question: string };
export type Science125Data = { source: string; retrievedAt: string; total: number; domains: { domain: string; count: number; questions: Science125Question[] }[] };
```

## `lib/types/constants.ts`

```typescript
export const TERMINAL_STATUSES: ReadonlySet<RunStatus>;
export const ROLE_ORDER: readonly Role[];
export const ROLE_LABEL: Record<Role, string>;
export const UI_SSE_EVENT_KINDS: readonly string[]; // 13 种，见 lib/sse/events.ts
```

## `lib/api/client.ts`

```typescript
export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string);
}

export type ApiClientOptions = {
  baseUrl?: string;           // 默认 ""
  getToken?: () => string | undefined;
  fetchImpl?: typeof fetch;
  snapshotTimeoutMs?: number; // 默认 10_000
};

export function createApiClient(options?: ApiClientOptions): ApiClient;

export interface ApiClient {
  get<T>(path: string, init?: RequestInit): Promise<T>;
  post<T>(path: string, body: unknown, init?: RequestInit): Promise<T>;
  put<T>(path: string, body: unknown, init?: RequestInit): Promise<T>;
}
```

## `lib/api/runs.ts`

```typescript
export function createRun(client: ApiClient, question: string): Promise<Snapshot>;
export function fetchRun(client: ApiClient, runId: string): Promise<Snapshot>;
export function submitFeedback(
  client: ApiClient,
  runId: string,
  input: { feedback_id: string; feedback: string },
): Promise<{ status: "queued"; feedback_id: string; round: 1 }>;
```

## `lib/api/artifacts.ts`

```typescript
export function fetchArtifact(client: ApiClient, artifactId: string): Promise<Artifact>;
```

## `lib/api/config.ts`

```typescript
export function fetchConfig(client: ApiClient): Promise<ConfigStatus>;
export function saveConfig(
  client: ApiClient,
  next: { api_key?: string; model_id?: string; base_url?: string },
): Promise<ConfigStatus>;
```

## `lib/api/science125.ts`

```typescript
export function fetchScience125(client: ApiClient): Promise<Science125Data>;
export function fetchScience125Question(
  client: ApiClient,
  id: number,
): Promise<{ question: Science125Question; formattedText: string }>;
```

## `lib/sse/events.ts`

```typescript
/** UI 订阅的 13 种 SSE event（与旧 api.ts subscribe 一致） */
export const UI_SSE_EVENT_KINDS: readonly [
  "run.created",
  "attempt.started",
  "subagent.started",
  "subagent.ended",
  "feedback.received",
  "revision.applied",
  "tool.evidence_recorded",
  "sdk.structured_correction",
  "artifact.published",
  "attempt.failed",
  "run.completed",
  "run.review_rejected",
  "run.failed",
];

export type UiSseEventKind = (typeof UI_SSE_EVENT_KINDS)[number];
export type SseTickHandler = () => void;
```

## `lib/sse/subscribe.ts`

```typescript
export type RunEventSubscription = {
  close(): void;
  readonly runId: string;
  readonly afterVersion: number;
};

/** 连接 `/api/runs/:id/events?after=`；任一 UI 事件调用 onTick；返回 dispose */
export function subscribeRunEvents(
  runId: string,
  afterVersion: number,
  onTick: SseTickHandler,
  options?: { eventSourceFactory?: (url: string) => EventSource },
): RunEventSubscription;
```

## `hooks/useRun.ts`

```typescript
export type UseRunState =
  | { status: "idle" }
  | { status: "loading"; runId: string }
  | { status: "ready"; snapshot: Snapshot }
  | { status: "error"; runId: string; error: ApiError; lastSnapshot?: Snapshot };

export function useRun(runId: string | null): {
  state: UseRunState;
  refetch: () => Promise<void>;
  createAndNavigate: (question: string) => Promise<string>; // 返回新 runId
};
```

## `hooks/useRunEvents.ts`

```typescript
/** snapshot.version 变化时自动重订阅；终态自动 close */
export function useRunEvents(
  runId: string | null,
  snapshot: Snapshot | null,
  onTick: () => void,
): { connected: boolean };
```

## `hooks/useScience125.ts`

```typescript
export function useScience125(): {
  data: Science125Data | null;
  loading: boolean;
  error: ApiError | null;
  pickRandom(): Science125Question | null;
  getById(id: number): Science125Question | undefined;
};
```

## `hooks/useConfig.ts`

```typescript
export function useConfig(): {
  config: ConfigStatus | null;
  loading: boolean;
  saving: boolean;
  error: ApiError | null;
  save(next: { api_key?: string; model_id?: string; base_url?: string }): Promise<void>;
  reload(): Promise<void>;
};
```

## `features/shell`（C4 预览）

```typescript
export type ShellProps = {
  runId: string | null;
  onRunIdChange(id: string | null): void;
  onStartResearch(question: string): Promise<void>;
};

export function AppShell(props: ShellProps): JSX.Element;
export function QuestionSidebar(props: { onSelect(question: string, id?: number): void }): JSX.Element;
```

## `features/workspace`（C4 预览）

```typescript
export function RunWorkspace(props: { snapshot: Snapshot; onRefetch(): void }): JSX.Element;
export function ArtifactPanel(props: { artifactId: string | null }): JSX.Element;
```

## `features/settings`（C4 预览）

```typescript
export function SettingsDialog(props: { open: boolean; onOpenChange(open: boolean): void }): JSX.Element;
```
