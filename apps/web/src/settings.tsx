import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { fetchConfig, saveConfig, type ConfigStatus } from "./api";

/**
 * 设置面（学 dsh：环境变量是默认，页面可即时补配）。
 *
 * 环境里已有 QWEN_API_KEY 时这里什么都不用做；没有时评委可以直接在页面粘贴，
 * 立即生效、只存进程内存、重启即忘。密钥只进不出——状态永远只有三态文字。
 */

const CREDENTIAL_LABEL: Record<ConfigStatus["credential"], string> = {
  environment: "已从环境变量读取",
  override: "已在页面配置（进程内，重启即忘）",
  absent: "未配置",
};

export function Settings() {
  const [status, setStatus] = useState<ConfigStatus | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [modelId, setModelId] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [feedback, setFeedback] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchConfig().then(setStatus).catch(() => setStatus(null));
  }, []);

  async function save() {
    const next: { api_key?: string; model_id?: string; base_url?: string } = {};
    if (apiKey.trim() !== "") next.api_key = apiKey.trim();
    if (modelId.trim() !== "") next.model_id = modelId.trim();
    if (baseUrl.trim() !== "") next.base_url = baseUrl.trim();
    if (Object.keys(next).length === 0) {
      setFeedback({ tone: "error", text: "没有要保存的改动。" });
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      setStatus(await saveConfig(next));
      setApiKey("");
      setModelId("");
      setBaseUrl("");
      setFeedback({ tone: "ok", text: "已保存，下一次运行即生效。" });
    } catch (cause) {
      setFeedback({ tone: "error", text: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      setBusy(false);
    }
  }

  if (status === null) return null;
  const missing = status.credential === "absent" && status.runtime === "live";

  return (
    <details className="text-sm" open={missing}>
      <summary className="flex min-h-8 cursor-pointer list-none items-center gap-2 text-xs text-muted-foreground">
        <span className="font-mono uppercase tracking-widest">设置</span>
        <span className="font-mono text-[11px]">{status.model_id}</span>
        {status.runtime === "deterministic" && (
          <span className="rounded-sm border px-1 font-mono text-[11px]">deterministic</span>
        )}
        <span className={`text-[11px] ${missing ? "text-destructive" : ""}`}>
          凭据：{CREDENTIAL_LABEL[status.credential]}
        </span>
      </summary>
      <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]">
        <div className="space-y-2">
          <input
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={status.credential === "absent"
              ? "粘贴百炼 API Key（只存进程内存，不落盘）"
              : "API Key（留空则沿用当前配置）"}
            className="h-9 w-full rounded-md border bg-transparent px-3 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              value={modelId}
              onChange={(event) => setModelId(event.target.value)}
              placeholder={`模型 id（当前 ${status.model_id}）`}
              className="h-9 rounded-md border bg-transparent px-3 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <input
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder={`端点（当前 ${status.base_url}）`}
              className="h-9 rounded-md border bg-transparent px-3 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        </div>
        <div className="flex items-start">
          <Button size="sm" onClick={() => void save()} disabled={busy}>
            {busy ? "保存中…" : "保存"}
          </Button>
        </div>
      </div>
      {feedback !== null && (
        <p className={`mt-1 text-xs ${feedback.tone === "error" ? "text-destructive" : "text-muted-foreground"}`}>
          {feedback.text}
        </p>
      )}
    </details>
  );
}
