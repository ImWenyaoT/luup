import { expect, test } from "@playwright/test";
import { RUNS } from "./fixtures.ts";

/**
 * 目标：评审第一次打开首页，能选到 Science-125 的任意一题并知道点下去会发生什么。
 * 这里**不真的触发** pipeline —— 那是一次 10~20 分钟的付费子进程，E2E 不该点它。
 * 验的是选题这一步的完整性，以及触发按钮在没选题时是关着的。
 */
test.describe("首页选题", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("题库按 12 个学科分组，一共 125 题", async ({ page }) => {
    await expect(page.getByText("125 题 / 12 学科", { exact: true })).toBeVisible();

    const domains = page.getByRole("navigation", { name: "学科" }).getByRole("button");
    await expect(domains).toHaveCount(12);

    // 各学科的题数加起来必须是 125，不能有一题落在分组之外
    const counts = await page
      .getByRole("navigation", { name: "学科" })
      .getByRole("button")
      .evaluateAll((els) => els.map((el) => Number(el.textContent?.match(/(\d+)$/)?.[1] ?? 0)));
    expect(counts.reduce((a, b) => a + b, 0)).toBe(125);
  });

  test("换一个学科，题目列表跟着换", async ({ page }) => {
    const questions = page.getByRole("list", { name: "题目" }).getByRole("listitem");

    await page.getByRole("button", { name: /^Astronomy/ }).click();
    await expect(questions).toHaveCount(23);
    await expect(page.getByRole("button", { name: /How are pulsars formed/ })).toBeVisible();

    await page.getByRole("button", { name: /^Chemistry/ }).click();
    await expect(questions).toHaveCount(9);
  });

  test("没选题时触发按钮是关着的，选完题它才开", async ({ page }) => {
    const trigger = page.getByRole("button", { name: "触发 pipeline" });
    await expect(trigger).toBeDisabled();
    await expect(page.getByText("未选题")).toBeVisible();

    await page.getByRole("button", { name: /^Astronomy/ }).click();
    await page.getByRole("button", { name: /How are pulsars formed/ }).click();

    await expect(trigger).toBeEnabled();
    await expect(page.getByText("已选 #61")).toBeVisible();
  });

  test("自由输入与选题互斥，不会两个都带上", async ({ page }) => {
    await page.getByRole("button", { name: /^Astronomy/ }).click();
    await page.getByRole("button", { name: /How are pulsars formed/ }).click();
    await expect(page.getByText("已选 #61")).toBeVisible();

    await page.getByRole("textbox").fill("暗物质晕的密度分布是否普适？");
    await expect(page.getByText("已选 #61")).toBeHidden();
    await expect(page.getByText(/自由输入 \d+ 字/)).toBeVisible();
  });

  test("首页把最近的 run 与可复制的 curl 一起摆出来", async ({ page }) => {
    await expect(page.getByRole("link", { name: new RegExp(RUNS.allPass) }).first()).toBeVisible();
    await expect(page.getByText("curl -s", { exact: false }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "复制" }).first()).toBeVisible();
    await expect(page.getByText("工件读取为只读；触发运行会写入工件并产生真实 API 费用")).toBeVisible();
  });
});
