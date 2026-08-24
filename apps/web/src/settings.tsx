import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { fetchConfig, saveConfig, type ConfigStatus } from "./api";

/**
 * 设置弹窗（右上角触发，以齿轮图标与模态对话框交互，对标现代 Agent 系统）。
 *
 * 环境里已有 QWEN_API_KEY 时无需重复配置；没有时可随时在弹窗粘贴，
 * 立即生效、只存进程内存、重启即忘。密钥只进不出。
 */

const CREDENTIAL_LABEL: Record<ConfigStatus["credential"], string> = {
  environment: "已从环境变量读取",
  override: "已在页面配置（进程内，重启即忘）",
  absent: "未配置",
};

export function Settings({
  initialStatus,
  defaultOpen = false,
}: {
  initialStatus?: ConfigStatus;
  defaultOpen?: boolean;
} = {}) {
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [apiKey, setApiKey] = useState("");
  const [modelId, setModelId] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [feedback, setFeedback] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const { data: config, isError } = useQuery({
    queryKey: ["config"],
    queryFn: fetchConfig,
    initialData: initialStatus,
    enabled: initialStatus === undefined,
  });

  const status: ConfigStatus | null | "unreachable" = isError ? "unreachable" : (config ?? initialStatus ?? null);

  useEffect(() => {
    if (config && config.credential === "absent" && config.runtime === "live" && !initialStatus) {
      setIsOpen(true);
    }
  }, [config, initialStatus]);

  useEffect(() => {
    if (!isOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setIsOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen]);

  const saveMutation = useMutation({
    mutationFn: saveConfig,
    onSuccess: (updated) => {
      queryClient.setQueryData(["config"], updated);
      setApiKey("");
      setModelId("");
      setBaseUrl("");
      setFeedback({ tone: "ok", text: "已保存，下一次运行即生效。" });
    },
    onError: (cause) => {
      setFeedback({ tone: "error", text: cause instanceof Error ? cause.message : String(cause) });
    },
  });

  async function save() {
    const next: { api_key?: string; model_id?: string; base_url?: string } = {};
    if (apiKey.trim() !== "") next.api_key = apiKey.trim();
    if (modelId.trim() !== "") next.model_id = modelId.trim();
    if (baseUrl.trim() !== "") next.base_url = baseUrl.trim();
    if (Object.keys(next).length === 0) {
      setFeedback({ tone: "error", text: "没有要保存的改动。" });
      return;
    }
    setFeedback(null);
    saveMutation.mutate(next);
  }

  if (status === null) return null;
  if (status === "unreachable") {
    return (
      <span className="text-xs text-destructive px-2">
        设置读取失败：后端不可达。请运行 <code className="font-mono">pnpm run dev</code>。
      </span>
    );
  }

  const missing = status.credential === "absent" && status.runtime === "live";

  return (
    <div>
      {/* 顶部右侧设置触发条 */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-label="系统与模型设置"
        className="flex items-center gap-2 rounded-md border border-border/60 bg-background/80 px-2.5 py-1 text-left text-xs transition-colors hover:border-border hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring cursor-pointer shadow-xs"
      >
        <span className="text-xs" aria-hidden="true">
          ⚙️
        </span>
        <span className="font-mono text-xs font-semibold text-foreground">设置</span>
        <span className={`text-[11px] font-mono ${missing ? "text-destructive font-medium" : "text-muted-foreground"}`}>
          凭据：{CREDENTIAL_LABEL[status.credential]}
        </span>
        {status.runtime === "deterministic" && (
          <Badge variant="outline" className="font-mono text-[9px] px-1 py-0 shrink-0">
            deterministic
          </Badge>
        )}
      </button>

      {/* 模态弹窗 (Settings Modal Dialog) */}
      {isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="settings-dialog-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsOpen(false);
          }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
        >
          <Card className="w-full max-w-md border-border/80 bg-card p-5 shadow-xl space-y-4">
            {/* 弹窗 Header */}
            <div className="flex items-center justify-between border-b border-border/40 pb-3">
              <div className="flex items-center gap-2">
                <span className="text-base" aria-hidden="true">
                  ⚙️
                </span>
                <h3 id="settings-dialog-title" className="font-mono text-sm font-bold text-foreground">
                  系统与模型设置
                </h3>
              </div>
              <button
                type="button"
                aria-label="关闭设置"
                onClick={() => setIsOpen(false)}
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring text-xs cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* 状态指示 */}
            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/40 p-2.5 font-mono text-xs">
              <span className="text-muted-foreground">当前模型:</span>
              <span className="font-semibold text-foreground">{status.model_id}</span>
              <span className="text-muted-foreground">·</span>
              <span className={missing ? "text-destructive font-semibold" : "text-muted-foreground"}>
                凭据：{CREDENTIAL_LABEL[status.credential]}
              </span>
            </div>

            {/* 表单输入区 */}
            <div className="space-y-3">
              <div className="space-y-1">
                <label htmlFor="setting-api-key" className="font-mono text-[11px] text-muted-foreground">
                  百炼 API Key (只进不出)
                </label>
                <input
                  id="setting-api-key"
                  type="password"
                  autoComplete="off"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder={
                    status.credential === "absent"
                      ? "粘贴百炼 API Key（只存进程内存，不落盘）"
                      : "API Key（留空则沿用当前配置）"
                  }
                  className="h-8 w-full rounded-md border border-border/60 bg-background px-3 font-mono text-xs outline-none focus:border-primary focus-visible:ring-2 focus-visible:ring-ring/40"
                />
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="space-y-1">
                  <label htmlFor="setting-model-id" className="font-mono text-[11px] text-muted-foreground">
                    模型 ID
                  </label>
                  <input
                    id="setting-model-id"
                    value={modelId}
                    onChange={(event) => setModelId(event.target.value)}
                    placeholder={`模型 id（当前 ${status.model_id}）`}
                    className="h-8 w-full rounded-md border border-border/60 bg-background px-3 font-mono text-xs outline-none focus:border-primary focus-visible:ring-2 focus-visible:ring-ring/40"
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="setting-base-url" className="font-mono text-[11px] text-muted-foreground">
                    Base URL
                  </label>
                  <input
                    id="setting-base-url"
                    value={baseUrl}
                    onChange={(event) => setBaseUrl(event.target.value)}
                    placeholder={`端点（当前 ${status.base_url}）`}
                    className="h-8 w-full rounded-md border border-border/60 bg-background px-3 font-mono text-xs outline-none focus:border-primary focus-visible:ring-2 focus-visible:ring-ring/40"
                  />
                </div>
              </div>
            </div>

            {/* 反馈信息 */}
            {feedback !== null && (
              <p
                className={`text-xs ${
                  feedback.tone === "error" ? "text-destructive font-medium" : "text-emerald-500 font-medium"
                }`}
              >
                {feedback.text}
              </p>
            )}

            {/* 弹窗 Footer */}
            <div className="flex items-center justify-end gap-2 border-t border-border/40 pt-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsOpen(false)}
                className="h-8 text-xs"
              >
                关闭
              </Button>
              <Button
                type="button"
                variant="default"
                size="sm"
                onClick={() => void save()}
                disabled={saveMutation.isPending}
                className="h-8 text-xs"
              >
                {saveMutation.isPending ? "保存中…" : "保存"}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
