import assert from "node:assert/strict";
import { Usage, type Model, type ModelResponse } from "@openai/agents";
import { test } from "vitest";

import { EvidenceLedger } from "../src/agent/evidence.ts";
import { createRoles } from "../src/agent/roles/index.ts";
import { STRUCTURED_OUTPUT_TOOL } from "../src/agent/roles/structured-output.ts";
import { createDeterministicRuntime, createDeterministicVerifier } from "../src/executor-deterministic.ts";
import { createQwenExecutor } from "../src/executor.ts";
import { Harness } from "../src/harness.ts";
import { SqliteStore } from "../src/store/store.ts";

for (const role of ["hypothesis-generation", "evidence-review"] as const) {
  test(`${role} validates tool arguments locally even when the provider cannot enforce text.format`, async () => {
    const store = new SqliteStore(":memory:");
    try {
      const runtime = createDeterministicRuntime(store);
      const runId = store.createRun("问题");
      const outcome = await new Harness(store, runtime.execute, {
        createLedger: runtime.createLedger,
        verifyReferences: createDeterministicVerifier(),
      }).execute(runId);
      assert.equal(outcome.status, "completed");
      const expected = store
        .snapshot(runId)!
        .artifacts.find(
          (item: { type: string; content: unknown }) =>
            item.type === (role === "hypothesis-generation" ? "hypothesis" : "evidence-review"),
        )!.content;
      const roles = createRoles(new EvidenceLedger());
      const agent = roles.agents[role];
      assert.deepEqual(
        agent.tools.map((item) => item.name),
        [STRUCTURED_OUTPUT_TOOL],
      );
      assert.equal(agent.outputType, "text");
      let calls = 0;
      const model: Model = {
        getResponse(request): Promise<ModelResponse> {
          assert.equal(request.outputType, "text", "the provider need not implement text.format JSON Schema");
          calls += 1;
          if (calls === 2) {
            assert.equal(roles.captures[role].captured(), undefined, "invalid arguments must not be captured");
            assert.match(JSON.stringify(request.input), /artifact_type/);
          }
          return Promise.resolve({
            usage: new Usage(),
            output: [
              {
                type: "function_call",
                id: `fc_${calls}`,
                callId: `call_${calls}`,
                name: STRUCTURED_OUTPUT_TOOL,
                arguments: JSON.stringify(calls === 1 ? {} : expected),
              },
            ],
          });
        },
        getStreamedResponse() {
          throw new Error("unused");
        },
      };
      await createQwenExecutor(undefined, { getModel: () => model })({
        runId,
        role,
        agent,
        input: "{}",
        timeoutMs: 1_000,
      });
      assert.equal(calls, 2, "the invalid report must receive a correction within the same Runner call");
      assert.deepEqual(roles.captures[role].captured()!.value, expected);
    } finally {
      store.close();
    }
  });
}
