/**
 * 禁用内置 grep。
 *
 * 与 glob 同因：搜索面是 sandbox，run 工件在宿主 FS 上。搜不到不等于不存在，模型却会
 * 据此下结论。要看内容就用 artifact_read 全文读。
 */
import { disableTool } from "eve/tools";

export default disableTool();
