import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

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
import { TERMINAL, type Science125Question, type Snapshot } from "./types";

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
  const queryClient = useQueryClient();
  const [question, setQuestion] = useState("");
  const [selectedQuestion, setSelectedQuestion] = useState<Science125Question | null>(null);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const [creationError, setCreationError] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  const [activeRunId, setActiveRunId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("run");
  });

  useEffect(() => {
    const handlePopState = () => {
      const run = new URLSearchParams(window.location.search).get("run");
      setActiveRunId(run);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const versionRef = useRef(0);

  // 1. 预载 Science 125 题库
  const { data: scienceData = null } = useQuery({
    queryKey: ["science125"],
    queryFn: fetchScience125,
    staleTime: Infinity,
  });

  // 2. 当前活动 Run 状态查询与版本保护
  const {
    data: snapshot = null,
    error: runError,
    refetch: refetchRun,
  } = useQuery({
    queryKey: ["run", activeRunId],
    queryFn: async () => {
      const next = await fetchRun(activeRunId!);
      if (next.version >= versionRef.current) {
        versionRef.current = next.version;
      }
      return next;
    },
    enabled: Boolean(activeRunId),
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
        return false;
      }
      return failureCount < 2;
    },
    retryDelay: 500,
    refetchInterval: (query) => {
      if (
        query.state.status === "error" &&
        !(query.state.error instanceof ApiError && query.state.error.status >= 400 && query.state.error.status < 500)
      ) {
        return 5000;
      }
      return false;
    },
  });

  // 3. 当前查看的科研产物 (Artifact) 查询
  const { data: artifact = null, error: artifactError } = useQuery({
    queryKey: ["artifact", selectedArtifactId],
    queryFn: () => fetchArtifact(selectedArtifactId!),
    enabled: Boolean(selectedArtifactId),
    retry: false,
  });

  // 4. SSE 事件同步：事件到达时触发 TanStack Query 重新拉取
  useEffect(() => {
    if (!snapshot || TERMINAL.has(snapshot.status)) return;
    return subscribe(snapshot.id, versionRef.current, () => {
      void refetchRun();
    });
  }, [snapshot?.id, snapshot?.status, refetchRun]);

  // 5. 新建 Run Mutation
  const createRunMutation = useMutation({
    mutationFn: createRun,
    onSuccess: (created) => {
      versionRef.current = created.version;
      queryClient.setQueryData(["run", created.id], created);
      setActiveRunId(created.id);
      setSelectedArtifactId(null);
      setCreationError(null);
      const url = new URL(window.location.href);
      url.searchParams.set("run", created.id);
      window.history.replaceState(null, "", url);
    },
    onError: (cause) => {
      setCreationError(cause instanceof Error ? cause.message : String(cause));
    },
  });

  const busy = createRunMutation.isPending;

  function start(overrideQuestion?: string) {
    const targetQuestion = (overrideQuestion ?? question).trim();
    if (!targetQuestion) return;

    setCreationError(null);
    createRunMutation.mutate(targetQuestion);
  }

  function openArtifact(id: string) {
    setSelectedArtifactId(id);
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
    setActiveRunId(null);
    setSelectedArtifactId(null);
    versionRef.current = 0;
    setSelectedQuestion(null);
    setQuestion("");
    setCreationError(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("run");
    window.history.replaceState(null, "", url);
  };

  const displayError =
    creationError ??
    (artifactError instanceof Error ? artifactError.message : artifactError ? String(artifactError) : null) ??
    (runError instanceof Error ? runError.message : runError ? String(runError) : null);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background font-sans text-foreground">
      {/* 左侧侧边栏 */}
      {isSidebarOpen && (
        <Sidebar
          scienceData={scienceData}
          selectedQuestion={selectedQuestion}
          onSelectQuestion={handleSelectQuestion}
          onDirectRun={(targetText) => start(targetText)}
          onNewResearch={handleNewResearch}
          onToggleCollapse={() => setIsSidebarOpen(false)}
          disabled={busy}
        />
      )}

      {/* 右侧主工作区 */}
      <div className="relative flex flex-1 flex-col h-full overflow-hidden">
        {/* 折叠态左侧边缘展开手柄 */}
        {!isSidebarOpen && (
          <button
            type="button"
            onClick={() => setIsSidebarOpen(true)}
            title="展开 Science 125 题库"
            className="absolute left-0 top-2.5 z-30 flex h-7 items-center gap-1.5 rounded-r-md border border-l-0 border-border/80 bg-card/95 px-2 font-mono text-xs font-medium text-foreground shadow-sm backdrop-blur-md transition-all hover:bg-card hover:text-primary hover:border-primary/50 hover:pl-2.5 cursor-pointer"
          >
            <span className="text-[10px]">▶</span>
            <span className="font-sans text-[11px] font-medium">题库选题</span>
          </button>
        )}

        {/* 顶部状态与设置条 */}
        <header className="flex h-12 items-center justify-between border-b border-border/40 px-4 sm:px-6 backdrop-blur-md shrink-0">
          <div className="flex items-center gap-2.5">
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
            {displayError !== null && (
              <Alert variant="destructive">
                <AlertDescription>{displayError}</AlertDescription>
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
                        start(s.text);
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
                          start();
                        }
                      }}
                      placeholder="提出一个可以设计实验去检验的研究问题"
                      rows={3}
                      disabled={busy}
                      className="resize-none text-xs bg-background focus-visible:ring-primary min-h-[64px]"
                    />

                    <Button
                      onClick={() => start()}
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
                    <FeedbackComposer snapshot={snapshot} onSubmitted={() => void refetchRun()} />
                    <FeedbackHistory snapshot={snapshot} />
                  </div>

                  {/* 右侧科研成果展台 */}
                  <div className="space-y-4 lg:col-span-7 lg:sticky lg:top-2">
                    <Artifacts snapshot={snapshot} onOpen={(id) => openArtifact(id)} />
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
                      start();
                    }
                  }}
                  placeholder="提出一个可以设计实验去检验的研究问题"
                  rows={2}
                  disabled={busy}
                  className="resize-none text-xs bg-background/80 focus-visible:ring-primary min-h-[52px]"
                />

                <Button
                  onClick={() => start()}
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
