import { describe, expect, it } from "bun:test"
import {
  displayNodes,
  fmtDur,
  fmtTime,
  stateLabel,
  statusLabel,
  tabForNode,
} from "./format"
import type { SpineNode } from "./types"

/**
 * 期望值的语义来源，不从实现输出反推：
 * - 时间/时长：`backend/app/services/runs.py` 的 `_iso()` 发 UTC ISO，
 *   `_round_seconds()` 发整数秒（可为负，因为它是两个 mtime 相减）。
 * - 节点拓扑与工件名：同文件的 `_LEGACY_NODES` / `_PRO_NODES`。
 * - 状态字面量：同文件的 `_status()` 与 `_node_states()`。
 */

const node = (over: Partial<SpineNode> & { key: string }): SpineNode => ({
  mark: "?",
  label: over.key,
  artifact: "—",
  state: "done",
  at: null,
  elapsedSec: null,
  rejects: 0,
  ...over,
})

describe("fmtTime", () => {
  it("缺时间戳时渲染占位符而不是 Invalid Date", () => {
    // API 在节点未落盘时发 null；空串是「有字段但没值」的同一类缺失。
    expect(fmtTime(null)).toBe("—")
    expect(fmtTime("")).toBe("—")
    expect(fmtTime("不是时间")).toBe("—")
  })

  it("按 UTC 渲染，不受本机时区影响", () => {
    // 带 +08:00 偏移的输入必须先归到 UTC：09:23+08:00 = 01:23Z。
    expect(fmtTime("2026-08-10T09:23:00+08:00")).toBe("08-10 01:23:00Z")
  })

  it("月日时分秒补零到两位，毫秒不显示", () => {
    expect(fmtTime("2026-03-04T05:06:07.999Z")).toBe("03-04 05:06:07Z")
  })

  it("把 epoch 0 当作「没有时间」而不是 1970 年", () => {
    // mtime 为 0 的文件是「未设置」的哨兵值，渲染成年份 1970 会误导读者。
    expect(fmtTime("1970-01-01T00:00:00.000Z")).toBe("—")
  })
})

describe("fmtDur", () => {
  it("缺时长或非正时长渲染占位符", () => {
    // elapsedSec 是两个 mtime 之差，倒序落盘时会是负数——那不是「0 秒」而是「不知道」。
    expect(fmtDur(null)).toBe("—")
    expect(fmtDur(0)).toBe("—")
    expect(fmtDur(-3)).toBe("—")
  })

  it("一分钟以内只报秒，不补零", () => {
    expect(fmtDur(1)).toBe("1s")
    expect(fmtDur(59)).toBe("59s")
  })

  it("一分钟到一小时报 m + 补零的 s", () => {
    expect(fmtDur(60)).toBe("1m 00s")
    expect(fmtDur(61)).toBe("1m 01s")
    expect(fmtDur(3599)).toBe("59m 59s")
  })

  it("一小时以上报 h + 补零的 m，丢弃秒", () => {
    expect(fmtDur(3600)).toBe("1h 00m")
    expect(fmtDur(3661)).toBe("1h 01m")
    expect(fmtDur(7199)).toBe("1h 59m")
  })

  it("超大时长不进位成天，小时数照实累加", () => {
    // 长跑 run 的耗时读者按小时理解；换算成「1d 2h」反而要心算。
    expect(fmtDur(86_400)).toBe("24h 00m")
    expect(fmtDur(359_999)).toBe("99h 59m")
  })
})

describe("标签表", () => {
  it("覆盖后端 _node_states 能发出的全部四种节点状态", () => {
    // 少一个 key，Spine 就会把 undefined 直接渲染进页面。
    expect(Object.keys(stateLabel).sort()).toEqual([
      "active",
      "done",
      "pending",
      "rejected",
    ])
    expect(Object.values(stateLabel).every((text) => text.length > 0)).toBe(
      true,
    )
  })

  it("覆盖后端 _status 能发出的全部三种 run 状态", () => {
    expect(Object.keys(statusLabel).sort()).toEqual([
      "failed",
      "passed",
      "working",
    ])
    expect(Object.values(statusLabel).every((text) => text.length > 0)).toBe(
      true,
    )
  })
})

