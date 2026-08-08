/**
 * 禁用内置 web_search。
 *
 * 同 web_fetch：搜索摘要不是 criteria B1 认的证据，却最容易被当成「我查过了」的凭据。
 * 文献检索的唯一入口是 arxiv_search。
 */
import { disableTool } from "eve/tools";

export default disableTool();
