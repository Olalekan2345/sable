import type { Page } from "@playwright/test";
import {
  decodeFunctionData,
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionResult,
  parseAbi,
} from "viem";

/**
 * Shared fixtures for the connected-wallet suites.
 *
 * Two problems these solve. The app renders a connect prompt rather than a page until a
 * wallet is attached, so every test needs an announced provider; and the test wallet holds no
 * tokens, with a faucet deliberately absent from the product, so balances have to be supplied.
 *
 * The balance override is surgical on purpose: every RPC call still reaches Sepolia and only
 * the `balanceOf` result inside the Multicall3 batch is rewritten. The wrapper metadata, the
 * token symbols and decimals, the pause and denylist state are all genuinely fetched, so a
 * break in the real integration still fails these suites.
 */

const WALLET = "0x39A9E829969eE81962D9AD6E33906Fe0967c98de";
const UNDERLYING = "0x9b5cd13b8efbb58dc25a05cf411d8056058adfff";
const BALANCE_OF = "0x70a08231";

const multicall3Abi = parseAbi([
  "struct Call3 { address target; bool allowFailure; bytes callData; }",
  "struct Result { bool success; bytes returnData; }",
  "function aggregate3(Call3[] calls) payable returns (Result[])",
]);

/**
 * Serves the page a chosen underlying-token balance.
 *
 * Two layers of batching sit between the app and the value being overridden, and both have to
 * be unpacked:
 *
 * 1. **Multicall3** folds every contract read into one `eth_call`, so the `balanceOf` has to
 *    be located inside the encoded call array and its result swapped in place.
 * 2. **JSON-RPC batching** — the transport packs concurrent calls into a single HTTP POST
 *    whose body is an *array* of requests. Treating that body as a single request, which an
 *    earlier version did, silently stops matching anything the moment batching is enabled.
 */
export async function withUnderlyingBalance(page: Page, balance: bigint) {
  /** Rewrites one JSON-RPC result if it carries the balance being overridden. */
  const substitute = (call: { params?: [{ data?: `0x${string}` }] }, result: unknown) => {
    const callData = call.params?.[0]?.data;
    if (typeof result !== "string" || !callData) return result;

    let index = -1;
    try {
      const { args } = decodeFunctionData({ abi: multicall3Abi, data: callData });
      const calls = args?.[0] as readonly { target: string; callData: string }[] | undefined;
      index =
        calls?.findIndex(
          (entry) =>
            entry.target.toLowerCase() === UNDERLYING && entry.callData.startsWith(BALANCE_OF),
        ) ?? -1;
    } catch {
      return result;
    }
    if (index < 0) return result;

    try {
      const decoded = decodeFunctionResult({
        abi: multicall3Abi,
        functionName: "aggregate3",
        data: result as `0x${string}`,
      }) as { success: boolean; returnData: `0x${string}` }[];

      decoded[index] = {
        success: true,
        returnData: encodeAbiParameters([{ type: "uint256" }], [balance]),
      };

      return encodeFunctionResult({
        abi: multicall3Abi,
        functionName: "aggregate3",
        result: decoded,
      });
    } catch {
      return result;
    }
  };

  await page.route(/rpc|thirdweb|drpc|infura|alchemy/i, async (route) => {
    const request = route.request();
    const body = request.postData();

    if (request.method() !== "POST" || !body?.includes("eth_call")) return route.continue();

    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return route.continue();
    }

    // Let the real call happen, then substitute the values under test.
    //
    // Wrapped because a request can still be in flight when the test ends: the page is gone by
    // the time the response lands, and every route method then throws. That is teardown noise,
    // not a failure, and it must not fail an otherwise passing test.
    try {
      const response = await route.fetch();
      const json = await response.json();

      // A batched body is an array of requests, answered by an array of results keyed on `id`.
      // A lone request is the same shape without the wrapper.
      if (Array.isArray(parsed) && Array.isArray(json)) {
        const calls = new Map(
          parsed.map((call) => [
            (call as { id: number }).id,
            call as { params?: [{ data?: `0x${string}` }] },
          ]),
        );
        return await route.fulfill({
          json: json.map((entry) => {
            const call = calls.get((entry as { id: number }).id);
            if (!call) return entry;
            return {
              ...(entry as object),
              result: substitute(call, (entry as { result?: unknown }).result),
            };
          }),
        });
      }

      return await route.fulfill({
        json: {
          ...(json as object),
          result: substitute(
            parsed as { params?: [{ data?: `0x${string}` }] },
            (json as { result?: unknown }).result,
          ),
        },
      });
    } catch {
      // The page is closing. Nothing left to serve.
    }
  });
}

/**
 * Releases the RPC interception.
 *
 * Call from `afterEach`. Without it Playwright reports handlers still running at teardown as
 * test errors, which surfaces as an unrelated suite failing intermittently.
 */
export async function releaseRoutes(page: Page) {
  await page.unrouteAll({ behavior: "ignoreErrors" });
}

/**
 * Announces a single wallet over EIP-6963.
 *
 * Must run before the first navigation — an init script only applies to documents opened
 * after it is registered, so injecting it after `goto` leaves the page with no provider.
 */
export async function installWallet(page: Page) {
  await page.addInitScript((account) => {
    let authorised = false;
    const provider = {
      request: async ({ method }: { method: string }) => {
        if (method === "eth_accounts") return authorised ? [account] : [];
        if (method === "eth_requestAccounts") {
          authorised = true;
          return [account];
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

/**
 * Walks whichever wallet chooser this build ships. The app renders a prompt, not the page,
 * until this happens.
 *
 * Two of them exist and only one is active per build: Reown AppKit when a WalletConnect
 * project id is configured, and Sable's own EIP-6963 picker when it is not. AppKit renders
 * into shadow DOM, which Playwright's text and CSS engines pierce, so both are reachable —
 * but they are reached differently, and a helper hard-coded to one silently fails the whole
 * connected suite the moment the other is enabled.
 */
export async function connect(page: Page) {
  await page.getByRole("button", { name: /connect wallet/i }).first().click();

  const ownPicker = page.locator('[role="dialog"]').getByRole("button", { name: /metamask/i });
  const appKit = page.locator("w3m-modal").getByText("MetaMask", { exact: true });

  await Promise.race([
    ownPicker.waitFor({ state: "visible", timeout: 20000 }).catch(() => {}),
    appKit.waitFor({ state: "visible", timeout: 20000 }).catch(() => {}),
  ]);

  if (await ownPicker.count()) {
    await ownPicker.click();
  } else {
    await appKit.first().click();
  }

  // Wait for the connection to actually establish, not merely for the click to land. AppKit
  // resolves through its own state machine, so returning on the click meant callers asserted
  // against a page still showing the connect prompt — and read that as the feature missing.
  await page
    .getByRole("button", { name: /connect wallet/i })
    .first()
    .waitFor({ state: "detached", timeout: 20000 })
    .catch(() => {
      // Left to the caller: some tests are about what happens when connecting fails.
    });

  // Dismiss the chooser if it lingers. AppKit does not always close itself on a successful
  // connection — it can settle on an account view — and the open overlay then swallows every
  // click the test makes next, which surfaces as an unrelated button being "not clickable".
  const open = page.locator('w3m-modal[class~="open"]');
  if (await open.count()) {
    await page.keyboard.press("Escape");
    await open.waitFor({ state: "hidden", timeout: 10000 }).catch(() => {});
  }
}
