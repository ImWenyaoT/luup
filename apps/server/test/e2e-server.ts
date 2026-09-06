import { setTimeout as sleep } from "node:timers/promises";
import { createDeterministicRuntime, createDeterministicVerifier } from "../src/executor-deterministic.ts";
import { Harness } from "../src/harness.ts";
import { createApp } from "../src/server.ts";
import { SqliteStore } from "../src/store/store.ts";

// 真实 HTTP/Harness/Store，仅角色返回加可取消延迟，给浏览器稳定操作运行中任务的窗口。
const store = new SqliteStore(process.env.LUUP_DATABASE!);
const runtime = createDeterministicRuntime(store);
const harness = new Harness(
  store,
  async (request) => {
    const result = await runtime.execute(request);
    await sleep(800, undefined, { signal: request.signal });
    return result;
  },
  { createLedger: runtime.createLedger, verifyReferences: createDeterministicVerifier() },
);
createApp({ store, harness, runtime: "deterministic", port: Number(process.env.PORT) });
