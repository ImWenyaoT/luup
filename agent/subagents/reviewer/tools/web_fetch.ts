/**
 * 禁用内置 web_fetch。
 *
 * criteria B1 只认 arXiv API 的实检结果：网页抓取的内容进不了 paper index，下游
 * verify_references 反查不到，写进产物就是一条必然失败的引用。
 */
import { disableTool } from "eve/tools";

export default disableTool();
