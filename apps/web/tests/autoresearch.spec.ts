import { expect, test } from "@playwright/test";

test("home is Autoresearch Mill shell", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Luup Autoresearch" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Research Mill/i })).toBeVisible();
});

test("/autoresearch 仍可达", async ({ page }) => {
  await page.goto("/autoresearch");
  await expect(page.getByRole("heading", { name: /Research Mill/i })).toBeVisible();
});
