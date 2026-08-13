import { describe, expect, it } from "bun:test"
import { tabForNode } from "@/format"
import type { SpineNode } from "@/types"
import { artifactForTab } from "./RunTabs"

/**
 * 期望值的语义来源：
 * - 候选文件名与优先级：`backend/app/agent/artifacts.py` 实际落盘的文件，
 *   以及 `backend/app/services/runs.py` 的节点表（主名在前、兼容名在后）。
 * - 「.md 是给人读的散文、.json 是契约」这条分工写在 RunTabs 的 ArtifactText 注释里，
 *   所以同一 tab 两个候选都在时，阅读面选 .md。
 */

/** 一次完整的 Pro run 会落盘的全部工件（取自 runs/20260810-092300/）。 */
const PRO_RUN = new Set([
  "evidence.md",
  "proposal.json",
  "proposal.md",
  "review.json",
  "verification.json",
  "verification-report.md",
])

const node = (key: string): SpineNode => ({
  key,
  mark: "?",
  label: key,
  artifact: "—",
  state: "done",
  at: null,
  elapsedSec: null,
})

describe("artifactForTab 优先级", () => {
  it("verification 两个候选都在时选 verification-report.md", () => {
    // 后端 Verify 节点同样以 verification-report.md 为主名。
    expect(artifactForTab("verification", PRO_RUN)).toBe(
      "verification-report.md",
    )
  })

  it("verification 只有 json 时回落到 verification.json", () => {
    expect(artifactForTab("verification", new Set(["verification.json"]))).toBe(
      "verification.json",
    )
  })

  it("proposal 两个候选都在时选 proposal.md（阅读面要散文不要契约）", () => {
    expect(artifactForTab("proposal", PRO_RUN)).toBe("proposal.md")
  })

  it("proposal 只有契约文件时回落到 proposal.json", () => {
    expect(artifactForTab("proposal", new Set(["proposal.json"]))).toBe(
      "proposal.json",
    )
  })

  it("单候选 tab 命中即返回该文件", () => {
    expect(artifactForTab("evidence", PRO_RUN)).toBe("evidence.md")
    expect(artifactForTab("review", PRO_RUN)).toBe("review.json")
  })
})

describe("artifactForTab 缺失路径", () => {
  it("候选一个都不存在时返回 undefined，调用方据此把 tab 置灰", () => {
    expect(artifactForTab("evidence", new Set(["proposal.md"]))).toBeUndefined()
    expect(artifactForTab("review", new Set(["proposal.md"]))).toBeUndefined()
  })

  it("没有候选表的 tab 返回 undefined 而不是抛错", () => {
    // failed / papers 由 TabContent 特判，不走工件表；退役的 hypotheses / critique
    // 连候选表都没有了。
    expect(artifactForTab("papers", PRO_RUN)).toBeUndefined()
    expect(
      artifactForTab("hypotheses", new Set(["hypotheses.md"])),
    ).toBeUndefined()
    expect(artifactForTab("critique", new Set(["critique.md"]))).toBeUndefined()
    expect(artifactForTab("", PRO_RUN)).toBeUndefined()
  })

  it("同名前缀不算命中（只认全等文件名）", () => {
    expect(
      artifactForTab("proposal", new Set(["proposal.json.rejected.json"])),
    ).toBeUndefined()
  })
})

describe("spine 点击 → tab → 工件 的跨模块闭环", () => {
  it("完整 run 里每个节点点下去都能落到有内容的 tab", () => {
    for (const key of ["scientist", "reviewer", "verify"]) {
      const tab = tabForNode(node(key))
      expect(tab).toBeDefined()
      expect(artifactForTab(tab as string, PRO_RUN)).toBeDefined()
    }
  })

  /**
   * 语义应当是：spine 上任何 done 的节点，点下去都能看到东西。
   * 后端把 scientist 记为 done 的条件是 proposal.json 或 evidence.md 存在，
   * 而 tabForNode("scientist") 固定回 "evidence"，该 tab 只认 evidence.md ——
   * 只有 proposal.json 的 run 会点进一个被置灰的空 tab。
   * 不写断言固化现状；见报告「实现与语义不一致」。
   */
  it.todo("scientist 只落了 proposal.json 时点击不应落到空的 evidence tab")
})
