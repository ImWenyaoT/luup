/**
 * 禁用内置 write_file。
 *
 * 工件落盘必须过 artifact_write 的路径 jail、memory/ 保护区与契约校验；write_file 三样
 * 全绕开，而且写进的是 sandbox，根本落不进本 run 的目录。
 */
import { disableTool } from "eve/tools";

export default disableTool();
