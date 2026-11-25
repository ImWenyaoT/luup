/** 桌面壳配置：环境变量是唯一配置面（与 server seam 纪律一致）。 */

export type DesktopConfig = {
  webOrigin: string;
  apiOrigin: string;
  startPath: string;
  manageServices: boolean;
  apiPort: number;
  webPort: number;
  runtime: "live" | "deterministic";
};

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function parsePort(raw: string | undefined, fallback: number): number {
  const n = Number(raw ?? fallback);
  return Number.isSafeInteger(n) && n > 0 && n < 65536 ? n : fallback;
}

export function loadDesktopConfig(envMap: NodeJS.ProcessEnv = process.env): DesktopConfig {
  const apiPort = parsePort(envMap.PORT ?? envMap.LUUP_API_PORT, 8000);
  const webPort = parsePort(envMap.LUUP_WEB_PORT, 3000);
  const apiOrigin = (envMap.LUUP_API_ORIGIN?.trim() || `http://127.0.0.1:${apiPort}`).replace(/\/$/, "");
  const webOrigin = (envMap.LUUP_WEB_ORIGIN?.trim() || `http://127.0.0.1:${webPort}`).replace(/\/$/, "");
  const startPath = envMap.LUUP_DESKTOP_START_PATH?.trim() || "/autoresearch";
  const manage = (envMap.LUUP_DESKTOP_MANAGE_SERVICES ?? "1").trim() !== "0";
  const runtime = envMap.LUUP_RUNTIME === "live" ? "live" : "deterministic";
  return {
    webOrigin,
    apiOrigin,
    startPath: startPath.startsWith("/") ? startPath : `/${startPath}`,
    manageServices: manage,
    apiPort,
    webPort,
    runtime,
  };
}

export function desktopEntryUrl(config: DesktopConfig): string {
  return new URL(config.startPath, `${config.webOrigin}/`).toString();
}

export function healthUrl(config: DesktopConfig): string {
  return `${config.apiOrigin}/health`;
}

/** 供测试：不读真实 process.env 时用。 */
export function readEnvAlias(name: string): string | undefined {
  return env(name);
}
