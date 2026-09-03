import { expect, test } from "@playwright/test";

import { connect, installWallet, releaseRoutes, withUnderlyingBalance } from "./helpers";

/**
 * Shielding: converting a public ERC-20 into the confidential token Sable accepts.
 */

test.describe("Shield", () => {
  test.afterEach(async ({ page }) => {
    await releaseRoutes(page);
  });

  test.beforeEach(async ({ page }) => {
    await installWallet(page);
  });

  test("is reachable from the deposit step navigation", async ({ page }) => {
    await withUnderlyingBalance(page, 250_000_000n);
    await page.goto("/app/deposit");
    await connect(page);

    await page
      .getByRole("navigation", { name: /deposit steps/i })
      .getByRole("link", { name: /shield/i })
      .click();
    await expect(page).toHaveURL(/\/app\/deposit\/shield/);
  });

  test("offers an amount field and previews what will be received", async ({ page }) => {
    await withUnderlyingBalance(page, 250_000_000n); // 250 USDCMock
    await page.goto("/app/deposit/shield");
    await connect(page);

    // The real symbols, read from the real contracts.
    await expect(page.getByText("250 USDCMock")).toBeVisible({ timeout: 20000 });

    const field = page.getByRole("textbox", { name: /amount to shield/i });
    await field.fill("40");

    // Rate is 1 for this asset, so 40 in becomes 40 out — and the preview must say so
    // rather than leaving the saver to assume it.
    await expect(page.getByText("40.00 cUSDCMock")).toBeVisible();
    await expect(page.getByRole("button", { name: /shield into cUSDCMock/i })).toBeEnabled();
  });

  test("states plainly that the balance being shielded is public", async ({ page }) => {
    await withUnderlyingBalance(page, 250_000_000n);
    await page.goto("/app/deposit/shield");
    await connect(page);

    // Wait for the reads to land: the empty-balance branch renders different copy, and
    // asserting before it resolves tests the loading state instead of the real one.
    await expect(page.getByText("250 USDCMock")).toBeVisible({ timeout: 20000 });

    const body = (await page.locator("main").innerText()).toLowerCase();

    // `wrap(to, amount)` takes a cleartext amount, so this step is not itself private. The
    // page must not imply otherwise — overstating privacy is the one failure this product
    // cannot afford.
    expect(body).toContain("public balance");
    expect(body).toContain("shielding is public");
  });

  test("refuses an amount larger than the wallet holds", async ({ page }) => {
    await withUnderlyingBalance(page, 250_000_000n);
    await page.goto("/app/deposit/shield");
    await connect(page);

    const field = page.getByRole("textbox", { name: /amount to shield/i });
    await field.fill("400");

    await expect(page.getByText(/more than the 250 USDCMock/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /shield into/i })).toBeDisabled();
  });

  test("Max fills the full balance and stays spendable", async ({ page }) => {
    await withUnderlyingBalance(page, 250_000_000n);
    await page.goto("/app/deposit/shield");
    await connect(page);

    await page.getByRole("button", { name: /^max/i }).click();

    await expect(page.getByRole("textbox", { name: /amount to shield/i })).toHaveValue("250");
    await expect(page.getByRole("button", { name: /shield into/i })).toBeEnabled();
  });

  test("explains itself rather than dead-ending when the wallet holds nothing", async ({ page }) => {
    await withUnderlyingBalance(page, 0n);
    await page.goto("/app/deposit/shield");
    await connect(page);

    await expect(page.getByText(/you have no usdcmock in this wallet/i)).toBeVisible({
      timeout: 20000,
    });
    // A route onward still exists — someone may already hold the confidential token.
    await expect(page.getByRole("link", { name: /go to deposit/i })).toBeVisible();
  });
});
