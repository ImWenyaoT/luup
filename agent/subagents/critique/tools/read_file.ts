/**
 * 禁用内置 read_file。
 *
 * 它读 sandbox，而 run 工件在 app runtime 的宿主 FS 上，本节点也无权碰。需要的材料
 * master 已经全部打进 message 了——去读文件只会找不到，然后无限猜路径。
 */
import { disableTool } from "eve/tools";

export default disableTool();
