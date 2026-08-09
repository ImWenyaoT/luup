import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { RUNS, openTab } from "./fixtures.ts";

/**
 * a11y 基线只卡 serious/critical：这是一台密排仪表，不是内容站，
 * 把 minor 也当红线会逼出一堆为了跑绿而加的装饰性属性（那正是 slop）。
 *
 * 卡住的两类是真会让人用不了的：对比度不足，以及交互控件没有可读名字。
 */
const SEVERE = new Set(["serious", "critical"]);

async function scan(page: import("@playwright/test").Page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  return violations
    .filter((v) => SEVERE.has(v.impact ?? ""))
    .map((v) => `${v.id}(${v.impact}) × ${v.nodes.length}: ${v.nodes[0]?.target.join(" ")}`);
}

test.describe("a11y 基线", () => {
  test("首页无严重违规（含选中态）", async ({ page }) => {
    await page.goto("/");
    expect(await scan(page)).toEqual([]);

    // 选中态把 accent-soft 铺到整行底下，行内的次要文字要在那层浅底上照样读得清
    await page.getByRole("button", { name: /^Astronomy/ }).click();
    await page.getByRole("button", { name: /How are pulsars formed/ }).click();
    expect(await scan(page)).toEqual([]);
  });

  test("历史页无严重违规", async ({ page }) => {
    await page.goto("/runs");
    expect(await scan(page)).toEqual([]);
  });

  test("详情页无严重违规（含展开的验收表与认证列表）", async ({ page }) => {
    await page.goto(`/runs/${RUNS.allPass}`);
    await openTab(page, "verification");
    expect(await scan(page)).toEqual([]);

    await openTab(page, "verdicts");
    expect(await scan(page)).toEqual([]);
  });

  test("失败详情页无严重违规", async ({ page }) => {
    await page.goto(`/runs/${RUNS.failed}`);
    expect(await scan(page)).toEqual([]);
  });

  test("深色配色下对比度同样达标", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto(`/runs/${RUNS.allPass}`);
    expect(await scan(page)).toEqual([]);
  });

  test("键盘可以只用 Tab 走到主要入口，焦点看得见", async ({ page }) => {
    await page.goto("/runs");
    await page.keyboard.press("Tab");

    const focused = page.locator(":focus-visible");
    await expect(focused).toBeVisible();
    // 全局 :focus-visible 描边，不是浏览器默认那圈被 reset 掉的
    await expect(focused).toHaveCSS("outline-style", "solid");
  });
});
