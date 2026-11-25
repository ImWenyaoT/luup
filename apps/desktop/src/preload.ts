import { contextBridge, ipcRenderer } from "electron";

export type LuupDesktopBridge = {
  getVersion: () => Promise<string>;
  getEntryUrl: () => Promise<string>;
  getApiOrigin: () => Promise<string>;
  openExternal: (url: string) => Promise<boolean>;
};

const bridge: LuupDesktopBridge = {
  getVersion: () => ipcRenderer.invoke("desktop:get-version"),
  getEntryUrl: () => ipcRenderer.invoke("desktop:get-entry-url"),
  getApiOrigin: () => ipcRenderer.invoke("desktop:get-api-origin"),
  openExternal: (url: string) => ipcRenderer.invoke("desktop:open-external", url),
};

contextBridge.exposeInMainWorld("luupDesktop", bridge);
