/**
 * 禁用内置 glob。
 *
 * 它在 sandbox 里匹配，而要找的 run 工件在宿主 FS 上：结果恒为空集，只会诱导模型换着
 * pattern 继续猜。工件清单由 artifact_read 直接给出（路径缺失时还会回列已有条目）。
 */
import { disableTool } from "eve/tools";

export default disableTool();
