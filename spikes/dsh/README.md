# dsh-app

deepseek-harness 参考学习件（定位见 `docs/adr/0005-luup-charter.md`）：2026-08-15 spike 的
go/no-go 数据与可运行读法。验证过的三点：百炼 route、session 日志落盘、合成工具结构化输出。

独立 workspace、独立 lockfile（钉 `@deepseek-ai/dsh@0.1.0-rc.6`；rc.5 未公开发布）。
不在根 workspace 内——根 install 与 CI 不装这里的依赖树（449 包 / 约 289MB）。

```sh
cd dsh-app
pnpm install --frozen-lockfile
./scripts/smoke.sh        # 三步冒烟，真实百炼调用；凭据从仓根 .env 读入
```

对 luup 有直接效力的两条实测约束（与是否使用 dsh 无关）：
`outputSchema` 仅 in-process provider 支持；dsh 的 JSON Schema 受限子集无
`pattern`/`format`/数值边界，B1–B4 格式校验必须留宿主侧。
