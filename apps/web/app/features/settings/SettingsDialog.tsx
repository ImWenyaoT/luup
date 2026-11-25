import styled from "@emotion/styled";
import { useEffect, useRef, useState } from "react";
import { Button as AstryxButton } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Text } from "@astryxdesign/core/Text";
import { VStack, HStack } from "@astryxdesign/core/Stack";
import { CloseIcon, GearIcon } from "../../Icons";
import { Button, colors, IconButton, Input, Label, mono, Select } from "../../styles";
import { useConfig } from "../../hooks/useConfig";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { fetchSiwcStatus, logoutSiwc, startSiwc } from "../../lib/api/siwc";
import type { ApiSurface, ConfigSaveBody, ProviderId, SiwcStatus } from "../../lib/types/wire";
import { useApiClient } from "../../providers/api";

export type SettingsDialogProps = { open: boolean; onOpenChange: (open: boolean) => void };

const PROVIDER_OPTIONS: { value: ProviderId; label: string }[] = [
  { value: "openai", label: "OpenAI" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "openai-compatible", label: "OpenAI-compatible" },
];

const SURFACE_OPTIONS: { value: ApiSurface; label: string }[] = [
  { value: "responses", label: "Responses API" },
  { value: "chat", label: "Chat Completions" },
];

