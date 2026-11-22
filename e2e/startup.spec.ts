import { expect, test } from "@playwright/test";

test("loads the budgeting home page", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: /Switch profile/ })).toBeVisible();
  await expect(page.getByText("Month")).toBeVisible();
  await expect(page.getByText("No expenses recorded")).toBeVisible();
  await expect(page.getByRole("button", { name: /Switch profile/ })).toBeVisible();
});
