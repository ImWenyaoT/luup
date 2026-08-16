# ADR-0006 · 正常 TS 全栈 monorepo：根零源码

## 状态

已接受，2026-08-16。用户裁决。

## 背景

ADR-0004 切栈后树顶是混合形制：根目录既是 workspace root 又是后端包本体
（`src/` + `test/` + 运行时依赖都挂在根 `package.json`），同时 `apps/web` 又按
monorepo 惯例住在 `apps/*` 里。三个「app 形状」的名字并存——`src/`（根包后端）、
`apps/web`（workspace 成员）、`dsh-app/`（根本不是 app，是 ADR-0005 的参考学习件）——
用户裁决：**「正常的 ts 全栈就好了，不要混合的」**；dsh 是学它的形制，不是搬它的东西。

形制参考 `../oss/deepseek-harness`：根零源码、只做 workspace 编排，可运行产物全在
`apps/*`。按 ADR-0004 的既有原则**搬形制不搬体量**——luup 约 3K 行源码，两个 app
成员就够，不设 packages 层。

## 决定

1. **后端下沉为 workspace 成员**：`src/`、`test/`、`tsconfig.json`、`vitest.config.ts`
   → `apps/server/`（`@luup/server`），运行时依赖（`@openai/agents`、`zod`、
   `fast-xml-parser`）与测试工具链随包走。
2. **根收敛为纯编排**：根 `package.json` 只剩 workspace 脚本与仓级工具
   （oxlint / knip / lefthook）。运行入口一律从根起跑（`pnpm run dev:api` / `batch` /
   `canary`），cwd 相对路径（`data/`、`memory/`、`outputs/`）因此不变。
3. **`dsh-app/` → `spikes/dsh/`**：ADR-0005 的定位（学习件、独立 workspace、不进根
   workspace）原样，改的只是名字——`-app` 后缀停在根目录读起来像交付面之一，
   `spikes/` 一眼可读出非交付物。ADR-0005 文中的 `dsh-app/` 路径自此为历史坐标。
4. **顺带治了一个伪装依赖**：`apps/web` 的 `typescript` 曾是 `npm:@typescript/typescript6`
   别名（bin 叫 `tsc6`），实际一直蹭根目录的真 `tsc` 在跑；根下沉后蹭不到了，
   换成真 `typescript@^6.0.3`。

## 验证

行为先行（全部实测后才改文档）：typecheck（双包）/ oxlint / 186 用例 + 覆盖率地板 /
build / 确定性 e2e 全绿；canary 真调用在新布局下走通全部路径敏感环节（检索、证据台账、
入库、B1–B4 反查）。路径修点仅四处：`science125.ts` 与 `experiment-protocol.test.ts`
的 `import.meta.url` 相对深度、playwright webServer 命令、lefthook 的 `root: apps/server/`。

## 后果

- 树顶语义单一：`apps/*` = 可运行产物，`spikes/*` = 学习件，`data/ docs/ memory/` = 事实与材料。
- 协议与 ADR 等已注册/已定案文本里的 `src/…` 路径成为历史坐标，不回溯改写；
  活文档（AGENTS / README / architecture / criteria / SCHEMA / CONTEXT）已随本条改写。
- 根 `node_modules` 不再含 vitest/typescript；钩子与脚本经 workspace 解析。
