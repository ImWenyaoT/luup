import { expect, test } from "@playwright/test";
import { RUNS, openTab, tab } from "./fixtures.ts";

/**
 * 2026-08-08 批判工件从 critique.md 改名成 critique.json，web 层曾经只认新名字，
 * 老 run 的批判标签整片灰显。这条用例就是那次事故的回归护栏：
 * 工件改名之后，老 run 的内容仍然读得到。
 */
test.describe(`老工件名的 run 仍然可读（${RUNS.legacyCritique}）`, () => {
  test("critique 标签不灰显，渲染的是 markdown 正文", async ({ page }) => {
    await page.goto(`/runs/${RUNS.legacyCritique}`);

    const button = tab(page, "critique");
    await expect(button).toBeEnabled();
    await expect(button).not.toHaveAttribute("aria-disabled", "true");

    const critique = await openTab(page, "critique");
    await expect(critique.getByRole("heading", { name: "对抗式批评报告" })).toBeVisible();
    await expect(critique.getByRole("heading", { name: "逐假设批判" })).toBeVisible();
    // markdown 渲染成元素，不是 JSON 面板那种整块 pre
    await expect(critique.locator("strong").first()).toBeVisible();
  });

  test("这次 run 的独立验收挂在引用真实性上，页面如实显示", async ({ page }) => {
    await page.goto(`/runs/${RUNS.legacyCritique}`);
    const verification = await openTab(page, "verification");

    await expect(verification).toContainText("FAILED");
    // 挂掉的组默认摊开，通过的组收起来——评审先看到的必须是挂的那一条
    await expect(verification.getByText("虚构作者嫌疑").first()).toBeVisible();

    // 收起来的组仍然点得开：默认折叠是排序，不是藏证据
    const b1 = verification.getByText("B1 · 引用出自本次运行的 memory/papers/");
    await expect(verification.getByText("B1.2009.04238")).toBeHidden();
    await b1.click();
    await expect(verification.getByText("B1.2009.04238")).toBeVisible();
  });
});
