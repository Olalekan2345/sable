import { expect, test, type Page } from "@playwright/test";

import { connect } from "./helpers";

/**
 * Being on the wrong network.
 *
 * A saver whose wallet sits on the wrong chain must never be left to work that out alone, and
 * two mechanisms now guarantee it:
 *
 * - **Reown AppKit**, which ships when a WalletConnect project id is configured, watches the
 *   connected chain and raises its own prompt the moment it becomes unsupported — before any
 *   button is pressed.
 * - **`useEnsureChain`**, which every write path awaits, asking the wallet to switch at the
 *   point of action. It is what covers the built-in picker, and it still runs beneath AppKit.
 *
 * These tests assert the *guarantee* rather than either mechanism: the wrong network is
 * surfaced, and choosing to fix it reaches the wallet as a real switch request. An earlier
 * version asserted the second mechanism specifically and broke the moment the first started
 * front-running it — a test coupled to an implementation rather than to a promise.
 */

const WALLET = "0x39A9E829969eE81962D9AD6E33906Fe0967c98de";
const SEPOLIA = "0xaa36a7";

/**
 * A wallet that starts on Sepolia and can be moved off it.
 *
 * The starting chain matters: a chooser that offers to switch during connection never finishes
 * when that switch is refused, so a wallet beginning on mainnet never gets far enough to test
 * anything. Connecting first and moving afterwards is also the more realistic sequence —
 * people connect, then change network in their wallet.
 */
async function installWallet(page: Page) {
  await page.addInitScript((account) => {
    const AUTH = "__mock_authorised";
    const CHAIN = "__mock_chain";
    const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};

    const switchRequests: string[] = [];
    (window as unknown as { __switchRequests: string[] }).__switchRequests = switchRequests;

    const currentChain = () => sessionStorage.getItem(CHAIN) ?? "0xaa36a7";
    const announceChain = (chainId: string) =>
      (listeners.chainChanged ?? []).forEach((fn) => fn(chainId));

    (window as unknown as { __moveToMainnet: () => void }).__moveToMainnet = () => {
      sessionStorage.setItem(CHAIN, "0x1");
      announceChain("0x1");
    };

    const provider = {
      request: async ({ method, params }: { method: string; params?: unknown[] }) => {
        const authorised = sessionStorage.getItem(AUTH) === "1";
        if (method === "eth_accounts") return authorised ? [account] : [];
        if (method === "eth_requestAccounts") {
          sessionStorage.setItem(AUTH, "1");
          return [account];
        }
        if (method === "eth_chainId") return currentChain();
        if (method === "net_version") return String(parseInt(currentChain(), 16));

        if (method === "wallet_switchEthereumChain") {
          const requested = (params?.[0] as { chainId: string })?.chainId;
          switchRequests.push(requested);
          sessionStorage.setItem(CHAIN, requested);
          announceChain(requested);
          return null;
        }
        return null;
      },
      on: (event: string, handler: (...args: unknown[]) => void) => {
        (listeners[event] ??= []).push(handler);
      },
      removeListener: () => {},
      isConnected: () => true,
    };

    (window as unknown as { ethereum: unknown }).ethereum = provider;
    const detail = Object.freeze({
      info: {
        uuid: "1",
        name: "MetaMask",
        icon: "data:image/svg+xml;base64,PHN2Zy8+",
        rdns: "io.metamask",
      },
      provider,
    });
    const announce = () =>
      window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail }));
    window.addEventListener("eip6963:requestProvider", announce);
    announce();
  }, WALLET);
}

const switchRequests = (page: Page) =>
  page.evaluate(() => (window as unknown as { __switchRequests: string[] }).__switchRequests);

const moveToMainnet = (page: Page) =>
  page.evaluate(() => (window as unknown as { __moveToMainnet: () => void }).__moveToMainnet());

test.describe("Network switching", () => {
  /*
   * These run against a live page: connecting through the chooser, waiting for the connection
   * to settle, then loading the deposit screen's on-chain reads. The 30-second default is
   * spent before the assertion starts.
   */
  test.setTimeout(120_000);

  test("surfaces the wrong network rather than leaving the saver to notice", async ({ page }) => {
    await installWallet(page);
    await page.goto("/app/deposit");
    await connect(page);

    await moveToMainnet(page);

    // The prompt has to name the chain the app actually needs. "Unsupported network" with no
    // destination is a dead end wearing a warning label.
    const prompt = page.locator('w3m-modal[class~="open"]');
    await expect(prompt).toBeVisible({ timeout: 30000 });
    await expect(prompt.getByText(/sepolia/i).first()).toBeVisible({ timeout: 15000 });
  });

  test("reaches the wallet as a real switch request", async ({ page }) => {
    await installWallet(page);
    await page.goto("/app/deposit");
    await connect(page);

    await moveToMainnet(page);

    const prompt = page.locator('w3m-modal[class~="open"]');
    await expect(prompt).toBeVisible({ timeout: 30000 });
    await prompt.getByText(/sepolia/i).first().click();

    // The point of the whole exercise: the wallet is asked, in its own words, to move to the
    // chain Sable runs on. Nothing here is the app pretending to have switched on its behalf.
    await expect.poll(() => switchRequests(page), { timeout: 30000 }).toContain(SEPOLIA);
  });
});
