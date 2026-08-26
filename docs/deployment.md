# Luup 部署边界与 Cloudflare Runbook

状态：**当前仓库没有已部署的公网实例**。本文件是可执行部署方案与验收清单，不是部署凭证。

## 结论

当前代码的最小可信部署形态是：

```text
浏览器 → Cloudflare DNS/Access/TLS → Cloudflare Tunnel → 127.0.0.1:8000
                                                     ↓
                                             Node.js 22 + Elysia
                                                     ↓
                                  持久磁盘上的 SQLite + memory/ 文件
```

Tunnel 只负责把 HTTP 流量送到已经运行的 Node origin；它不把本项目转换成 Worker，
也不解决应用鉴权、费用控制或 SQLite 备份。当前服务同源托管 React Router SPA 静态产物（`apps/web/dist/client`，`LUUP_WEB_DIST` 可覆盖）和 `/api`，
因此 Tunnel 方案不需要跨域配置，也不会引入第二套前端 API 地址。

## 为什么不是直接部署成 Worker

当前 `apps/server/src/server.ts` 和 `apps/server/src/store/store.ts` 明确使用：

- Node HTTP / Elysia、`node:sqlite` 和进程内后台执行队列；
- `node:fs` / `node:path` 读取前端构建产物（默认 `apps/web/dist/client`）；
- 长生命周期 SQLite 单写者锁、WAL 文件和 `memory/` append-only 文件；
- SSE 长连接与同一进程内的 Run 调度。

这些不是一个 `wrangler.jsonc` 就能替换的 Worker 适配。若未来选择 Workers，必须另做 HTTP
adapter，并把事实存储、队列、长任务、密钥和恢复语义分别迁移到 Cloudflare 对应服务；在此之前
不得把当前服务伪装成可部署 Worker，也不要把 SQLite 文件放到临时文件系统。

Cloudflare Pages 只托管静态前端也不是当前的即插即用路径：前端 API 使用同源相对路径，
当前服务没有可配置的跨域 allowlist；拆分后还需要显式 API origin、精确 CORS、SSE 代理和独立 API
持久化。除非完成这些适配，否则使用 Tunnel 保持同源。

## Origin 准备

在一台有持久磁盘、可重启服务并能访问百炼端点的 Linux/macOS 主机上：

```sh
cd /path/to/luup
node --version                         # 必须 >= 22.0.0
pnpm install --frozen-lockfile
pnpm run ci
pnpm run build
```

创建只存在于 origin 主机的环境变量或 secret manager 注入项。不要把 `.env`、Qwen key、
Cloudflare tunnel credentials 或 API token 提交进仓库：

```sh
export LUUP_RUNTIME=live
export QWEN_API_KEY='...'
export QWEN_BASE_URL='https://dashscope.aliyuncs.com/compatible-mode/v1'
export LUUP_MODEL_ID='qwen3.7-plus'
export LUUP_API_TOKEN='use-a-long-random-value'
export LUUP_DATABASE='/var/lib/luup/typescript-runs.db'
export LUUP_HOSTNAME='127.0.0.1'
export PORT=8000
pnpm run start
```

`LUUP_API_TOKEN` 在 live 公网场景是必填的纵深防线；Cloudflare Access 不能替代应用层 token。
`LUUP_MAX_QUEUED_RUNS` 只限制进程内同时执行/排队数量，不是用户级限流，也不是费用预算：

```sh
export LUUP_MAX_QUEUED_RUNS=2
```

如果 origin 位于容器或独立内网网卡，可将 `LUUP_HOSTNAME` 改为 `0.0.0.0`，但必须先配置
主机防火墙/安全组；Tunnel origin 推荐保持 `127.0.0.1`，避免绕过 Tunnel 直接暴露端口。
`LUUP_DATABASE` 所在目录必须是持久卷，并且进程用户可读写。SQLite 运行时会同时使用主库、
`-wal`、`-shm` 和 writer-lock 数据库；备份必须按 SQLite 一致性方式执行，不能只复制单个主文件。
至少在正式批跑前做一次可恢复备份和恢复演练。

### SQLite 一致性备份与恢复

不要用 `cp typescript-runs.db` 代替备份：运行中的 SQLite 可能把已提交事实留在同名 WAL 中。
仓库提供三个 CLI，均只接受文件路径，不会把缺失参数解析成默认数据库：

```sh
DB=/var/lib/luup/typescript-runs.db
STAMP=$(date +%Y%m%d-%H%M%S)
BACKUP=/var/lib/luup/backups/typescript-runs-$STAMP.db
RESTORE=/var/lib/luup/restore/typescript-runs-$STAMP.db

pnpm run db:verify -- --source "$DB"
pnpm run db:backup -- --source "$DB" --target "$BACKUP"
pnpm run db:verify -- --source "$BACKUP"
pnpm run db:restore -- --source "$BACKUP" --target "$RESTORE"
pnpm run db:verify -- --source "$RESTORE"
```