describe("displayNodes", () => {
  it("新 API 的有序数组原样透传，不做二次映射", () => {
    // 拓扑归 Harness 所有：前端多改一次就是多一处会过期的知识。
    const nodes = [node({ key: "scientist", mark: "S", label: "Scientist" })]
    expect(displayNodes(nodes)).toBe(nodes)
  })

  it("旧 L/H/C/W 映射按固定顺序展开，与输入 key 顺序无关", () => {
    const result = displayNodes({
      proposal: "pending",
      literature: "done",
      critique: "pending",
      hypothesis: "active",
    })
    expect(result.map((item) => item.key)).toEqual([
      "literature",
      "hypothesis",
      "critique",
      "proposal",
    ])
    expect(result.map((item) => item.mark)).toEqual(["L", "H", "C", "W"])
    expect(result.map((item) => item.state)).toEqual([
      "done",
      "active",
      "pending",
      "pending",
    ])
  })

  it("映射形态没有时间信息，时间字段一律为空而不是伪造", () => {
    const [first] = displayNodes({ literature: "done" })
    expect(first?.at).toBeNull()
    expect(first?.elapsedSec).toBeNull()
    expect(first?.rejects).toBe(0)
  })

  it("含 verify 的 Pro 映射按 S/R/✓ 展开，不被误判成旧 L/H/C/W 拓扑", () => {
    // verify 同时是新旧两张表的 key，所以「判新旧」只能看旧表独有的 key。
    // 用「命中任一旧表 key」判，任何含 verify 的 Pro 映射都会翻到旧拓扑：
    // 顺序退化成插入序、scientist/reviewer 掉进未知节点占位、verify 拿到中文「验收」。
    const result = displayNodes({
      verify: "pending",
      reviewer: "active",
      scientist: "done",
    })
    expect(result.map((item) => item.key)).toEqual([
      "scientist",
      "reviewer",
      "verify",
    ])
    expect(result.map((item) => item.mark)).toEqual(["S", "R", "✓"])
    expect(result.map((item) => item.label)).toEqual([
      "Scientist",
      "Reviewer",
      "Verify",
    ])
    expect(result.map((item) => item.state)).toEqual([
      "done",
      "active",
      "pending",
    ])
  })

  it("映射形态不自称知道工件名：那是 API 随有序数组下发的知识", () => {
    // 前端存过 verify → verification.json，而后端 Pro 主名是 verification-report.md；
    // 旧表里 proposal 存的是 proposal.md，后端主名是 proposal.json。存一份就会过期。
    expect(
      displayNodes({ literature: "done", proposal: "pending" }).map(
        (item) => item.artifact,
      ),
    ).toEqual(["—", "—"])
    expect(
      displayNodes({ scientist: "done", verify: "pending" }).map(
        (item) => item.artifact,
      ),
    ).toEqual(["—", "—"])
  })

  it("未知节点排在已知节点之后，并降级成可读占位而不是崩掉", () => {
    // Harness 加节点时前端不该先挂；显示成 key 本身好过丢掉这一格。
    const result = displayNodes({ literature: "done", newnode: "active" })
    expect(result.map((item) => item.key)).toEqual(["literature", "newnode"])
    const extra = result[1]
    expect(extra?.mark).toBe("N")
    expect(extra?.label).toBe("newnode")
    expect(extra?.artifact).toBe("—")
    expect(extra?.state).toBe("active")
  })

  it("空映射产出空列表而不是塞一套默认拓扑", () => {
    expect(displayNodes({})).toEqual([])
  })

  it("原型链上的名字走未知节点降级，不会展开成缺字段的空节点", () => {
    // `known[key]` 在普通对象上查表会命中 Object.prototype 的继承属性。
    // 占位字段写在展开之前、查表结果覆盖在后，命中函数时展开为空、占位便留住了。
    for (const [key, mark] of [
      ["constructor", "C"],
      ["toString", "T"],
    ]) {
      const [only] = displayNodes({ [key]: "done" })
      expect(only?.key).toBe(key)
      expect(only?.mark).toBe(mark)
      expect(only?.label).toBe(key)
      expect(only?.artifact).toBe("—")
      expect(only?.state).toBe("done")
    }
  })
})

describe("tabForNode", () => {
  it("API 显式给的 tabId 优先于前端的 key 映射", () => {
    // 「前端不从节点名猜 tab」是 types.ts 写死的契约。
    expect(tabForNode(node({ key: "scientist", tabId: "papers" }))).toBe(
      "papers",
    )
  })

  it("空 tabId 不算给了 tab，回落到 key 映射", () => {
    expect(tabForNode(node({ key: "reviewer", tabId: "" }))).toBe("review")
  })

  it("Scientist/Reviewer/Verify 各自映射到稳定的阅读入口", () => {
    expect(tabForNode(node({ key: "scientist" }))).toBe("evidence")
    expect(tabForNode(node({ key: "reviewer" }))).toBe("review")
    expect(tabForNode(node({ key: "verify" }))).toBe("verification")
  })

  it("旧 L/H/C/W 节点仍能映射到对应 tab", () => {
    expect(tabForNode(node({ key: "literature" }))).toBe("evidence")
    expect(tabForNode(node({ key: "hypothesis" }))).toBe("hypotheses")
    expect(tabForNode(node({ key: "critique" }))).toBe("critique")
    expect(tabForNode(node({ key: "proposal" }))).toBe("proposal")
  })

  it("未知节点不返回 tab，点击时不跳到任意 tab", () => {
    expect(tabForNode(node({ key: "newnode" }))).toBeUndefined()
  })
})
