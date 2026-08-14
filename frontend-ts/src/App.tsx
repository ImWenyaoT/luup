import { useCallback, useEffect, useRef, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, createRun, fetchArtifact, fetchRun, subscribe } from "./api";
import { ArtifactView } from "./artifact-view";
import { ROLE_LABEL, ROLE_ORDER, TERMINAL, type Artifact, type Snapshot } from "./types";

const STATUS_LABEL: Record<string, string> = {
  running: "进行中",
  completed: "已完成",
  review_rejected: "评审拒绝",
  failed: "失败",
};

export function App() {
  const [question, setQuestion] = useState("");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [artifactError, setArtifactError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const version = useRef(0);
  const activeRun = useRef<string | null>(null);
  const artifactRequest = useRef(0);
  const refreshInFlight = useRef<Promise<void> | null>(null);
  const refreshPending = useRef(false);
  const recoveryTimer = useRef<number | null>(null);

  const refresh: (runId: string) => Promise<void> = useCallback((runId: string) => {
    if (activeRun.current !== runId) return Promise.resolve();
    if (refreshInFlight.current) {
      // 进行中的请求可能拿到较早快照；记住这次 tick，结束后最多补拉一次。
      refreshPending.current = true;
      return refreshInFlight.current;
    }

    const task: Promise<void> = (async () => {
      let lastError: unknown;
      // 最后一帧后 SSE 会关闭；快照请求若刚好抖一下，就原地重试，不等一条不会再来的事件。
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const next = await fetchRun(runId);
          if (activeRun.current !== runId) return;
          if (next.version < version.current) return;
          version.current = next.version;
          setSnapshot(next);
          setRefreshError(null);
          if (recoveryTimer.current !== null) window.clearTimeout(recoveryTimer.current);
          recoveryTimer.current = null;
          return;
        } catch (cause) {
          lastError = cause;
          if (activeRun.current !== runId) return;
          if (cause instanceof ApiError && cause.status >= 400 && cause.status < 500) {
            setRefreshError(cause.message);
            return;
          }
          if (attempt < 2) await new Promise((done) => setTimeout(done, 500));
        }
      }
      setRefreshError(lastError instanceof Error ? lastError.message : String(lastError));
      if (recoveryTimer.current === null) {
        recoveryTimer.current = window.setTimeout(() => {
          recoveryTimer.current = null;
          if (activeRun.current === runId) void refresh(runId);
        }, 5_000);
      }
    })().finally(() => {
      if (refreshInFlight.current !== task) return;
      refreshInFlight.current = null;
      if (refreshPending.current) {
        refreshPending.current = false;
        if (activeRun.current === runId) void refresh(runId);
      }
    });
    refreshInFlight.current = task;
    return task;
  }, []);

  useEffect(() => {
    // Run 在 SQLite 里继续执行，页面刷新不能把入口弄丢。URL 也方便直接分享和排障。
    const runId = new URLSearchParams(window.location.search).get("run");
    if (!runId) return;
    activeRun.current = runId;
    version.current = 0;
    void refresh(runId);
  }, [refresh]);

  useEffect(() => {
    if (!snapshot || TERMINAL.has(snapshot.status)) return;
    return subscribe(snapshot.id, version.current, () => void refresh(snapshot.id));
  }, [snapshot?.id, snapshot?.status, refresh]);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const created = await createRun(question);
      // 请求失败时旧 Run 还在后台推进，不能提前切断它的 refresh/SSE。
      artifactRequest.current += 1;
      setArtifact(null);
      setArtifactError(null);
      // 等待创建期间，旧 Artifact 请求可能刚好失败；切换时一并清掉旧 Run 的错误。
      setError(null);
      setRefreshError(null);
      if (recoveryTimer.current !== null) window.clearTimeout(recoveryTimer.current);
      recoveryTimer.current = null;
      refreshInFlight.current = null;
      refreshPending.current = false;
      activeRun.current = created.id;
      version.current = created.version;
      const url = new URL(window.location.href);
      url.searchParams.set("run", created.id);
      window.history.replaceState(null, "", url);
      setSnapshot(created);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function openArtifact(id: string) {
    const request = ++artifactRequest.current;
    const runId = activeRun.current;
    try {
      const next = await fetchArtifact(id);
      // 新 Run 或后一次点击都会让这份旧响应失效。
      if (request === artifactRequest.current && runId === activeRun.current) {
        setArtifact(next);
        setArtifactError(null);
      }
    } catch (cause) {
      if (request === artifactRequest.current) {
        setArtifactError(cause instanceof Error ? cause.message : String(cause));
      }
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-6 py-10">
      <header className="space-y-1">
        <h1 className="font-mono text-lg font-semibold tracking-tight">Luup</h1>
        <p className="text-sm text-muted-foreground">
          五个角色按固定顺序推进；证据由代码冻结，模型只能引用。
        </p>
      </header>

      <section className="space-y-3">
        <Textarea
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="提出一个可以设计实验去检验的研究问题"
          rows={3}
          disabled={busy}
        />
        <Button onClick={() => void start()} disabled={busy || question.trim() === ""}>
          {busy ? "正在建立…" : "开始研究"}
        </Button>
      </section>

      {(error ?? artifactError ?? refreshError) !== null && (
        <Alert variant="destructive"><AlertDescription>{error ?? artifactError ?? refreshError}</AlertDescription></Alert>
      )}

      {snapshot !== null && (
        <>
          <RunHeader snapshot={snapshot} />
          <Pipeline snapshot={snapshot} />
          <EvidenceChain snapshot={snapshot} />
          <Artifacts
            snapshot={snapshot}
            onOpen={(id) => void openArtifact(id)}
          />
          {artifact !== null && <ArtifactView artifact={artifact} />}
        </>
      )}
    </div>
  );
}