`db:backup` 和 `db:restore` 使用 SQLite `VACUUM INTO` 生成新的事务一致快照，覆盖 WAL
中已经提交的事实；两者都拒绝已有目标及目标的 `-wal`/`-shm` 旁车文件。`db:verify` 执行
`PRAGMA integrity_check`、`foreign_key_check`，并检查 `runs`、`attempts`、`artifacts`、
`tool_evidence`、`events`、`batch_manifests`、`batch_manifest_records` 及其必需列。
任何检查失败都返回非零退出码并保留明确原因；它不会修复、迁移或创建被检查的数据库。

操作纪律：备份前先确认没有批跑正在写入，目标路径必须是新路径；恢复演练使用独立目录，
确认 `db:verify` 成功后再切换 `LUUP_DATABASE`。备份文件同样属于运行事实，按与 SQLite 主库
相同的访问控制和保留策略管理，不要提交到 Git 或上传到不受控位置。

## Cloudflare Tunnel 配置骨架

下面是部署者在 Cloudflare 控制台/`cloudflared` 主机上填写的骨架；占位符不应原样使用，
本仓库不保存 tunnel ID 或 credentials：

```yaml
# /etc/cloudflared/config.yml（部署主机，不进 Git）
tunnel: <TUNNEL_ID>
credentials-file: /etc/cloudflared/<TUNNEL_ID>.json

ingress:
  - hostname: luup.example.com
    service: http://127.0.0.1:8000
  - service: http_status:404
```

在把 DNS/Access 路由切到生产前，先在 origin 主机验证：

```sh
curl -fsS http://127.0.0.1:8000/health
curl -fsS http://127.0.0.1:8000/readyz
curl -fsS https://luup.example.com/health
```

`/health` 只代表进程存活；`/readyz` 才检查 SQLite 可读、live 模型凭据存在、应用 token 已配置。
缺少任一项时 `/readyz` 返回 `503`，不能把它配置成负载均衡的可接收流量节点。

## API / SSE 验收

带 token 做一次零模型请求边界检查（不会创建 Run）：

```sh
BASE=https://luup.example.com
curl -fsS "$BASE/health"
curl -fsS "$BASE/readyz"
curl -i "$BASE/api/runs" \
  -H 'content-type: application/json' \
  -d '{"question":"部署前的费用闸检查"}'
```

最后一个请求在缺 token 时必须是 `401`，在队列已满时必须是 `429`；不应通过浏览器的
`text/plain` simple request 绕过 JSON 边界。准备付费 canary 后再显式携带：

```sh
curl -fsS -X POST "$BASE/api/runs" \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer <LUUP_API_TOKEN>' \
  -d '{"question":"只用于部署后的单题 canary"}'
```

SSE 验收必须确认响应包含 `text/event-stream`、`cache-control: no-cache, no-transform`，
并在 Run 终态收到 `run.completed` / `run.review_rejected` / `run.failed`。断线重连使用
`Last-Event-ID` 或 `after` 游标；坏游标、坏回放和投影异常必须可见地返回错误，而不是无解释 EOF。

## 安全与运维闸门

- Cloudflare Access/WAF/Rate Limiting 负责公网入口的身份、粗粒度限流和攻击面收敛；应用仍要求
  `LUUP_API_TOKEN`。只允许必要的 hostname 和方法，后台 `/api/config` 不对不可信用户开放。
- Qwen key 仅作为 secret 注入；`GET /api/config` 只返回 credential 三态。不要在日志、截图、
  curl history、SQLite payload 或提交材料中出现 key/token。
- 外部调用可能产生费用。生产默认先 `LUUP_MAX_QUEUED_RUNS=1`，完成单题 live canary、
  检查 token/题目成本后再按预算放大；正式 Science-125 批跑仍需单独的人工开跑确认。
- 监控同时采集 `/health`、`/readyz`、进程退出、SQLite 磁盘空间、WAL 增长、Cloudflare Tunnel
  连接状态和应用错误日志。健康探针通过不等于业务成功。
- 只允许一个 Luup writer 进程使用同一个 SQLite 路径；不要在多个容器副本之间共享同一 SQLite
  文件。需要水平扩展时必须先完成数据库/队列适配。
- `memory/` 与 `data/science125.json` 要随版本固定。变更代码、题库或协议时记录 source identity，
  不要用“最新部署”覆盖历史批次事实。

## 当前未完成项（部署 blocker）

本仓库当前没有执行以下外部动作，也没有可宣称的公网地址：

1. Cloudflare account/zone/tunnel/DNS/Access 配置；
2. origin 主机、持久卷、备份恢复、进程监管和日志收集；
3. 真实生产 secret 注入与 token 轮换；
4. Pages 分离前端所需的 API origin/CORS/SSE 适配；
5. Worker/D1/Queues/Workflow 迁移（若不采用 Tunnel）；
6. 公开 API 的真实端到端 canary 与评审访问验收。

因此交付材料中可以准确写“支持在持久化 Node origin 前接 Cloudflare Tunnel 的部署方法”，
但不能写“已部署 Cloudflare”或提供虚构的测试 API 地址。
