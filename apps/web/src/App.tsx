import { useCallback, useEffect, useRef, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, createRun, fetchArtifact, fetchRun, fetchScience125, subscribe } from "./api";
import { ArtifactView } from "./artifact-view";
import { AuditTrace } from "./audit-trace";
import { FeedbackHistory } from "./feedback-history";
import { FeedbackComposer } from "./feedback-composer";
import { Settings } from "./settings";
import { Sidebar } from "./sidebar";
import { SubagentLineage } from "./subagent-lineage";
import { Trajectory } from "./trajectory";
import { TERMINAL, type Artifact, type Science125Data, type Science125Question, type Snapshot } from "./types";

const STATUS_LABEL: Record<string, string> = {
  running: "进行中",
  completed: "已完成",
  review_rejected: "评审拒绝",
  failed: "失败",
};

const SUGGESTIONS = [
  { id: 61, label: "#61 脉冲星形成", text: "How are pulsars formed?" },
  { id: 2, label: "#2 黎曼猜想", text: "Is the Riemann hypothesis true?" },
  { id: 10, label: "#10 AI重塑化学", text: "Will AI redefine the future of chemistry?" },
  { id: 13, label: "#13 预测下一场大流行", text: "Can we predict the next pandemic?" },
];

export function App() {
  const [question, setQuestion] = useState("");
  const [scienceData, setScienceData] = useState<Science125Data | null>(null);
  const [selectedQuestion, setSelectedQuestion] = useState<Science125Question | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [artifactError, setArtifactError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  const version = useRef(0);
  const activeRun = useRef<string | null>(null);
  const artifactRequest = useRef(0);
  const refreshInFlight = useRef<Promise<void> | null>(null);
  const refreshPending = useRef(false);
  const recoveryTimer = useRef<number | null>(null);

  // 预载 Science 125 题库
  useEffect(() => {
    void fetchScience125()
      .then(setScienceData)
      .catch(() => null);
  }, []);

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

  async function start(overrideQuestion?: string) {
    const targetQuestion = (overrideQuestion ?? question).trim();
    if (!targetQuestion) return;

    setBusy(true);
    setError(null);
    try {
      const created = await createRun(targetQuestion);
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

  const handleSelectQuestion = (q: Science125Question | null) => {
    setSelectedQuestion(q);
    if (q) {
      setQuestion(q.question);
    } else {
      setQuestion("");
    }
  };

  const handleNewResearch = () => {
    activeRun.current = null;
    version.current = 0;
    setSnapshot(null);
    setArtifact(null);
    setError(null);
    setArtifactError(null);
    setRefreshError(null);
    setSelectedQuestion(null);
    setQuestion("");
    const url = new URL(window.location.href);
    url.searchParams.delete("run");
    window.history.replaceState(null, "", url);
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background font-sans text-foreground">
      {/* 左侧侧边栏 */}
      {isSidebarOpen && (
        <Sidebar
          scienceData={scienceData}
          selectedQuestion={selectedQuestion}
          onSelectQuestion={handleSelectQuestion}
          onDirectRun={(targetText) => void start(targetText)}
          onNewResearch={handleNewResearch}
          onToggleCollapse={() => setIsSidebarOpen(false)}
          disabled={busy}
        />
      )}

      {/* 右侧主工作区 */}
      <div className="flex flex-1 flex-col h-full overflow-hidden">
        {/* 顶部状态与设置条 */}
        <header className="flex h-12 items-center justify-between border-b border-border/40 px-4 sm:px-6 backdrop-blur-md shrink-0">
          <div className="flex items-center gap-2.5">
            {!isSidebarOpen && (
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={() => setIsSidebarOpen(true)}
                title="展开题库与侧边栏"
                className="h-7 gap-1.5 px-2 text-xs font-medium cursor-pointer"
              >
                <span>☰</span>
                <span className="hidden sm:inline">题库选题</span>
              </Button>
            )}
            <div className="flex items-center gap-1.5 font-mono text-xs font-semibold text-muted-foreground">
              <span>Luup</span>
              <span>·</span>
              <span>Science 125</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {snapshot && (
              <div className="flex items-center gap-2 font-mono text-xs">
                <Badge variant={snapshot.status === "completed" ? "default" : "secondary"} className="text-[10px]">
                  {STATUS_LABEL[snapshot.status] ?? snapshot.status}
                </Badge>
                <span className="text-muted-foreground text-[11px]">v{snapshot.version}</span>
              </div>
            )}
            <Settings />
          </div>
        </header>

        {/* 主画布滚动区域 */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          <div className="mx-auto max-w-5xl space-y-6">
            {/* 错误提示 */}
            {(error ?? artifactError ?? refreshError) !== null && (
              <Alert variant="destructive">
                <AlertDescription>{error ?? artifactError ?? refreshError}</AlertDescription>
              </Alert>
            )}

            {/* 空闲欢迎态 */}
            {!snapshot && (
              <div className="flex flex-col items-center justify-center min-h-[60vh] text-center space-y-6 max-w-2xl mx-auto py-8">
                <div className="space-y-2">
                  <h2 className="font-mono text-3xl font-bold tracking-tight sm:text-4xl text-foreground">
                    AI Scientist
                  </h2>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    面向《Science》125 个前沿科学问题的科研 Agent 流水线。证据由代码冻结，模型只能引用。
                  </p>
                </div>

                {/* 快捷赛题建议气泡 */}
                <div className="flex flex-wrap justify-center gap-1.5 pt-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => {
                        setQuestion(s.text);
                        void start(s.text);
                      }}
                      disabled={busy}
                      className="rounded-full border border-border/60 bg-muted/40 px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:bg-card hover:text-foreground cursor-pointer"
                    >
                      {s.label}
                    </button>
                  ))}
                </div>

                {/* 居中输入框 */}
                <div className="w-full space-y-2 pt-2 text-left">
                  <div className="flex items-center justify-between px-1">
                    <span className="font-mono text-[11px] font-medium text-muted-foreground">
                      {selectedQuestion ? `已选 #${selectedQuestion.id} · ${selectedQuestion.domain}` : "研究课题输入"}
                    </span>
                    {question && (
                      <span className="font-mono text-[10px] text-muted-foreground">{question.length} 字符</span>
                    )}
                  </div>

                  <div className="relative flex items-end gap-2">
                    <Textarea
                      value={question}
                      onChange={(event) => {
                        setQuestion(event.target.value);
                        if (selectedQuestion && event.target.value !== selectedQuestion.question) {
                          setSelectedQuestion(null);
                        }
                      }}
                      onKeyDown={(event) => {
                        if (
                          (event.metaKey || event.ctrlKey) &&
                          event.key === "Enter" &&
                          !busy &&
                          question.trim() !== ""
                        ) {
                          event.preventDefault();
                          void start();
                        }
                      }}
                      placeholder="提出一个可以设计实验去检验的研究问题"
                      rows={3}
                      disabled={busy}
                      className="resize-none text-xs bg-background focus-visible:ring-primary min-h-[64px]"
                    />

                    <Button
                      onClick={() => void start()}
                      disabled={busy || question.trim() === ""}
                      size="sm"
                      className="h-[64px] min-w-[88px] text-xs font-medium shrink-0 shadow-xs cursor-pointer"
                    >
                      {busy ? "运行中…" : "开始研究"}
                    </Button>
                  </div>

                  <div className="flex items-center justify-between px-1 text-[10px] text-muted-foreground">
                    <span>
                      快捷键: <kbd className="rounded border bg-muted px-1 font-mono text-[9px]">⌘ / Ctrl</kbd> +{" "}
                      <kbd className="rounded border bg-muted px-1 font-mono text-[9px]">Enter</kbd>
                    </span>
                    <span>支持左侧 125 题库点选或自由输入</span>
                  </div>
                </div>
              </div>
            )}

            {/* 活动 Run 科研工作台 */}
            {snapshot !== null && (
              <main className="space-y-5">
                <RunHeader snapshot={snapshot} />

                <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-12">
                  {/* 左侧执行与轨迹栏 */}
                  <div className="space-y-4 lg:col-span-5">
                    <SubagentLineage snapshot={snapshot} />
                    <AuditTrace snapshot={snapshot} />
                    <Trajectory snapshot={snapshot} />
                    <FeedbackComposer snapshot={snapshot} onSubmitted={() => void refresh(snapshot.id)} />
                    <FeedbackHistory snapshot={snapshot} />
                  </div>

                  {/* 右侧科研成果展台 */}
                  <div className="space-y-4 lg:col-span-7 lg:sticky lg:top-2">
                    <Artifacts snapshot={snapshot} onOpen={(id) => void openArtifact(id)} />
                    {artifact !== null ? (
                      <ArtifactView artifact={artifact} />
                    ) : (
                      <Card className="border-dashed bg-card/40 p-8 text-center text-xs text-muted-foreground">
                        点击上方按钮查看详细科学假设或研究计划
                      </Card>
                    )}
                  </div>
                </div>
              </main>
            )}
          </div>
        </div>

        {/* 活动 Run 时吸底输入条 */}
        {snapshot !== null && (
          <div className="border-t border-border/40 bg-card/70 p-3.5 backdrop-blur-md shrink-0">
            <div className="mx-auto max-w-5xl space-y-2">
              <div className="flex items-center justify-between px-1">
                <span className="font-mono text-[11px] font-medium text-muted-foreground">
                  {selectedQuestion
                    ? `已选 #${selectedQuestion.id} · ${selectedQuestion.domain}`
                    : "追加研究课题或问题"}
                </span>
                {question && (
                  <span className="font-mono text-[10px] text-muted-foreground">{question.length} 字符</span>
                )}
              </div>

              <div className="relative flex items-end gap-2">
                <Textarea
                  value={question}
                  onChange={(event) => {
                    setQuestion(event.target.value);
                    if (selectedQuestion && event.target.value !== selectedQuestion.question) {
                      setSelectedQuestion(null);
                    }
                  }}
                  onKeyDown={(event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && !busy && question.trim() !== "") {
                      event.preventDefault();
                      void start();
                    }
                  }}
                  placeholder="提出一个可以设计实验去检验的研究问题"
                  rows={2}
                  disabled={busy}
                  className="resize-none text-xs bg-background/80 focus-visible:ring-primary min-h-[52px]"
                />

                <Button
                  onClick={() => void start()}
                  disabled={busy || question.trim() === ""}
                  size="sm"
                  className="h-[52px] min-w-[84px] text-xs font-medium shrink-0 shadow-xs cursor-pointer"
                >
                  {busy ? "运行中…" : "开始研究"}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function RunHeader({ snapshot }: { snapshot: Snapshot }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card/60 px-3.5 py-2.5 shadow-xs">
      <Badge variant={snapshot.status === "completed" ? "default" : "secondary"} className="text-[11px]">
        {STATUS_LABEL[snapshot.status] ?? snapshot.status}
      </Badge>
      {snapshot.error_code !== null && (
        <span className="font-mono text-xs font-semibold text-destructive">{snapshot.error_code}</span>
      )}
      <span className="flex-1 text-xs font-medium leading-relaxed">{snapshot.question}</span>
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer font-medium hover:text-foreground">技术详情</summary>
        <div className="mt-1 space-y-0.5 rounded bg-muted/50 p-2 font-mono text-[11px]">
          <div>run_id: {snapshot.id}</div>
          <div>version: {snapshot.version}</div>
        </div>
      </details>
    </div>
  );
}

function Artifacts({ snapshot, onOpen }: { snapshot: Snapshot; onOpen: (id: string) => void }) {
  if (snapshot.artifacts.length === 0) return null;
  return (
    <Card className="border-border/60 bg-card/60 p-3 shadow-xs">
      <div className="flex items-center justify-between pb-2">
        <h2 className="font-mono text-xs font-semibold uppercase tracking-widest text-muted-foreground">冻结产物</h2>
        <span className="font-mono text-[10px] text-muted-foreground">共 {snapshot.artifacts.length} 份文件</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {snapshot.artifacts.map((item) => (
          <Button
            key={item.id}
            variant={item.id === snapshot.final_artifact_id ? "default" : "outline"}
            size="xs"
            onClick={() => onOpen(item.id)}
            className="h-6 font-mono text-xs cursor-pointer"
          >
            {item.type}
          </Button>
        ))}
      </div>
    </Card>
  );
}
