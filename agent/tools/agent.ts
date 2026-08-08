/**
 * 禁用内置 agent。
 *
 * 它是 root 自身的副本：留着，模型就能绕开 literature → hypothesis → critique →
 * proposal 这条固定 DAG 自行递归派工，逐节点认证的链条当场断掉。派工只走这四个
 * declared subagent。
 */
import { disableTool } from "eve/tools";

export default disableTool();
