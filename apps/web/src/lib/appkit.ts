"use client";

import { SABLE_CHAIN } from "@sable/config";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { createAppKit, type AppKit } from "@reown/appkit/react";
import { http } from "wagmi";

/**
 * Reown AppKit — the wallet connection kit.
 *
 * ## Why AppKit and not RainbowKit or ConnectKit
 *
 * Both were evaluated first and neither installs on this stack: RainbowKit peers
 * `wagmi@^2.9.0` and ConnectKit peers React 17/18, while Sable runs wagmi 3 and React 19.
 *
 * AppKit works because it is **framework-agnostic** — the modal is built from Lit web
 * components, so it declares no React peer dependency at all and cannot conflict with React
 * 19. Its wagmi adapter accepts `wagmi >= 2.19.5`.
 *
 * What it adds over the built-in picker: several hundred wallets, mobile deep links, QR
 * pairing for phone wallets, and connection flows that have been through far more real-world
 * edge cases than anything written here.
 *
 * ## The fallback is deliberate
 *
 * AppKit requires a project id. Without one it cannot initialise, so a clone of this
 * repository with no configuration would have no way to connect a wallet at all. When the id
 * is absent, Sable falls back to its own EIP-6963 picker, which needs no external service and
 * handles browser extensions perfectly well — it simply cannot do mobile QR.
 *
 * A reviewer should never hit a dead end because they lack an account somewhere.
 */

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim();

/** True when AppKit can be initialised. */
export const appKitEnabled = Boolean(projectId);

const metadata = {
  name: "Sable",
  description: "Confidential savings. Save privately. Win fairly.",
  url: typeof window !== "undefined" ? window.location.origin : "https://sable.finance",
  icons: [typeof window !== "undefined" ? `${window.location.origin}/icon.svg` : ""].filter(Boolean),
};

/**
 * The wagmi adapter, which owns the wagmi config when AppKit is in use.
 *
 * AppKit needs to construct the config itself so it can register its own connectors
 * (WalletConnect, the embedded auth wallet) alongside discovered browser extensions.
 */
export const wagmiAdapter = projectId
  ? new WagmiAdapter({
      projectId,
      networks: [SABLE_CHAIN],
      /*
       * See the note in `lib/wagmi.ts`: `ssr: true` makes wagmi wait for an `initialState`
       * that nothing supplies, and discard the stored session in the meantime. The adapter
       * builds its own config, so it needs the same correction — a fix applied to one and not
       * the other would work only on deployments without a WalletConnect project id.
       */
      ssr: false,
      transports: {
        [SABLE_CHAIN.id]: http(process.env.NEXT_PUBLIC_RPC_URL || undefined, {
        /*
         * Pack concurrent JSON-RPC calls into one HTTP request.
         *
         * The activity view walks a block range in windows, which is dozens of small calls;
         * batching turns them into a handful of round trips and is the difference between a
         * timeline that loads and one a public endpoint throttles halfway through. Multicall
         * already batches contract *reads* — this covers everything else.
         */
        batch: { wait: 16, batchSize: 8 },
      }),
      },
    })
  : null;

let modal: AppKit | null = null;

/**
 * Creates the AppKit modal exactly once.
 *
 * Idempotent because React strict mode mounts providers twice in development, and a second
 * `createAppKit` would register a duplicate modal element.
 */
export function initAppKit(): void {
  if (modal || !projectId || !wagmiAdapter) return;

  modal = createAppKit({
    adapters: [wagmiAdapter],
    networks: [SABLE_CHAIN],
    defaultNetwork: SABLE_CHAIN,
    projectId,
    metadata,

    features: {
      // Wallets only. Email and social sign-in create custodial-feeling accounts, which sits
      // badly with a product whose entire claim is that your wallet is the only key to your
      // balance — and whose decryption genuinely depends on that wallet holding the key.
      email: false,
      socials: false,
      // Swaps, on-ramp and history belong to a different product. Sable's job here is to
      // connect a wallet and get out of the way.
      swaps: false,
      onramp: false,
      analytics: false,
    },

    /**
     * Coinbase's SDK is switched off, and this is a privacy decision rather than a
     * preference between wallets.
     *
     * AppKit's Coinbase connector loads `@base-org/account`, which beacons to
     * `cca-lite.coinbase.com` on page load — before anyone has clicked connect, agreed to
     * anything, or even decided to use a wallet. Sable's whole claim is that your financial
     * position is nobody else's business; shipping silent third-party telemetry on the page
     * that says so would make the claim false.
     *
     * The cost is smaller than it looks: the Coinbase Wallet *extension* still appears in
     * the list, because it announces itself over EIP-6963 like every other extension. What
     * is lost is the Coinbase Smart Wallet passkey flow.
     */
    enableCoinbase: false,
    // The Base Account (smart wallet) connector is what actually loads `@base-org/account`,
    // and it is gated separately from `enableCoinbase` — turning off only the latter still
    // leaves the SDK initialising and reporting.
    enableBaseAccount: false,

    // Ships connection diagnostics to Reown. Same reasoning.
    enableAuthLogger: false,

    // Themed to Sable rather than left on the default palette. The brief was explicit that
    // the product must not look like a generic web3 template, and a stock modal in the middle
    // of a deliberately restrained interface is exactly that.
    themeMode: "dark",
    themeVariables: {
      "--w3m-accent": "#FFCE1A",
      "--w3m-color-mix": "#090A08",
      "--w3m-color-mix-strength": 32,
      "--w3m-border-radius-master": "2px",
      "--w3m-font-family":
        "var(--font-sans-face), ui-sans-serif, system-ui, -apple-system, sans-serif",
    },
  });
}

/**
 * Opens the wallet chooser, reporting whether it actually opened.
 *
 * Deliberately imperative rather than the `useAppKit` hook. That hook throws outright if
 * `createAppKit` has not run — which is exactly the state during prerender, and permanently
 * the state when no project id is configured — so calling it unconditionally broke the
 * static build. The modal instance carries the same `open`, with no such precondition.
 *
 * Returning `false` rather than throwing lets the caller fall back to Sable's own picker
 * instead of leaving a button that does nothing.
 */
export function openAppKit(): boolean {
  if (!modal) return false;
  void modal.open({ view: "Connect" });
  return true;
}
