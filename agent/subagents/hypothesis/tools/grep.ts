/**
 * 禁用内置 grep。
 *
 * 同 glob：搜索面是 sandbox，run 工件不在里面。搜不到不能当作「不存在」——要查证
 * 只能用 message 里的材料和 paper_index_read。
 */
import { disableTool } from "eve/tools";

export default disableTool();
