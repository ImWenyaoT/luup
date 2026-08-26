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
