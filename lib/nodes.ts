/**
 * 节点↔工件注册表。
 *
 * DAG 的每个节点绑一个产出工件，「绑了什么、叫什么、怎么渲染」的唯一事实源就在这里。
 * 五个读者一律派生，谁都不再手抄一份：
 *
 *   lib/phase.ts            工件存在即节点完成（deriveNodes）
 *   components/Spine.tsx    轨道标记、点节点跳哪个 tab
 *   app/runs/[id]/page.tsx  evidence / hypotheses / critique 三个工件面板
 *   components/RunsTable    列表页表头 `L H C W` 与缩略轨道
 *   scripts/run.ts          收尾打印的工件清单
 *
 * 单源的代价是改名要改到这里，收益是 2026-08-08 那次 `critique.md` → `critique.json`
 * 不会再只改一半：当时 pipeline 与 agent 都改了，web 层还在找 critique.md，
 * 新老 run 的批判标签一起灰显，直到有人手工热修。
 *
 * **本模块不许 import node: 内置**：Spine 被 "use client" 的 RunsTable / Monitor 引用，
 * 注册表会跟着进客户端 bundle，而 lib/phase.ts 那套 fs 读盘进不去。
 */
import type { NodeKey } from "./types.ts";

/** 工件面板只有两种形态：markdown 渲染，或 JSON pretty-print。 */
export type ArtifactKind = "markdown" | "json";

export type NodeSpec = {
  key: NodeKey;
  /** 单字母轨道标记：L H C W ✓ */
  mark: string;
  label: string;
  /** 当前工件名（run 目录相对路径） */
  artifact: string;
  /** 详情页标签页 id，同时是 spine 的跳转锚点（`#tab-<id>`）。 */
  tabId: string;
  /** 是否进 scripts/run.ts 收尾打印的工件清单（验收报告由 `pnpm verify` 后补，不在其中）。 */
  inManifest: boolean;
  /** 历史工件名，只用于读老 run；新 run 一律只写 `artifact`。 */
  legacyArtifacts?: string[];
};

export const NODES: NodeSpec[] = [
  {
    key: "literature",
    mark: "L",
    label: "文献",
    artifact: "evidence.md",
    tabId: "evidence",
    inManifest: true,
  },
  {
    key: "hypothesis",
    mark: "H",
    label: "假设",
    artifact: "hypotheses.md",
    tabId: "hypotheses",
    inManifest: true,
  },
  {
    key: "critique",
    mark: "C",
    label: "批判",
    artifact: "critique.json",
    tabId: "critique",
    inManifest: true,
    // 2026-08-08 前是自由格式 markdown，仓库里的老 run 仍是它
    legacyArtifacts: ["critique.md"],
  },
  {
    key: "proposal",
    mark: "W",
    label: "计划",
    artifact: "proposal.json",
    tabId: "proposal",
    inManifest: true,
  },
  {
    key: "verify",
    mark: "✓",
    label: "验收",
    artifact: "verification-report.md",
    tabId: "verification",
    inManifest: false,
  },
];

/** 按 key 取条目。每个 NodeKey 恰好出现一次，所以查表是全的（不会 undefined）。 */
export const NODE_BY_KEY = Object.fromEntries(NODES.map((n) => [n.key, n])) as Record<NodeKey, NodeSpec>;

/**
 * 列表页缩略轨道只画 master 推进的四个节点 —— verify 是跑完之后的确定性验收，
 * 不在 DAG 里（`RunSummary.nodes` 的键就是 `Exclude<NodeKey, "verify">`）。
 */
export const SUMMARY_MARKS = NODES.filter((n) => n.key !== "verify").map((n) => n.mark);

/**
 * 渲染形态由**文件名**决定，不是注册表里的第二个字段：`.json` 走 JSON 面板，其余走
 * markdown。写成字段就得在改工件名时记得同步改它，而那正是这张表要消灭的那类漏改。
 */
const kindOf = (file: string): ArtifactKind => (file.endsWith(".json") ? "json" : "markdown");

/**
 * 在一次 run 的工件集合里定位某节点的产出：先当前名，再历史名。
 * `exists` 由调用方给（web 侧是工件名集合，phase 侧是目录快照），注册表不碰 fs。
 *
 * kind 跟着实际命中的文件走：老 run 的 critique.md 是 markdown，新 run 的 critique.json 是 JSON。
 */
export function resolveArtifact(
  spec: NodeSpec,
  exists: (file: string) => boolean,
): { file: string; kind: ArtifactKind } | null {
  for (const file of [spec.artifact, ...(spec.legacyArtifacts ?? [])]) {
    if (exists(file)) return { file, kind: kindOf(file) };
  }
  return null;
}
