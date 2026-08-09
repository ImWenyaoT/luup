import { expect, test } from "@playwright/test";
import { MIN_RUNS, RUNS } from "./fixtures.ts";

/**
 * 目标：评审打开 /runs，不点任何东西就能回答「跑过几次、哪几次算数」。
 * 因此断言的是行数与状态语义，不是「按钮能不能点」。
 */
test.describe("浏览运行历史", () => {
  test("列表列出仓库里全部 run，每行带可读的状态", async ({ page }) => {
    await page.goto("/runs");

    const rows = page.getByRole("row").filter({ has: page.getByRole("link") });
    expect(await rows.count()).toBeGreaterThanOrEqual(MIN_RUNS);

    // 行数与右上角计数是同一个事实，不许各说各话
    await expect(page.getByText(`${await rows.count()} 行`)).toBeVisible();
  });

  test("各状态筛选项的计数加起来等于全部", async ({ page }) => {
    await page.goto("/runs");

    const counts = await page
      .locator("button[aria-pressed]")
      .evaluateAll((els) => els.map((el) => Number(el.textContent?.match(/(\d+)$/)?.[1] ?? 0)));
    const [all, ...byStatus] = counts;
    expect(byStatus.reduce((a, b) => a + b, 0)).toBe(all);
  });

  test("通过独立验收的 run 显示「通过验收 / ALL PASS」", async ({ page }) => {
    await page.goto("/runs");

    const row = page.getByRole("row").filter({ hasText: RUNS.allPass });
    await expect(row).toContainText("通过验收");
    await expect(row).toContainText("ALL PASS");
    // 状态徽章不是装饰：它必须与那一行的验收结论指向同一个结果
    await expect(row).not.toContainText("失败");
  });

  test("pipeline 判定失败的 run 显示「失败」，且不冒充已验收", async ({ page }) => {
    await page.goto("/runs");

    const row = page.getByRole("row").filter({ hasText: RUNS.failed });
    await expect(row).toContainText("失败");
    await expect(row).not.toContainText("ALL PASS");
  });

  test("起止时间被压成同一刻的 run，耗时显示「—」而不是「0s」", async ({ page }) => {
    await page.goto("/runs");

    // 20260808-062829 的 meta.json 是 backfill 出来的，startedAt === finishedAt
    const row = page.getByRole("row").filter({ hasText: "20260808-062829" });
    await expect(row).toContainText("—");
    await expect(row).not.toContainText("0s");
  });

  test("按状态筛选后只剩该状态的 run", async ({ page }) => {
    await page.goto("/runs");

    await page.getByRole("button", { name: /^失败/ }).click();

    const rows = page.getByRole("row").filter({ has: page.getByRole("link") });
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(RUNS.failed);
  });

  test("从列表点进详情，落在同一个 run 上", async ({ page }) => {
    await page.goto("/runs");
    await page.getByRole("link", { name: RUNS.allPass }).click();

    await expect(page).toHaveURL(new RegExp(`/runs/${RUNS.allPass}$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(RUNS.allPass);
    await expect(page.locator("header h2")).toContainText("Pulsar Formation");
  });
});
