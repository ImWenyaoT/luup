import { expect, test } from "@playwright/test";

test("shell layout shows sidebar and question input", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await expect(page.getByTestId("question-sidebar-panel")).toBeVisible();
  await expect(page.getByTestId("welcome-question-input")).toBeVisible();
  await expect(page.getByTestId("question-search")).toBeVisible();
});

test("home page shows Luup heading", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Luup" })).toBeVisible();
});

test("create run navigates to ?run= query param", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("welcome-question-input").fill("E2E deterministic smoke question");
  await page.getByTestId("start-research").click();
  await page.waitForURL(/\?run=/, { timeout: 60_000 });
  await expect(page.getByTestId("run-header")).toBeVisible();
  await expect(page.getByTestId("run-workspace")).toBeVisible();
});

test("mobile uses a full-width question drawer and restores the primary task", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const drawer = page.getByTestId("question-sidebar-panel");
  await expect(drawer).toBeVisible();
  await expect.poll(async () => (await drawer.boundingBox())?.width).toBe(390);
  await page.getByRole("button", { name: "关闭Science 125 题库" }).click();
  await expect(page.getByTestId("welcome-question-input")).toBeVisible();
  await page.getByTestId("open-settings").click();
  await expect(page.getByRole("dialog", { name: "系统与模型设置" })).toBeVisible();
});
