import { expect, test } from "@playwright/test";

test("home redirects to Autoresearch Mill shell", async ({ page }) => {
  await page.goto("/");
  await page.waitForURL(/\/autoresearch/);
  await expect(page.getByRole("heading", { name: "Luup Autoresearch" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Research Mill/i })).toBeVisible();
});
