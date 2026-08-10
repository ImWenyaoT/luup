/**
 * 禁用内置 write_file。
 *
 * 子 agent 不落盘：交付物就是返回值，由 master 认证后写进 run 目录。write_file 既绕开
 * 这道认证，写入的也是 sandbox 而非 run 目录。
 */
import { disableTool } from "eve/tools";

export default disableTool();
