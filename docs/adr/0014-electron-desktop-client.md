# ADR-0014 · Electron 桌面客户端

## 状态

已接受，2026-11-25。与 ADR-0010（Web/API 双进程）并存；桌面壳不吞掉 API。

## 背景

Autoresearch（ADR-0013）之后，产品不再绑在赛题 Web 演示上。需要一个可装可关的
**本机客户端**：本地起 API、开窗口、管生命周期；同时保留浏览器访问与独立部署能力。

## 决定

1. 新增 `apps/desktop`（`@luup/desktop`）：Electron 主进程 + preload，**不**把 Next 塞进
   Electron 同上下文（不做 `next-electron-rsc` 一类合并）。
2. 继续 ADR-0010 双进程：桌面壳监督 `apps/server`（必选）与 `apps/web`（dev / 本机 prod）；
   渲染层仍是 Next App Router，默认落地 `/autoresearch`。
3. 安全默认：`contextIsolation: true`、`nodeIntegration: false`、preload `contextBridge`；
   外链走 `shell.openExternal`。
4. 本机绑定：API 默认 `127.0.0.1`；桌面不把 SQLite / memory 搬进渲染进程。
5. 打包：先落地 **dev 壳 + 进程监督**；`electron-builder` 产物作为后续里程碑，不在本 ADR
   强制改 monorepo `node-linker`。

## 后果

正：Autoresearch 有「客户端」形态；密钥与 SQLite 仍在本机 API 侧；Web 契约不破。

负：本地至少两进程（壳 + API；dev 时再加 Next）；完整离线安装包需另开打包里程碑。

## 验收

- `pnpm run dev:desktop` 能打开窗口并加载 `/autoresearch`（Web/API 已起或由壳拉起）
- preload 不暴露 Node；外链不在窗口内随意导航
- `apps/desktop` 的 typecheck / 单测在无显示环境下可通过（不跑 GUI）
