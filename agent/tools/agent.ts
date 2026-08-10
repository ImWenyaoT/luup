/**
 * 禁用内置 agent。
 *
 * 它是 root 自身的副本：留着，模型就能绕开 scientist → reviewer 的唯一流程自行递归派工。
 * 派工只走两个 declared subagent。
 */
import { disableTool } from "eve/tools";

export default disableTool();
