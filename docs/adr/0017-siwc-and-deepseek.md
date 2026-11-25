# ADR-0017 · Sign in with ChatGPT（SIWC）与 DeepSeek 双路径

## 状态

已接受，2026-11-25。叠在 ADR-0013（多 Provider）与 ADR-0014（本机桌面）之上。

## 背景

产品用户是 ChatGPT 计划订阅者（chatgpt-200）。OpenAI 对开源 / 本机宿主开放
**Sign in with ChatGPT**（SIWC）：用 ChatGPT 套餐额度调用
`https://api.openai.com/v1/responses`，不必另备平台 API key。

同时 DeepSeek 仍要可用：已有 `deepseek` ProviderId 与 `DEEPSEEK_*` seam，不能被 SIWC 挤掉。

`@siwc/local` 在 npm 上 404；协议自行实现，不加依赖。

## 决定

1. **SIWC 不是新 ProviderId。** 它是 `openai` provider 的**凭据通道**（ChatGPT plan usage），
   与 `OPENAI_API_KEY` / 设置面 override 并列。`ProviderId` 仍为
   `openai | deepseek | openai-compatible`。
2. **DeepSeek 继续走 `deepseek`。** `DEEPSEEK_API_KEY` / 设置面 override；与 SIWC 互不吞掉。
3. **凭据优先级（openai）**：`override` > `siwc` > `environment` > `absent`。
   `providerConfigStatus().credential` 增加字面量 `"siwc"`；状态面永不返回 token。
4. **换 provider / 凭据只动 `apps/server/src/seams/`。** 实现落在 `seams/siwc.ts`；
   `seams/providers.ts` 读取 SIWC access token；编排与 Engine 不感知登录细节。
5. **本机 loopback。** Electron / 本地 API 进程在 `127.0.0.1:<port>/auth/callback`
   收 OAuth 回调（禁止 `localhost`）。协议常量：
   - Authorize / Token：`auth.openai.com` 官方账户端点
   - PKCE S256；`resource=https://api.openai.com/v1`
   - `scope=openid profile email offline_access resource.invoke chatgpt.tokens.use.direct`
   - 首次 `client_id=dynamic_agent_client` + `agent_name_hint=Luup`；回调 `oaiapp_…` 持久化复用
   - `ext_agent_host_id`：稳定 opaque（`urn:uuid:…`），每主机一个
6. **会话落盘。** 密钥在 `outputs/runtime/siwc-session.json`（`outputs/` 已 gitignore）。
   access ~1h；refresh 30 天旋转；refresh **串行**。`logoutSiwc` 清会话文件。
7. **推理。** SIWC 路径：`POST /v1/responses`，Bearer = access token；请求体强制
   `store:false`（协议要求）。AI SDK 仍经 `@ai-sdk/openai` 的 Responses 表面构造模型。

## 后果

正：ChatGPT 计划用户可无平台 key 跑 openai；DeepSeek / API key / override 路径保留；
seam 边界不变。

负：本机 loopback 依赖桌面或本地 API；远程纯托管部署不能完成 SIWC 回调（仍可用
`OPENAI_API_KEY` / DeepSeek）。SIWC Responses 能力子集窄于平台 key（部分采样参数不可用）。

## 验收

- `siwcStatus` 永不返回 token；登录后 `credential === "siwc"` 且 `createLanguageModel` 可用
- DeepSeek：仅 `DEEPSEEK_API_KEY` 时 `provider === "deepseek"`、`credential === "environment"`
- 过期 access 经串行 refresh 续期；并发 refresh 不双发
- 进行中的 login 可被取消或拒绝，不留下双 listener
- `pnpm run ci` 相关门绿；无新 npm 依赖
