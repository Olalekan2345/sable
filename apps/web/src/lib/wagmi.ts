import { SABLE_CHAIN } from "@sable/config";
import { http, createConfig } from "wagmi";
import { injected, walletConnect } from "wagmi/connectors";

/**
 * Wallet configuration.
 *
 * ## Wallet discovery
 *
 * `multiInjectedProviderDiscovery` (on by default) implements **EIP-6963**: every installed
 * wallet extension announces itself, and wagmi exposes each as its own connector complete
 * with a name and icon. That matters because the legacy `window.ethereum` approach breaks
 * badly when more than one wallet is installed — the extensions fight over the same global,
 * and whichever wins is rarely the one the person wanted.
 *
 * An earlier version of this app connected via `connectors[0]` alone, which meant only the
 * generic injected connector was ever offered and discovered wallets were invisible. The
 * wallet picker now lists all of them.
 *
 * ## WalletConnect
 *
 * Registered only when a project id is configured. Without it there is nothing to connect
 * to, and a dead "WalletConnect" row in the picker would be worse than its absence.
 *
 * With one, phone wallets work by QR — worth having, since Sable is a savings product and
 * savings products get checked on a phone. Get a free id at https://cloud.reown.com.
 */
const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

export function createWagmiConfig() {
  const connectors = [
    // Fallback for wallets that do not announce themselves via EIP-6963. The picker hides
    // this row when discovery finds anything, so it never duplicates a named wallet.
    injected({ shimDisconnect: true }),

    ...(walletConnectProjectId
      ? [
          walletConnect({
            projectId: walletConnectProjectId,
            showQrModal: true,
            metadata: {
              name: "Sable",
              description: "Confidential savings. Save privately. Win fairly.",
              url: typeof window !== "undefined" ? window.location.origin : "https://sable.finance",
              icons: [
                typeof window !== "undefined" ? `${window.location.origin}/icon.svg` : "",
              ].filter(Boolean),
            },
          }),
        ]
      : []),
  ];

  return createConfig({
    chains: [SABLE_CHAIN],
    connectors,
    // Explicit, though it is the default: this is what surfaces installed wallets by name.
    multiInjectedProviderDiscovery: true,
    /*
     * Storage is left to wagmi's default, which is `localStorage`.
     *
     * This used to be `cookieStorage`, which is the right choice only when the server renders
     * the connected state — and that requires passing `cookieToInitialState` into the
     * provider, which was never wired up. Without it the cookie bought nothing and cost
     * something: wallet state has to survive inside a ~4KB cookie, and a connector whose
     * state exceeds that is dropped silently, so the session simply vanishes on the next load.
     */
    ssr: true,
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
  });
}

/** True when WalletConnect is available, so the UI can explain its absence honestly. */
export const hasWalletConnect = Boolean(walletConnectProjectId);

export type SableWagmiConfig = ReturnType<typeof createWagmiConfig>;
