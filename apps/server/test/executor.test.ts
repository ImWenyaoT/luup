/** 传输层退避重试的判据。零网络、零 LLM：模型换成按脚本抛状态码的替身。
 *
 * 这里守的是一条边界，不只是一段重试逻辑：重试的是**同一次模型调用**（提示词一字未改），
 * 不是一个新的 Attempt。预注册协议 `controls.no_retry` 注册的「无隐式 Attempt 重试」
 * 因此原样有效——契约不合格仍然一次都不重发，那条路在 `roles.ts` 的 corrections 上。
 */

import assert from "node:assert/strict";
import { Agent, Usage, type Model, type ModelProvider, type ModelResponse } from "@openai/agents";
import { test } from "vitest";

import { StageError } from "../src/agent/failures.ts";
import { createQwenExecutor, TRANSIENT_RETRY } from "../src/executor.ts";

/** provider 抛出来的形状：`status` + 响应头，与 `openai` 客户端的 APIError 同形。
 *
 * SDK 的 `getStatusCode` / `extractHeaders`（`runner/modelRetry.mjs`）读的就是这两个字段。
 * `retry-after-ms: 0` 让退避在用例里不占墙钟：SDK 的判据是「provider 说等多久就等多久，
 * 没说才走本地阶梯」，所以这不绕开任何判据，只把等待时长交给 provider。
 * 2s / 8s 的阶梯本身由下面 `TRANSIENT_RETRY` 那条用例逐字钉住。
 */
class ProviderError extends Error {
  readonly status: number;
  readonly responseHeaders: Record<string, string>;

  constructor(status: number) {
    super(`provider said ${status}`);
    this.name = "APIError";
    this.status = status;
    this.responseHeaders = { "retry-after-ms": "0" };
  }
}

/** 按脚本作答的模型：数字抛那个状态码，`"ok"` 交卷。脚本用尽后重复最后一步。 */
function scripted(script: readonly (number | "ok")[]): { provider: ModelProvider; calls: () => number } {
  let calls = 0;
  const model: Model = {
    getResponse(): Promise<ModelResponse> {
      const step = script[Math.min(calls, script.length - 1)]!;
      calls += 1;
      if (step !== "ok") return Promise.reject(new ProviderError(step));
      return Promise.resolve({
        usage: new Usage(),
        output: [{
          id: "msg_1",
          type: "message",
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text: "交卷" }],
        }],
      });
    },
    getStreamedResponse() {
      throw new Error("harness 不走流式");
    },
  };
  return { provider: { getModel: () => model }, calls: () => calls };
}

function stage(provider: ModelProvider) {
  return createQwenExecutor(undefined, provider)({
    runId: "run",
    role: "reviewer",
    agent: new Agent({ name: "probe", instructions: "只用来触发一次模型调用", model: "fake" }),
    input: "{}",
    timeoutMs: 30_000,
  });
}

test("a rate-limited call is retried and the third attempt's answer is the answer", async () => {
  const { provider, calls } = scripted([429, 429, "ok"]);

  assert.equal(await stage(provider), "交卷");
  assert.equal(calls(), 3, "首发 + 2 次重试");
});

test("a provider that stays broken lands provider_error after the retry budget", async () => {
  const { provider, calls } = scripted([503]);

  await assert.rejects(stage(provider), (error: unknown) => {
    assert.ok(error instanceof StageError);
    assert.equal(error.code, "provider_error");
    return true;
  });
  assert.equal(calls(), 3, "重试有界：2 次之后不再发，剩下的墙钟不烧在一个死掉的端点上");
});

test("a 4xx is a semantic error and is never retried", async () => {
  const { provider, calls } = scripted([400]);

  await assert.rejects(stage(provider), (error: unknown) => {
    assert.ok(error instanceof StageError);
    assert.equal(error.code, "provider_error");
    return true;
  });
  assert.equal(calls(), 1, "重发一次不会让一个非法请求变合法");
});

test("a dropped connection counts as transient even without a status code", async () => {
  let calls = 0;
  const model: Model = {
    getResponse(): Promise<ModelResponse> {
      calls += 1;
      if (calls < 2) return Promise.reject(Object.assign(new Error("fetch failed"), { code: "ECONNRESET" }));
      return Promise.resolve({
        usage: new Usage(),
        output: [{
          id: "msg_1",
          type: "message",
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text: "交卷" }],
        }],
      });
    },
    getStreamedResponse() {
      throw new Error("harness 不走流式");
    },
  };

  // 网络断连没有 status，也没有响应头，靠 SDK 的 `networkError()` 判据认出来。
  // 没有 `Retry-After` 可读，这一条只能走本地阶梯的第一级，因此真的要等 2s——
  // 用例只重试一次，拿这点墙钟换「断连确实在覆盖面内」被守住。
  assert.equal(await stage({ getModel: () => model }), "交卷");
  assert.equal(calls, 2);
}, 10_000);

test("the backoff ladder is the one the protocol amendment registered", () => {
  // 协议修订 #3 写死了这几个数：2 次、2s/8s、带抖动。改动它们必须同时改修订，
  // 否则协议描述的就不是实际跑的系统。
  assert.deepEqual(TRANSIENT_RETRY.retry?.maxRetries, 2);
  assert.deepEqual(TRANSIENT_RETRY.retry?.backoff, {
    initialDelayMs: 2_000,
    multiplier: 4,
    maxDelayMs: 8_000,
    jitter: true,
  });
});
