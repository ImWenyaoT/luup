# @luup/desktop

Luup Autoresearch 的 Electron 壳（ADR-0014）。窗口加载 Next Web，本机监督 API（与可选 Web）进程。

## 开发

先装依赖（仓库根）：

```sh
pnpm install
```

一键（壳会拉起 API + Web，默认确定性 runtime）：

```sh
pnpm run dev:desktop
```

若 API/Web 已在跑，可关掉自动拉起：

```sh
LUUP_DESKTOP_MANAGE_SERVICES=0 pnpm run dev:desktop
```

Live 模型：

```sh
LUUP_RUNTIME=live pnpm run dev:desktop
```

默认入口：`http://127.0.0.1:3000/autoresearch`。

## 安全

- `contextIsolation` + 无 `nodeIntegration`
- preload 仅暴露 `window.luupDesktop`（版本 / entry / apiOrigin / openExternal）
- 外链与新窗口走系统浏览器

## 打包

`pnpm --filter @luup/desktop pack:dir` 产出未签名目录包（里程碑：完整安装器与离线资源捆绑另开）。
