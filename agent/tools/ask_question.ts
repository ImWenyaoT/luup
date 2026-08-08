/**
 * 禁用内置 ask_question。
 *
 * 流水线 headless 跑（eve invoke，无人值守），ask_question 会把会话挂在等人回答上直到
 * 超时——一次 20 分钟的 run 就这么白烧。信息不足时的正确动作是按判据 reject 打回，
 * 或如实写 FAILED.md，不是问人。
 */
import { disableTool } from "eve/tools";

export default disableTool();