function RunHeader({ snapshot }: { snapshot: Snapshot }) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-y py-3">
      <Badge variant={snapshot.status === "completed" ? "default" : "secondary"}>
        {STATUS_LABEL[snapshot.status] ?? snapshot.status}
      </Badge>
      {snapshot.error_code !== null && (
        <span className="font-mono text-xs text-muted-foreground">{snapshot.error_code}</span>
      )}
      <span className="flex-1 text-sm">{snapshot.question}</span>
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">技术详情</summary>
        <div className="mt-1 font-mono">version: {snapshot.version}</div>
      </details>
    </div>
  );
}

/** 五阶段进度。补证与修订会让同一个角色出现第二次 —— 那正是两条有界回路的痕迹。 */
function Pipeline({ snapshot }: { snapshot: Snapshot }) {
  return (
    <section className="space-y-2">
      <h2 className="font-mono text-xs uppercase tracking-widest text-muted-foreground">固定五阶段</h2>
      <ol className="grid gap-2 sm:grid-cols-5">
        {ROLE_ORDER.map((role) => {
          const attempts = snapshot.attempts.filter((item) => item.role === role);
          const last = attempts.at(-1);
          const tone = last?.status === "completed"
            ? "border-teal-600/60 bg-teal-50/60"
            : last?.status === "failed"
              ? "border-destructive/50 bg-destructive/5"
              : last?.status === "running"
                ? "border-foreground/40"
                : "border-dashed opacity-50";
          return (
            <li key={role} className={`rounded-md border px-3 py-2 ${tone}`}>
              <div className="text-xs font-medium">{ROLE_LABEL[role]}</div>
              <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                {attempts.length === 0 ? "待执行" : `${attempts.length} 次尝试`}
                {last && last.corrections > 0 && ` · 纠错 ${last.corrections}`}
                {last?.failure_code && ` · ${last.failure_code}`}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** 证据链：每一次检索都是一条记录，它下面挂着那次检索返回的可引用条目。 */
function EvidenceChain({ snapshot }: { snapshot: Snapshot }) {
  if (snapshot.tool_evidence.length === 0) return null;
  return (
    <section className="space-y-2">
      <h2 className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
        证据链 · {snapshot.tool_evidence.length} 次检索
      </h2>
      <ul className="space-y-2">
        {snapshot.tool_evidence.map((evidence) => (
          <li key={evidence.id} className="rounded-md border px-3 py-2">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="font-mono text-[11px] text-teal-700">{evidence.id}</span>
              <Badge variant="outline">{evidence.tool_name}</Badge>
              <span className="font-mono text-[11px] text-muted-foreground">{evidence.status}</span>
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer">技术详情</summary>
                <div className="mt-1">query: {evidence.query}</div>
              </details>
            </div>
            <ul className="mt-2 space-y-1 border-l pl-3">
              {evidence.output.citations.map((citation) => (
                <li key={citation.locator} className="text-xs">
                  <span className="font-mono text-[11px] text-muted-foreground">{citation.locator}</span>
                  {" · "}
                  {citation.url === null
                    ? citation.title
                    : <a className="underline underline-offset-2" href={citation.url} target="_blank" rel="noreferrer">{citation.title}</a>}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Artifacts({ snapshot, onOpen }: { snapshot: Snapshot; onOpen: (id: string) => void }) {
  if (snapshot.artifacts.length === 0) return null;
  return (
    <section className="space-y-2">
      <h2 className="font-mono text-xs uppercase tracking-widest text-muted-foreground">冻结产物</h2>
      <div className="flex flex-wrap gap-2">
        {snapshot.artifacts.map((item) => (
          <Button
            key={item.id}
            variant={item.id === snapshot.final_artifact_id ? "default" : "outline"}
            size="sm"
            onClick={() => onOpen(item.id)}
          >
            {item.type}
          </Button>
        ))}
      </div>
    </section>
  );
}
