/**
 * agent 装配自测（零 API，零网络）—— `pnpm validate` 的后半（原 `npx eve info` 的替代）。
 *
 *   node scripts/selftest-agents.ts
 *
 * 守三件事：
 *  1. 五个 agent（master + 4 节点）能在无 .env 环境下构造（client 懒构造，不发请求）。
 *  2. master 的工具面与顺序：顺序是 KV cache 可复用前缀的一部分（architecture.md
 *     「KV cache 经营」②），这里把它钉成断言 —— 改动顺序必须先改这行期望值。
 *  3. 每个节点的 instructions / 工具集 / 轮数熔断与声明一致（instructions.md 是
 *     always-on system prompt，装载失败在这里暴露，而不是 20 分钟 run 的中途）。
 */
import { MASTER_MAX_TURNS, MASTER_TIMEOUT_MS, SUBAGENT_NODES, buildMasterAgent } from "#agent.ts";
import { check, eq, report } from "./selftestHarness.ts";

console.log("[1] master 装配");
const master = buildMasterAgent();
eq("master 名称", master.name, "master");
check(
  "master instructions 已装载（含循环控制关键词）",
  typeof master.instructions === "string" && master.instructions.includes("循环控制"),
);
eq(
  "master 工具面与顺序（顺序即 KV 前缀，改动先改这里）",
  master.tools.map((t) => t.name).join(","),
  [
    "literature",
    "hypothesis",
    "critique",
    "proposal",
    "artifact_write",
    "artifact_read",
    "verify_references",
    "arxiv_search",
    "arxiv_save",
    "paper_index_read",
    "memory_search",
    "memory_note",
  ].join(","),
);
check("master 轮数上限在位", Number.isInteger(MASTER_MAX_TURNS) && MASTER_MAX_TURNS >= 50);
check("master 会话时限在位（2h）", MASTER_TIMEOUT_MS === 2 * 60 * 60 * 1000);

console.log("\n[2] 四个 DAG 节点");
const EXPECTED_TOOLS: Record<string, string[]> = {
  literature: ["arxiv_search", "arxiv_save", "memory_search", "paper_index_read"],
  hypothesis: ["paper_index_read"],
  critique: ["arxiv_search", "paper_index_read"],
  proposal: ["paper_index_read"],
};
eq(
  "节点清单即 DAG 顺序",
  SUBAGENT_NODES.map((n) => n.name).join(","),
  "literature,hypothesis,critique,proposal",
);
for (const node of SUBAGENT_NODES) {
  const agent = node.build();
  eq(`${node.name} agent 名称`, agent.name, node.name);
  check(
    `${node.name} instructions 已装载（>200 字）`,
    typeof agent.instructions === "string" && agent.instructions.length > 200,
  );
  eq(
    `${node.name} 工具集`,
    agent.tools.map((t) => t.name).join(","),
    EXPECTED_TOOLS[node.name]?.join(",") ?? "(未声明期望)",
  );
  check(
    `${node.name} 轮数熔断在合理区间（10–30）`,
    node.maxTurns >= 10 && node.maxTurns <= 30,
    `maxTurns=${node.maxTurns}`,
  );
}
check(
  "contract 节点恰为 critique 与 proposal",
  SUBAGENT_NODES.filter((n) => n.contract !== undefined)
    .map((n) => n.name)
    .join(",") === "critique,proposal",
);

report("selftest-agents");
