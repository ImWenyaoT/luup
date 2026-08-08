/**
 * 禁用内置 read_file。
 *
 * 它读 sandbox 的文件系统，而 run 目录在 app runtime 的宿主 FS 上。实测复现过：模型拿它
 * 找 memory/papers/<id>.md，找不到就无限猜路径（$HOME/workspace/、$HOME/.eve/skills/…）。
 * 读工件的唯一通道是 artifact_read。
 */
import { disableTool } from "eve/tools";

export default disableTool();
