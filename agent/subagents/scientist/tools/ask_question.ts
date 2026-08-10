/**
 * 禁用内置 ask_question。
 *
 * 无人值守的 task mode：没有人在另一头，问出去就是挂到超时。输入不足时把缺什么写进
 * 返回值，让 master 决定是补料重派还是判 FAILED。
 */
import { disableTool } from "eve/tools";

export default disableTool();
