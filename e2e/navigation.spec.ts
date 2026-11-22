import { expect, test } from "@playwright/test";

test("navigates through the main application tabs", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Wallet" }).click();
  await expect(page.getByRole("heading", { name: "Wallet" })).toBeVisible();

  await page.getByRole("button", { name: "Plan" }).click();
  await expect(page.getByRole("heading", { name: "Plan" })).toBeVisible();

  await page.getByRole("button", { name: "History" }).click();
  await expect(page.getByRole("heading", { name: "History" })).toBeVisible();
});
