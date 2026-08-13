# ADR-0002 · Bun 的职责边界

## 状态

已接受，2026-08-12。

## 背景

2026-08-12 前端从 pnpm/node 切到 Bun（PR #18）。切完之后的开放问题是：Bun 还能往上吃几层？
一次逐层 spike 给出了实测答案（PR #19 描述里记录），本 ADR 把它固化下来，否则结论只存在于
PR 描述中。

### 前提纠正

「bun 原生（Zig/Rust）vs vite 是 JS」不成立：**Vite 8 本身已是 Rust 原生工具链**
（rolldown + lightningcss）。`bun build` 相对 Vite 的优势只剩「少一层插件协议」，
不是「原生 vs 解释执行」。

## 决定

Bun 的职责边界定在三件事，其余不动。

### own

- 装包（`bun install`，`bun.lock`）
- 跑 `package.json` 脚本
- `bun test`——`bunfig.toml` 的 `[test] root="./src"` 与 Playwright 隔离。
  不隔离时 **5 个 spec 会被 bun 捡起并报错**，这是隔离配置存在的唯一理由。

### 不 own（各有实测依据）

| 层 | 实测结果 |
|---|---|
| 打包器 | e2e 能全绿，但首屏 gzip **+31.7%**——`@tanstack/router-plugin` 无 Bun 适配器（见 ADR-0001），**路由级代码分割丢失**；且丢 lightningcss 浏览器降级 |
| dev server | TanStack Router 循环引用 × Bun HMR 运行时 → 开 HMR 即白屏。`hmr:false` 渲染 34401 字符 / `hmr:true` 归零。**硬阻断** |
| 类型检查 | 注入类型错误后 `tsc --noEmit` exit 2，而 `bun build` **exit 0 照样出产物** |
| lint / format | Bun 无对应能力 |

### `--bun` 运行时不采纳

dev 冷启动 415ms vs node 237ms（**慢 1.75 倍**），且产物不字节一致。

## 后果

正：

- 边界明确，不必每次看到 Bun 新版本就重新讨论一遍。
- 保住路由级代码分割与 lightningcss 降级，首屏体积不退化。
- `tsc --noEmit` 仍是类型门，构建产物不会带着类型错误出厂。

负：

- 工具链不统一：装包/测试是 Bun，构建/检查是 Vite + tsc + biome。这是有意接受的分层，
  不是待收敛的技术债。
- dev server 与生产构建都依赖 Vite 插件生态，迁移成本随时间累积。

### 附带记录：PR #19 的真减法与 Bun 无关

`@vitejs/plugin-react-swc` → `@vitejs/plugin-react`，砍掉 `@swc` **68M 原生二进制**
（node_modules 452M → 385M），产物 **11/11 文件字节一致**。

**这笔减法在 Vite 内部，与 Bun 无关**——记在这里只是防止它被追认为「切 Bun 的收益」。

## 何时重新审视

任一条成立即重开打包器 / dev server 的边界：

- `@tanstack/router-plugin` 提供 Bun bundler 适配器时（届时代码分割不再丢失）；
- Bun HMR 与 TanStack Router 的循环引用问题被任一方修复时。
