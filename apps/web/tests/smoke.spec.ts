import { expect, test } from "@playwright/test";

test("home page shows Luup heading", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Luup" })).toBeVisible();
});
