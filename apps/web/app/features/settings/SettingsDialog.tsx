import { useEffect, useState } from "react";

import { useConfig } from "../../hooks/useConfig";
import type { ConfigStatus } from "../../lib/types/wire";

export type SettingsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const CREDENTIAL_LABEL: Record<ConfigStatus["credential"], string> = {
  environment: "已从环境变量读取",
  override: "已在页面配置（进程内，重启即忘）",
  absent: "未配置",
};

export function SettingsTrigger({ onOpen }: { onOpen: () => void }) {
  const { config } = useConfig();

  if (!config) return null;

  return (
    <button
      type="button"
      data-testid="open-settings"
      onClick={onOpen}
      className="flex items-center gap-2 rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-left text-xs hover:bg-neutral-50"
    >
      <span aria-hidden="true">⚙️</span>
      <span className="font-mono text-xs font-semibold">设置</span>
      <span className="text-[11px] font-mono text-neutral-600">凭据：{CREDENTIAL_LABEL[config.credential]}</span>
      {config.runtime === "deterministic" && (
        <span className="rounded border border-neutral-300 px-1 font-mono text-[9px]">deterministic</span>
      )}
    </button>
  );
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const { config, loading, saving, error, save, reload } = useConfig();
  const [apiKey, setApiKey] = useState("");
  const [modelId, setModelId] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [saveFeedback, setSaveFeedback] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    void reload();
    setApiKey("");
    setSaveFeedback(null);
  }, [open, reload]);

  useEffect(() => {
    if (!config) return;
    setModelId(config.model_id);
    setBaseUrl(config.base_url);
  }, [config]);

  if (!open) return null;

  const handleSave = async () => {
    const next: { api_key?: string; model_id?: string; base_url?: string } = {};
    if (apiKey.trim()) next.api_key = apiKey.trim();
    if (modelId.trim()) next.model_id = modelId.trim();
    if (baseUrl.trim()) next.base_url = baseUrl.trim();
    if (Object.keys(next).length === 0) {
      setSaveFeedback({ tone: "error", text: "没有要保存的改动。" });
      return;
    }
    setSaveFeedback(null);
    try {
      await save(next);
      setApiKey("");
      setSaveFeedback({ tone: "ok", text: "已保存，下一次运行即生效。" });
    } catch (cause) {
      setSaveFeedback({
        tone: "error",
        text: cause instanceof Error ? cause.message : String(cause),
      });
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      data-testid="settings-dialog"
      onClick={(e) => {
        if (e.target === e.currentTarget) onOpenChange(false);
      }}
    >
      <div className="w-full max-w-md rounded-lg border border-neutral-200 bg-white p-5 shadow-xl space-y-4">
        <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
          <h3 className="font-mono text-sm font-bold">系统与模型设置</h3>
          <button
            type="button"
            aria-label="关闭设置"
            className="rounded p-1 text-neutral-500 hover:bg-neutral-100"
            onClick={() => onOpenChange(false)}
          >
            ✕
          </button>
        </div>

        {loading && <p className="text-sm text-neutral-500">加载配置…</p>}
        {error && <p className="text-sm text-red-600">{error.message}</p>}

        {config && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-neutral-50 p-2.5 font-mono text-xs">
            <span className="text-neutral-500">当前模型:</span>
            <span className="font-semibold">{config.model_id}</span>
            <span className="text-neutral-500">·</span>
            <span className="text-neutral-600">凭据：{CREDENTIAL_LABEL[config.credential]}</span>
            {config.runtime === "deterministic" && (
              <span className="rounded border border-neutral-300 px-1 text-[9px]">deterministic</span>
            )}
          </div>
        )}

        <div className="space-y-3">
          <label className="block text-sm">
            <span className="font-mono text-[11px] text-neutral-500">百炼 API Key (只进不出)</span>
            <input
              data-testid="settings-api-key"
              type="password"
              autoComplete="off"
              className="mt-1 h-8 w-full rounded-md border border-neutral-300 px-3 font-mono text-xs"
              placeholder="留空则不更新"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </label>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="font-mono text-[11px] text-neutral-500">模型 ID</span>
              <input
                data-testid="settings-model-id"
                className="mt-1 h-8 w-full rounded-md border border-neutral-300 px-3 font-mono text-xs"
                placeholder={config ? `模型 id（当前 ${config.model_id}）` : "模型 id"}
                value={modelId}
                onChange={(e) => setModelId(e.target.value)}
              />
            </label>
            <label className="block text-sm">
              <span className="font-mono text-[11px] text-neutral-500">Base URL</span>
              <input
                data-testid="settings-base-url"
                className="mt-1 h-8 w-full rounded-md border border-neutral-300 px-3 font-mono text-xs"
                placeholder={config ? `端点（当前 ${config.base_url}）` : "Base URL"}
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
              />
            </label>
          </div>
        </div>

        {saveFeedback && (
          <p className={`text-xs font-medium ${saveFeedback.tone === "error" ? "text-red-600" : "text-emerald-600"}`}>
            {saveFeedback.text}
          </p>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-neutral-100 pt-3">
          <button
            type="button"
            className="h-8 rounded border border-neutral-300 px-3 text-xs"
            onClick={() => onOpenChange(false)}
          >
            关闭
          </button>
          <button
            type="button"
            data-testid="save-settings"
            className="h-8 rounded bg-neutral-900 px-3 text-xs text-white disabled:opacity-50"
            onClick={() => void handleSave()}
            disabled={saving}
          >
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
