/**
 * 工具定义在 agent/lib/tools/arxiv_save.ts —— lib/ 是文档给的 import-only 共享通道，
 * root 与子 agent 各自从这里取，而不是反向 import 别人的 tools/ slot。
 */
export { default } from "../../../lib/tools/arxiv_save.ts";
