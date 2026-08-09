import { expect, test } from "@playwright/test";
import { RUNS, panel, tab } from "./fixtures.ts";

/**
 * 「如实报失败」是这套流水线的设计主张之一。主张要能被看见才算数：
 * 失败的 run 打开就该先看到失败，而不是要翻三个标签才发现它没跑完。
 */
test.describe(`失败的 run 不被藏起来（${RUNS.failed}）`, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/runs/${RUNS.failed}`);
  });

  test("页头横幅直说 pipeline 判定失败", async ({ page }) => {
    await expect(page.getByText("如实报失败是设计的一部分")).toBeVisible();
    await expect(page.getByText("失败", { exact: true }).first()).toBeVisible();
  });

  test("FAILED 标签是默认落点，正文给出失败原因与根因", async ({ page }) => {
    await expect(tab(page, "failed")).toHaveAttribute("aria-selected", "true");

    const failed = panel(page, "failed");
    await expect(failed).toBeVisible();
    await expect(failed.getByRole("heading", { name: "FAILED Report" })).toBeVisible();
    await expect(failed).toContainText("失败原因");
    await expect(failed).toContainText("熔断器触发");
    await expect(failed).toContainText("禁止用降低标准的方式让流程");
  });

  test("走到一半的节点照常可读，没产出的标签灰显而不是报错", async ({ page }) => {
    // 前三个节点是过了的，工件还在
    await expect(tab(page, "evidence")).toBeEnabled();
    await expect(tab(page, "critique")).toBeEnabled();
    // proposal 没落盘，但被打回的原文要给出来
    await tab(page, "proposal").click();
    await expect(panel(page, "proposal")).toContainText("未通过 10 字段契约");
    // 没跑过独立验收，标签灰显，不弹错误
    await expect(tab(page, "verification")).toBeDisabled();
  });

  test("spine 把被打回的节点标出来", async ({ page }) => {
    const spine = page.getByRole("list", { name: "reasoning spine" });
    await expect(spine.getByRole("listitem").filter({ hasText: "计划" })).toContainText("打回");
  });
});
