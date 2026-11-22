import { expect, test } from "@playwright/test";

test("settings exposes the active profile and working appearance controls", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();

  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByText("Profiles & Sync")).toBeVisible();
  await expect(page.getByText("Coming soon")).not.toHaveCount(0);

  await page.getByRole("button", { name: "Dark" }).click();
  await expect(page.getByRole("button", { name: "Dark" })).toHaveClass(/selected/);

  await page.getByRole("button", { name: /Currency PHP/ }).click();
  await page.getByRole("button", { name: /USD US Dollar/ }).click();

  await page.locator(".kupit-settings-back").click();
  await page.getByRole("button", { name: /Switch profile/ }).click();
  await expect(page.getByText("USD")).toBeVisible();
});
