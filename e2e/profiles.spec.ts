import { expect, test } from "@playwright/test";

test("creates and deletes an active profile safely", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Switch profile/ }).click();

  await page.getByLabel("Add a profile").fill("Family");
  await page.getByRole("button", { name: "Add", exact: true }).click();

  await page.getByRole("button", { name: /Switch profile/ }).click();
  const familyRow = page.locator(".profile-option").filter({ hasText: "Family" });
  await expect(familyRow).toBeVisible();
  const activeBeforeDelete = await page.evaluate(() =>
    localStorage.getItem("kupit-active-profile-id")
  );
  page.once("dialog", (dialog) => void dialog.accept());
  await familyRow.getByRole("button", { name: "Delete" }).click();

  await expect(page.locator(".profiles-sheet")).toBeHidden();
  await expect.poll(() => page.evaluate(() =>
    localStorage.getItem("kupit-active-profile-id")
  )).not.toBe(activeBeforeDelete);
});
