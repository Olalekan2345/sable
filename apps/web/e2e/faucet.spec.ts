import { expect, test, type Page } from "@playwright/test";

import { connect, releaseRoutes } from "./helpers";

/**
 * Obtaining the test token.
 *
 * Sable issues nothing, so a wallet arriving with no `USDCMock` cannot reach a single feature
 * — shielding needs it, depositing needs the shielded form of it. That made the empty wallet a
 * dead end, which is the state every judge and every new user starts in.
 *
 * These tests hold two things in place: that the way in exists wherever the dead end was, and
 * that the interface is specific about whose contract it is about to ask a wallet to sign for.
 */

/** A wallet that has never touched anything. */
const FRESH = "0x000000000000000000000000000000000000bEEF";

/** A wallet that already holds the test token — the state the faucet used to vanish in. */
const HOLDER = "0x39A9E829969eE81962D9AD6E33906Fe0967c98de";

async function installWallet(page: Page, account: string) {
  await page.addInitScript((address) => {
    // Approval has to survive a navigation, as it does in a real wallet. Holding it in a
    // closure meant every page load looked like a fresh, unconnected browser.
    const KEY = "__mock_authorised";
    const provider = {
      request: async ({ method }: { method: string }) => {
        const authorised = sessionStorage.getItem(KEY) === "1";
        if (method === "eth_accounts") return authorised ? [address] : [];
        if (method === "eth_requestAccounts") {
          sessionStorage.setItem(KEY, "1");
          return [address];
        }
        if (method === "eth_chainId") return "0xaa36a7";
        if (method === "net_version") return "11155111";
        return null;
      },
      on: () => {},
      removeListener: () => {},
      isConnected: () => true,
    };
    (window as unknown as { ethereum: unknown }).ethereum = provider;
    const detail = Object.freeze({
      info: { uuid: "1", name: "MetaMask", icon: "data:image/svg+xml;base64,PHN2Zy8+", rdns: "io.metamask" },
      provider,
    });
    const announce = () =>
      window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail }));
    window.addEventListener("eip6963:requestProvider", announce);
    announce();
  }, account);
}

test.describe("Test token faucet", () => {
  test.afterEach(async ({ page }) => {
    await releaseRoutes(page);
  });

  test.beforeEach(async ({ page }) => {
    await installWallet(page, FRESH);
  });

  // Connected separately on each page: wagmi's reconnect does not always survive a navigation
  // in a fresh context, and a test that silently lands on the connect prompt asserts nothing.
  for (const path of ["/app/deposit", "/app/deposit/shield"]) {
    test(`offers a way in at ${path}`, async ({ page }) => {
      await page.goto(path);
      await connect(page);

      const button = page.getByRole("button", { name: /get 10,000 usdcmock/i });
      await expect(button.first()).toBeVisible({ timeout: 30000 });
      await expect(button.first()).toBeEnabled();
    });
  }

  test("names the contract it is about to call, and links to it", async ({ page }) => {
    await page.goto("/app/deposit/shield");
    await connect(page);
    await expect(page.getByText(/public mint on/i).first()).toBeVisible({ timeout: 30000 });

    const body = await page.locator("main").innerText();
    // A savings product asking for a signature should say whose contract this is. It is Zama's
    // mock, open for anyone to call — Sable mints nothing, and the copy has to keep saying so.
    expect(body).toMatch(/Zama’s USDCMock contract/i);
    expect(body).toMatch(/Sable issues nothing/i);

    // And the link must point at that token, not at Sable.
    const href = await page
      .locator('main a[href*="etherscan"]', { hasText: /USDCMock contract/i })
      .first()
      .getAttribute("href");
    expect(href?.toLowerCase()).toContain("0x9b5cd13b8efbb58dc25a05cf411d8056058adfff");
  });
});

test.describe("Faucet availability", () => {
  test.afterEach(async ({ page }) => {
    await releaseRoutes(page);
  });

  test("stays reachable once the wallet already holds tokens", async ({ page }) => {
    await installWallet(page, HOLDER);
    await page.goto("/app");
    await connect(page);

    /*
     * The regression this guards.
     *
     * The faucet used to live only in an empty state, so it disappeared the moment it had
     * worked — exactly when somebody running the flow a second time goes looking for it. It
     * now sits in the app bar, on every page, whatever the balance.
     */
    for (const path of ["/app", "/app/assets", "/app/withdraw", "/app/activity"]) {
      await page.goto(path);
      await expect(
        page.getByRole("button", { name: /get test tokens/i }),
        `faucet should be reachable at ${path}`,
      ).toHaveCount(1);
    }
  });
});
