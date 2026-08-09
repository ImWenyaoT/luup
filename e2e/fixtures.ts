import type { Page } from "@playwright/test";

/**
 * 用例打的是仓库里 8 个**真实** run，不是 mock：交付面的整个价值主张就是
 * 「读的是仓库里的真实工件」，拿 fixture 顶掉它，测出来的绿证明不了任何东西。
 *
 * 这三个 id 各自钉住一类形态，删 run 目录会让对应用例红——那正是它该红的时候。
 */
export const RUNS = {
  /** 全绿：五节点走完 + proposal.md + 独立验收 ALL PASS + 11 篇论文 */
  allPass: "20260808-134046",
  /** 2026-08-08 改名前的老 run：批判节点落的是 critique.md（markdown），不是 critique.json */
  legacyCritique: "20260808-055459",
  /** 诚实失败：proposal 三轮不合契约，pipeline 写下 FAILED.md 而不是降标准放行 */
  failed: "20260808-093646",
} as const;

/** 仓库里 run 目录的下限。新跑的 run 只会让它变多，所以断言写成 ≥。 */
export const MIN_RUNS = 8;

/** 详情页的标签页（id 来自 lib/nodes.ts 的注册表 tabId + 两个派生视图）。 */
export type TabId =
  | "failed"
  | "evidence"
  | "hypotheses"
  | "critique"
  | "proposal"
  | "verdicts"
  | "verification"
  | "papers";

export const tab = (page: Page, id: TabId) => page.locator(`#tab-${id}`);

/** 面板用 hidden 藏，不卸载——所以「看得到」必须是可见性断言，不是存在性断言。 */
export const panel = (page: Page, id: TabId) => page.locator(`[aria-labelledby="tab-${id}"]`);

export async function openTab(page: Page, id: TabId) {
  await tab(page, id).click();
  return panel(page, id);
}
