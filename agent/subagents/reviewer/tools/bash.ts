/**
 * 禁用内置 bash。
 *
 * 本节点只做判断不做执行，没有需要 shell 的作业面；而 bash 所在的 sandbox 与 run 目录
 * 所在的宿主 FS 是两个世界，留着只会变成试探性乱跑。
 */
import { disableTool } from "eve/tools";

export default disableTool();
