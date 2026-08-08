import type { NextConfig } from "next";
import { withEve } from "eve/next";

const nextConfig: NextConfig = {};

/**
 * withEve() 默认在 Next 项目根下找 agent/——本仓库正是这个布局，无需 eveRoot。
 * 它把 eve 的 /eve/v1/* 挂到同源：dev 时 next dev 顺带起 eve dev 并 rewrite 过去，
 * 生产时代理到 eve build 出的 .output/server/index.mjs（默认端口 4274）。
 */
export default withEve(nextConfig);
