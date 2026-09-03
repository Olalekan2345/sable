import { expect, test } from "@playwright/test";

import { connect, installWallet, releaseRoutes, withUnderlyingBalance } from "./helpers";

/**
 * The holdings view.
 *
 * Its whole reason for existing is one contrast: public balances printed, shielded balances
 * masked. The assertions below are mostly about that boundary holding — a regression that
 * rendered a confidential balance without a reveal would be a privacy failure, not a
 * cosmetic one, and it is exactly the sort of thing a refactor of the reveal plumbing could
 * cause without any visible error.
 */

/**
 * Waits for the holdings themselves, not merely for the page.
 *
 * Waiting on a token symbol is not enough: the footer card names the vault's asset as
 * `cUSDCMock`, which contains `USDCMock`, so a substring match succeeds while the list is
 * still a row of skeletons — and every later assertion then runs against an empty list and
 * passes for the wrong reason. A reveal button exists only on a loaded row.
 */
async function awaitHoldings(page: import("@playwright/test").Page) {
  await expect(page.getByRole("button", { name: /^reveal$/i }).first()).toBeVisible({
    timeout: 20000,
  });
}

const PUBLISHED_ASSETS = [
  "USDCMock",
  "USDTMock",
  "XAUtMock",
  "WETHMock",
  "BRONMock",
  "ZAMAMock",
  "tGBPMock",
];

test.describe("Assets", () => {
  test.afterEach(async ({ page }) => {
    await releaseRoutes(page);
  });

  test.beforeEach(async ({ page }) => {
    await installWallet(page);
    await withUnderlyingBalance(page, 250_000_000n);
  });

  test("lists every published confidential asset", async ({ page }) => {
    await page.goto("/app/assets");
    await connect(page);

    await awaitHoldings(page);

    const body = await page.locator("main").innerText();
    for (const symbol of PUBLISHED_ASSETS) {
      expect(body, `${symbol} should be listed`).toContain(symbol);
    }
  });

  test("shows public balances but keeps shielded balances masked", async ({ page }) => {
    await page.goto("/app/assets");
    await connect(page);

    await awaitHoldings(page);

    // The public balance is a plain uint256 anyone can read, so it is simply printed.
    await expect(page.getByText("250", { exact: true }).first()).toBeVisible();

    // Nothing shielded may be legible without an explicit reveal. Every asset row offers one.
    const reveals = page.getByRole("button", { name: /^reveal$/i });
    await expect(reveals).toHaveCount(PUBLISHED_ASSETS.length + 1); // + the non-mock ctGBP

    const body = await page.locator("main").innerText();
    expect(body, "a masked balance must render as a mask, not a number").toContain("••••••");
  });

  test("gives every asset an identifying mark, none of them fetched", async ({ page }) => {
    await page.goto("/app/assets");
    await connect(page);
    await awaitHoldings(page);

    /*
     * Marks may be drawn inline or served from this origin, never fetched from anyone else.
     *
     * The rule was once "no images at all", which was simply how the marks happened to be
     * built. The property that actually matters is narrower: requesting one logo per asset
     * from a CDN would tell that host exactly which tokens this wallet holds, and the request
     * pattern *is* the holdings. Artwork served from Sable's own origin tells nobody anything.
     *
     * So this asserts the origin rather than the absence, and checks resolved `src` values
     * rather than the attribute — an attribute selector would miss an absolute URL built at
     * runtime, which is exactly the regression worth catching.
     */
    const sources = await page.locator("main img").evaluateAll((images) =>
      images.map((image) => (image as HTMLImageElement).src),
    );
    const origin = new URL(page.url()).origin;
    const foreign = sources.filter((src) => src !== "" && !src.startsWith(origin) && !src.startsWith("data:"));
    expect(foreign, "no token logo may be fetched from a third party").toEqual([]);

    const unknownMarks = await page.locator("main").getByText("?", { exact: true }).count();
    expect(unknownMarks, "every published asset should resolve to a real mark").toBe(0);
  });

  test("says which asset can actually be saved", async ({ page }) => {
    await page.goto("/app/assets");
    await connect(page);

    await awaitHoldings(page);

    // Listing eight assets while the vault accepts one would be a promise the deployment
    // does not keep.
    await expect(page.getByText(/vault custodies/i)).toBeVisible();
    await expect(page.getByText(/sable accepts/i).first()).toBeVisible();
  });

  test("links a held asset straight to shielding it", async ({ page }) => {
    await page.goto("/app/assets");
    await connect(page);

    await awaitHoldings(page);

    const shield = page.getByRole("link", { name: /shield/i }).first();
    await expect(shield).toBeVisible();
    await shield.click();

    await expect(page).toHaveURL(/\/app\/deposit\/shield\?asset=0x/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/shield/i);
  });

  test("is reachable from the app navigation", async ({ page }) => {
    await page.goto("/app");
    await connect(page);

    // Present in the desktop rail and the phone bar alike — the holdings view is a primary
    // destination on both, not a desktop-only extra.
    const nav = page.getByRole("navigation", { name: "Account" }).first();
    await nav.getByRole("link", { name: /^assets$/i }).click();

    await expect(page).toHaveURL(/\/app\/assets/);
  });
});

test.describe("Cross-asset shielding", () => {
  test.afterEach(async ({ page }) => {
    await releaseRoutes(page);
  });

  test.beforeEach(async ({ page }) => {
    await installWallet(page);
    await withUnderlyingBalance(page, 250_000_000n);
  });

  test("warns that an unsupported asset cannot be deposited", async ({ page }) => {
    // cUSDTMock — a real published wrapper this deployment's vault does not custody.
    await page.goto("/app/deposit/shield?asset=0x4E7B06D78965594eB5EF5414c357ca21E1554491");
    await connect(page);

    await expect(page.getByText(/does not accept/i)).toBeVisible({ timeout: 20000 });
  });

  test("ignores an asset parameter that is not a published wrapper", async ({ page }) => {
    // An arbitrary address in a URL must never become a contract this page asks a wallet to
    // approve. Unknown values fall back to the deployment's own asset.
    await page.goto("/app/deposit/shield?asset=0x000000000000000000000000000000000000dEaD");
    await connect(page);

    await expect(page.getByText(/cUSDCMock/).first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByText(/does not accept/i)).toHaveCount(0);
  });
});
