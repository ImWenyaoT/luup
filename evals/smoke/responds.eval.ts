import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";

/**
 * 冒烟：模型接线活着、master 能听懂"不要启动流水线"。
 * 廉价（一次调用），跑在 full-run 之前当预检。
 */
export default defineEval({
  description: "master 可响应且不误启动流水线",
  tags: ["smoke"],
  timeoutMs: 120_000,
  async test(t) {
    await t.send(
      "这是一次连通性检查：直接回复 LUUP-SMOKE-OK，不要调用任何工具，不要启动流水线。",
    );
    t.succeeded();
    t.check(t.reply, includes("LUUP-SMOKE-OK"));
  },
});
