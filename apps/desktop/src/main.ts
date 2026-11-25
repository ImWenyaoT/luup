import { app, BrowserWindow, ipcMain, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { desktopEntryUrl, healthUrl, loadDesktopConfig } from "./config.js";
import { startManagedServices, waitForHttpOk, type ManagedServices } from "./services.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const config = loadDesktopConfig();
let services: ManagedServices | null = null;
let mainWindow: BrowserWindow | null = null;

function registerIpc(): void {
  ipcMain.handle("desktop:get-version", () => app.getVersion());
  ipcMain.handle("desktop:get-entry-url", () => desktopEntryUrl(config));
  ipcMain.handle("desktop:get-api-origin", () => config.apiOrigin);
  ipcMain.handle("desktop:open-external", async (_event, raw: unknown) => {
    if (typeof raw !== "string") return false;
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return false;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    await shell.openExternal(url.toString());
    return true;
  });
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: "Luup Autoresearch",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  // 阻止渲染进程导航到非本机 Web origin（外链走 openExternal）。
  mainWindow.webContents.on("will-navigate", (event, url) => {
    try {
      const next = new URL(url);
      const allowed = new URL(config.webOrigin);
      if (next.origin !== allowed.origin) {
        event.preventDefault();
        void shell.openExternal(url);
      }
    } catch {
      event.preventDefault();
    }
  });

  const entry = desktopEntryUrl(config);
  await mainWindow.loadURL(entry);
}

async function boot(): Promise<void> {
  registerIpc();
  services = startManagedServices(config);

  // 等 API 健康再开窗；Web 由 loadURL 自己重试/失败可见。
  try {
    await waitForHttpOk(healthUrl(config), { timeoutMs: config.manageServices ? 90_000 : 15_000 });
  } catch (error) {
    console.error("[luup-desktop] API not ready:", error);
    if (!config.manageServices) {
      console.error(
        `[luup-desktop] Start API/Web first, or set LUUP_DESKTOP_MANAGE_SERVICES=1. Expected ${healthUrl(config)}`,
      );
    }
  }

  await createWindow();
}

void app.whenReady().then(() => {
  void boot();
});

app.on("window-all-closed", () => {
  services?.stop();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  services?.stop();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow();
  }
});
