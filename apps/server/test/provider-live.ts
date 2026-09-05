/** 显式、有限额的在线兼容性诊断；不被 Vitest/CI 自动发现，不运行科研题目或外部检索。 */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { Agent, Runner, tool, type ModelSettings } from "@openai/agents";
import { z } from "zod";

import { createStructuredOutput, STRUCTURED_OUTPUT_INSTRUCTION } from "../src/agent/roles/structured-output.ts";
import { modelConfigStatus, modelForRole, qwenModelProvider, sharedModelSettings } from "../src/seams/model.ts";

const names = ["native-schema", "tool-roundtrip", "structured-tool", "incomplete"] as const;
type ProbeName = (typeof names)[number];
type Exchange = {
  http: number;
  status: unknown;
  outputTypes: unknown[];
  outputText: string;
  usage: unknown;
  request: { model: unknown; reasoning: unknown; maxOutputTokens: unknown; format: unknown; store: unknown };
};
type Probe = { name: ProbeName; required: boolean; passed: boolean; exchanges: Exchange[]; error?: string };

if (!process.argv.includes("--live")) {
  process.stdout.write("No API calls made. Use pnpm run test:provider:live --live [--case=<name>].\n");
  process.stdout.write(
    `Cases: ${names.join(", ")}; maximum 6 HTTP requests, 128 output tokens/request (16 for truncation).\n`,
  );
} else {
  const selected = process.argv.find((arg) => arg.startsWith("--case="))?.slice("--case=".length);
  if (selected && !names.some((name) => name === selected)) throw new Error("Unknown provider probe case");
  const config = modelConfigStatus();
  const origin = new URL(config.base_url).origin;
  const originalFetch = globalThis.fetch;
  const probes: Probe[] = [];
  let current: Probe;
  let requests = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== origin || !url.pathname.endsWith("/responses")) throw new Error("Unexpected probe destination");
    if (++requests > 6) throw new Error("Provider probe request cap reached");
    if (typeof init?.body !== "string") throw new Error("Expected SDK JSON request body");
    const request = JSON.parse(init.body) as Record<string, unknown>;
    const response = await originalFetch(input, init);
    const body = (await response.clone().json()) as Record<string, unknown>;
    const output = Array.isArray(body.output) ? (body.output as Array<Record<string, unknown>>) : [];
    current.exchanges.push({
      http: response.status,
      status: body.status,
      outputTypes: output.map((item) => item.type),
      // 只保留合成探针的最终文本；不保存 headers、凭据或 reasoning 内容。
      outputText: output
        .filter((item) => item.type === "message")
        .flatMap((item) => (Array.isArray(item.content) ? (item.content as Array<Record<string, unknown>>) : []))
        .filter((item) => item.type === "output_text")
        .map((item) => String(item.text))
        .join("")
        .slice(0, 200),
      usage: body.usage,
      request: {
        model: request.model,
        reasoning: request.reasoning,
        maxOutputTokens: request.max_output_tokens,
        format: request.text,
        store: request.store,
      },
    });
    return response;
  };
  try {
    const runner = new Runner({
      modelProvider: qwenModelProvider(),
      tracingDisabled: true,
      // 模型 seam 已关闭底层客户端重试；探针同时关闭 Runner 重试。
      modelSettings: { retry: { maxRetries: 0 } },
    });
    const settings: ModelSettings = { ...sharedModelSettings, maxTokens: 128, store: false };
    const runOptions = () => ({ maxTurns: 2, signal: AbortSignal.timeout(45_000) });
    for (const name of names.filter((name) => !selected || name === selected)) {
      current = { name, required: name !== "native-schema", passed: false, exchanges: [] };
      probes.push(current);
      try {
        if (name === "native-schema") {
          const result = await runner.run(
            new Agent({
              name: "SchemaProbe",
              model: modelForRole(),
              modelSettings: settings,
              outputType: z.object({ marker: z.literal("schema-wins") }),
            }),
            "Return exactly the plain text PLAIN_TEXT. Do not return JSON.",
            { ...runOptions(), maxTurns: 1 },
          );
          assert.deepEqual(result.finalOutput, { marker: "schema-wins" });
        } else if (name === "tool-roundtrip") {
          let called = 0;
          const result = await runner.run(
            new Agent({
              name: "ToolProbe",
              model: modelForRole(),
              modelSettings: { ...settings, parallelToolCalls: false },
              instructions: "Call echo_probe exactly once with value hello, then return its result verbatim.",
              tools: [
                tool({
                  name: "echo_probe",
                  description: "Return a diagnostic marker.",
                  parameters: z.object({ value: z.literal("hello") }),
                  execute: () => {
                    called += 1;
                    return "LOCAL_TOOL_RESULT_761";
                  },
                }),
              ],
            }),
            "Run the diagnostic.",
            runOptions(),
          );
          assert.equal(called, 1);
          assert.equal(result.finalOutput, "LOCAL_TOOL_RESULT_761");
        } else if (name === "structured-tool") {
          const capture = createStructuredOutput(z.object({ marker: z.literal("schema-wins") }));
          capture.beginRound();
          await runner.run(
            new Agent({
              name: "SubmissionProbe",
              model: modelForRole(),
              modelSettings: settings,
              instructions: STRUCTURED_OUTPUT_INSTRUCTION,
              tools: [capture.tool],
              toolUseBehavior: capture.toolUseBehavior,
            }),
            "Submit the diagnostic marker schema-wins.",
            { ...runOptions(), maxTurns: 1 },
          );
          assert.deepEqual(capture.captured()?.value, { marker: "schema-wins" });
        } else {
          await assert.rejects(
            runner.run(
              new Agent({
                name: "TruncationProbe",
                model: modelForRole(),
                modelSettings: { ...settings, maxTokens: 16 },
              }),
              "Write all integers from 1 through 200, separated by commas, without stopping.",
              { ...runOptions(), maxTurns: 1 },
            ),
            (error: unknown) => (error as { code?: unknown })?.code === "invalid_output",
          );
          assert.equal(current.exchanges[0]?.status, "incomplete");
        }
        current.passed = true;
      } catch (error) {
        current.error = error instanceof Error ? error.name : "UnknownError";
        // 只有已返回完成文本却不合 schema 才是信息性结果；服务故障不能冒充不支持。
        if (name === "native-schema" && current.error !== "ModelBehaviorError") current.required = true;
      }
      process.stdout.write(`${name}: ${current.passed ? "PASS" : current.required ? "FAIL" : "NOT VERIFIED"}\n`);
    }
  } finally {
    globalThis.fetch = originalFetch;
    mkdirSync("outputs/diagnostics", { recursive: true });
    writeFileSync(
      "outputs/diagnostics/qwen-responses-compatibility.json",
      JSON.stringify(
        { timestamp: new Date().toISOString(), model: config.model_id, requests: Math.min(requests, 6), probes },
        null,
        2,
      ),
    );
  }
  if (probes.some((probe) => probe.required && !probe.passed)) process.exitCode = 1;
}
