import styled from "@emotion/styled";
import { useEffect, useRef, useState } from "react";
import { CloseIcon, GearIcon } from "../../Icons";
import { Button, colors, IconButton, Input, Label, mono } from "../../styles";
import { useConfig } from "../../hooks/useConfig";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import type { ConfigStatus } from "../../lib/types/wire";

export type SettingsDialogProps = { open: boolean; onOpenChange: (open: boolean) => void };
const CREDENTIAL_LABEL: Record<ConfigStatus["credential"], string> = {
  environment: "已从环境变量读取",
  override: "已在页面配置（进程内，重启即忘）",
  absent: "未配置",
};
const Overlay = styled.div`
  position: fixed;
  inset: 0;
  z-index: 100;
  display: grid;
  place-items: center;
  padding: 16px;
  background: rgba(16, 24, 40, 0.4);
`;
const DialogBox = styled.div`
  width: min(620px, 100%);
  max-height: calc(100dvh - 32px);
  overflow: auto;
  border: 1px solid ${colors.border};
  border-radius: 14px;
  background: white;
  box-shadow: 0 24px 60px rgba(16, 24, 40, 0.22);
`;
const Header = styled.div`
  display: flex;
  align-items: center;
  padding: 16px 18px;
  border-bottom: 1px solid ${colors.border};
  h2 {
    margin: 0;
    font-size: 15px;
    font-family: ${mono};
  }
`;
const Body = styled.div`
  display: grid;
  gap: 16px;
  padding: 18px;
`;
const Grid = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  @media (max-width: 560px) {
    grid-template-columns: 1fr;
  }
`;
const Current = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 9px;
  background: #f2f4f7;
  font-family: ${mono};
  font-size: 11px;
  color: ${colors.muted};
  strong {
    color: ${colors.ink};
  }
`;
const Footer = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 14px;
  border-top: 1px solid ${colors.border};
`;
const CredentialText = styled.span`
  color: ${colors.muted};
  font-size: 10px;
  @media (max-width: 700px) {
    display: none;
  }
`;
const RuntimeText = styled.span`
  font: 9px ${mono};
  @media (max-width: 700px) {
    display: none;
  }
`;

export function SettingsTrigger({ onOpen }: { onOpen: () => void }) {
  const { config } = useConfig();
  if (!config) return null;
  return (
    <Button compact data-testid="open-settings" onClick={onOpen}>
      <GearIcon />
      <span>设置</span>
      <CredentialText>凭据：{CREDENTIAL_LABEL[config.credential]}</CredentialText>
      {config.runtime === "deterministic" && <RuntimeText>deterministic</RuntimeText>}
    </Button>
  );
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const { config, loading, saving, error, save, reload } = useConfig();
  const [apiKey, setApiKey] = useState("");
  const [modelId, setModelId] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [feedback, setFeedback] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  useFocusTrap({ active: open, containerRef: boxRef, onEscape: () => onOpenChange(false) });
  useEffect(() => {
    if (!open) return;
    void reload();
    setApiKey("");
    setFeedback(null);
  }, [open, reload]);
  useEffect(() => {
    if (config) {
      setModelId(config.model_id);
      setBaseUrl(config.base_url);
    }
  }, [config]);
  if (!open) return null;
  const handleSave = async () => {
    const next: { api_key?: string; model_id?: string; base_url?: string } = {};
    if (apiKey.trim()) next.api_key = apiKey.trim();
    if (modelId.trim()) next.model_id = modelId.trim();
    if (baseUrl.trim()) next.base_url = baseUrl.trim();
    if (!Object.keys(next).length) {
      setFeedback({ tone: "error", text: "没有要保存的改动。" });
      return;
    }
    setFeedback(null);
    try {
      await save(next);
      setApiKey("");
      setFeedback({ tone: "ok", text: "已保存，下一次运行即生效。" });
    } catch (cause) {
      setFeedback({ tone: "error", text: cause instanceof Error ? cause.message : String(cause) });
    }
  };
  return (
    <Overlay
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onOpenChange(false);
      }}
    >
      <DialogBox
        ref={boxRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        aria-describedby="settings-description"
        data-testid="settings-dialog"
      >
        <Header>
          <h2 id="settings-title">系统与模型设置</h2>
          <IconButton aria-label="关闭设置" onClick={() => onOpenChange(false)} style={{ marginLeft: "auto" }}>
            <CloseIcon />
          </IconButton>
        </Header>
        <Body>
          <p id="settings-description" style={{ margin: 0, color: colors.muted, fontSize: 12 }}>
            配置百炼凭据、模型 ID 与 OpenAI-compatible 端点。
          </p>
          {loading && <p>加载配置…</p>}
          {error && !feedback && (
            <p role="alert" style={{ color: colors.danger }}>
              {error.message}
            </p>
          )}
          {config && (
            <Current>
              <span>当前模型:</span>
              <strong>{config.model_id}</strong>
              <span>· 凭据：{CREDENTIAL_LABEL[config.credential]}</span>
              {config.runtime === "deterministic" && <span>deterministic</span>}
            </Current>
          )}
          <Label>
            百炼 API Key (只进不出)
            <Input
              data-testid="settings-api-key"
              type="password"
              autoComplete="off"
              placeholder="留空则不更新"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
            <small style={{ color: colors.muted, fontWeight: 400 }}>留空则不更新；密钥只写入当前服务进程。</small>
          </Label>
          <Grid>
            <Label>
              模型 ID
              <Input
                data-testid="settings-model-id"
                placeholder={config ? `模型 id（当前 ${config.model_id}）` : "模型 id"}
                value={modelId}
                onChange={(e) => setModelId(e.target.value)}
              />
            </Label>
            <Label>
              Base URL
              <Input
                data-testid="settings-base-url"
                placeholder={config ? `端点（当前 ${config.base_url}）` : "Base URL"}
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
              />
            </Label>
          </Grid>
          {feedback && (
            <p
              role={feedback.tone === "error" ? "alert" : "status"}
              aria-live="polite"
              style={{ margin: 0, color: feedback.tone === "error" ? colors.danger : colors.success, fontSize: 12 }}
            >
              {feedback.text}
            </p>
          )}
          <Footer>
            <Button onClick={() => onOpenChange(false)}>关闭</Button>
            <Button tone="primary" data-testid="save-settings" onClick={() => void handleSave()} disabled={saving}>
              {saving ? "保存中…" : "保存"}
            </Button>
          </Footer>
        </Body>
      </DialogBox>
    </Overlay>
  );
}
