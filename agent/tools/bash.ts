/**
 * 禁用内置 bash。
 *
 * bash 跑在 sandbox 里，而本 run 的工件（evidence.md、memory/papers/…）在 app runtime
 * 的宿主文件系统上，两边互相看不见。给模型一把够不着目标的 shell，只会换来一串
 * 试探性命令和据此得出的错误结论。
 */
import { disableTool } from "eve/tools";

export default disableTool();
