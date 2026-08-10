/**
 * 禁用内置 glob。
 *
 * 本节点不读文件系统：材料在 message 里，文献在 paper_index_read / arxiv_* 后面。
 * glob 匹配的是 sandbox，对它来说 run 目录根本不存在。
 */
import { disableTool } from "eve/tools";

export default disableTool();