const CREDENTIAL_LABEL: Record<"override" | "siwc" | "environment" | "absent", string> = {
  environment: "已从环境变量读取",
  override: "已在页面配置（进程内，重启即忘）",
  siwc: "已通过 Sign in with ChatGPT",
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
function apiKeyHint(provider: ProviderId): string {
  if (provider === "deepseek") {
    return "DeepSeek 使用 DEEPSEEK_API_KEY；留空则不更新，密钥只写入当前服务进程。";
  }
  if (provider === "openai") {
    return "OpenAI 可用 API Key（OPENAI_API_KEY）或下方 Sign in with ChatGPT；留空则不更新。";
  }
  return "OpenAI-compatible 端点使用 API Key（如 LUUP_API_KEY）；留空则不更新，密钥只写入当前服务进程。";
}

export function SettingsTrigger({ onOpen }: { onOpen: () => void }) {
  const { config } = useConfig();
  if (!config) return null;
  return (
    <Button compact data-testid="open-settings" aria-label="设置" title="设置" onClick={onOpen}>
      <GearIcon />
      <span>设置</span>
      <CredentialText>凭据：{CREDENTIAL_LABEL[config.provider_credential ?? config.credential]}</CredentialText>
      {config.runtime === "deterministic" && <RuntimeText>deterministic</RuntimeText>}
    </Button>
  );
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const client = useApiClient();
  const { config, loading, saving, error, save, reload } = useConfig();
  const [apiKey, setApiKey] = useState("");
  const [modelId, setModelId] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [provider, setProvider] = useState<ProviderId>("openai-compatible");
  const [apiSurface, setApiSurface] = useState<ApiSurface>("chat");
  const [siwc, setSiwc] = useState<SiwcStatus | null>(null);
  const [siwcBusy, setSiwcBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  useFocusTrap({ active: open, containerRef: boxRef, onEscape: () => onOpenChange(false) });

  useEffect(() => {
    if (!open) return;
    void reload();
    setApiKey("");
    setFeedback(null);
    setSiwcBusy(false);
    void (async () => {
      try {
        setSiwc(await fetchSiwcStatus(client));
      } catch {
        /* 服务端 seam 未就绪时回落到 config.siwc */
      }
    })();
  }, [open, reload, client]);

  useEffect(() => {
    if (!config) return;
    // 用 provider_*：legacy model_id/base_url 仍是 Qwen/DashScope，勿回写成 openai/deepseek override。
    setModelId(config.provider_model_id ?? config.model_id);
    setBaseUrl(config.provider_base_url ?? "");
    setProvider(config.provider ?? "openai-compatible");
    setApiSurface(
      config.api_surface ?? (config.provider === "openai" || config.provider === "deepseek" ? "responses" : "chat"),
    );
    setSiwc((prev) => prev ?? config.siwc ?? null);
  }, [config]);

  if (!open) return null;

  const handleSave = async () => {
    const next: ConfigSaveBody = {};
    if (apiKey.trim()) next.api_key = apiKey.trim();
    const currentModel = config?.provider_model_id ?? config?.model_id ?? "";
    const currentBase = config?.provider_base_url ?? "";
    if (modelId.trim() && modelId.trim() !== currentModel) next.model_id = modelId.trim();
    if (baseUrl.trim() && baseUrl.trim() !== currentBase) next.base_url = baseUrl.trim();
    if (provider && provider !== config?.provider) next.provider = provider;
    if (apiSurface && apiSurface !== config?.api_surface) next.api_surface = apiSurface;
    // 仅改了 api key，或显式切换 provider 时也要带上当前 provider，避免只写密钥丢上下文。
    if (next.api_key && !next.provider && provider) next.provider = provider;
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

  const handleSiwcStart = async () => {
    setSiwcBusy(true);
    setFeedback(null);
    try {
      const { authorize_url } = await startSiwc(client);
      window.open(authorize_url, "_blank", "noopener,noreferrer");
      setFeedback({ tone: "ok", text: "已打开 ChatGPT 登录窗口。" });
    } catch (cause) {
      setFeedback({ tone: "error", text: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      setSiwcBusy(false);
    }
  };

  const handleSiwcLogout = async () => {
    setSiwcBusy(true);
    setFeedback(null);
    try {
      const next = await logoutSiwc(client);
      setSiwc(next);
      setFeedback({ tone: "ok", text: "已退出 ChatGPT 登录。" });
    } catch (cause) {
      setFeedback({ tone: "error", text: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      setSiwcBusy(false);
    }
  };

  const siwcView = siwc ?? config?.siwc ?? null;
  const credential = config?.provider_credential ?? config?.credential;

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
            选择 provider（OpenAI / DeepSeek / OpenAI-compatible）、模型与端点。OpenAI 亦可 Sign in with ChatGPT。
          </p>
          {loading && <p>加载配置…</p>}
          {error && !feedback && (
            <p role="alert" style={{ color: colors.danger }}>
              {error.message}
            </p>
          )}
          {config && (
            <Current>
              <span>当前 provider:</span>
              <strong>{config.provider ?? "—"}</strong>
              <span>· 模型:</span>
              <strong>{config.provider_model_id ?? config.model_id}</strong>
              {credential && <span>· 凭据：{CREDENTIAL_LABEL[credential]}</span>}
              {config.runtime === "deterministic" && <span>deterministic</span>}
            </Current>
          )}
          <Grid>
            <Label>
              Provider
              <Select
                data-testid="settings-provider"
                value={provider}
                onChange={(e) => setProvider(e.target.value as ProviderId)}
              >
                {PROVIDER_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </Select>
            </Label>
            <Label>
              API Surface
              <Select
                data-testid="settings-api-surface"
                value={apiSurface}
                onChange={(e) => setApiSurface(e.target.value as ApiSurface)}
              >
                {SURFACE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </Select>
            </Label>
          </Grid>
          <Label>
            API Key (只进不出)
            <Input
              data-testid="settings-api-key"
              type="password"
              autoComplete="off"
              placeholder="留空则不更新"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
            <small style={{ color: colors.muted, fontWeight: 400 }}>{apiKeyHint(provider)}</small>
          </Label>
          <Grid>
            <Label>
              模型 ID
              <Input
                data-testid="settings-model-id"
                placeholder={config ? `模型 id（当前 ${config.provider_model_id ?? config.model_id}）` : "模型 id"}
                value={modelId}
                onChange={(e) => setModelId(e.target.value)}
              />
            </Label>
            <Label>
              Base URL
              <Input
                data-testid="settings-base-url"
                placeholder={
                  config?.provider_base_url ? `端点（当前 ${config.provider_base_url}）` : "留空 = 供应商默认端点"
                }
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
              />
            </Label>
          </Grid>
          <Card padding={3} variant="muted" data-testid="settings-siwc">
            <VStack gap={2}>
              <Text weight="semibold" size="sm">
                Sign in with ChatGPT
              </Text>
              <Text size="sm" color="secondary">
                {siwcView?.signed_in
                  ? `已登录${siwcView.email ? ` · ${siwcView.email}` : ""}${
                      siwcView.expires_at ? ` · 过期 ${siwcView.expires_at}` : ""
                    }`
                  : "未登录。OpenAI provider 可用此入口代替 API Key。"}
              </Text>
              <HStack gap={2}>
                <AstryxButton
                  data-testid="siwc-sign-in"
                  label="Sign in with ChatGPT"
                  variant="primary"
                  size="sm"
                  isDisabled={siwcBusy || siwcView?.signed_in === true}
                  onClick={() => void handleSiwcStart()}
                />
                <AstryxButton
                  data-testid="siwc-logout"
                  label="退出登录"
                  variant="secondary"
                  size="sm"
                  isDisabled={siwcBusy || !siwcView?.signed_in}
                  onClick={() => void handleSiwcLogout()}
                />
              </HStack>
            </VStack>
          </Card>
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
