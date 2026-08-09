import { expect, test } from "@playwright/test";
import { RUNS, openTab, panel } from "./fixtures.ts";

/**
 * 提交期素材：截图由用例产出，不手截 —— 页面改了截图跟着改，
 * 报告里那四张图永远是当下这套代码渲染出来的样子。
 */
const DIR = "docs/report/screenshots";

test.describe("交付截图", () => {
  test("01 运行历史列表", async ({ page }) => {
    await page.goto("/runs");
    await expect(page.getByRole("row").first()).toBeVisible();
    await page.screenshot({ path: `${DIR}/01-runs-list.png`, fullPage: true });
  });

  test("02 详情页 reasoning spine", async ({ page }) => {
    await page.goto(`/runs/${RUNS.allPass}`);
    await expect(panel(page, "proposal")).toBeVisible();
    // spine 是主轴，截首屏而不是整页：整页会把 proposal 正文拉出十屏
    await page.screenshot({ path: `${DIR}/02-run-spine.png` });
  });

  test("03 独立验收逐项通过", async ({ page }) => {
    await page.goto(`/runs/${RUNS.allPass}`);
    const verification = await openTab(page, "verification");
    await expect(verification).toContainText("ALL PASS");
    await page.screenshot({ path: `${DIR}/03-verification.png` });
  });

  test("04 诚实失败的 run", async ({ page }) => {
    await page.goto(`/runs/${RUNS.failed}`);
    await expect(panel(page, "failed")).toBeVisible();
    await page.screenshot({ path: `${DIR}/04-failed-run.png` });
  });
});
