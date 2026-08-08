/**
 * 禁用内置 web_fetch。
 *
 * criteria B1 只认 arXiv API 的实检结果作为文献证据：抓回来的网页进不了 paper index，
 * 也就过不了 verify_references 的逐条反查。留着它只会诱导模型拿网页充当引用来源。
 */
import { disableTool } from "eve/tools";

export default disableTool();
