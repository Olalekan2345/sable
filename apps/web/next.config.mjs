import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "dotenv";

/**
 * Load the monorepo-root `.env` into this build.
 *
 * Next reads `.env` files from the *application* directory, but this repo keeps a single
 * `.env` at the workspace root so the contracts, the indexer and the web app are configured
 * in one place. Without this, every `NEXT_PUBLIC_*` value there — the deployed Sable address,
 * the RPC endpoint, the WalletConnect project id — was silently missing from the bundle, and
 * the app fell back to public defaults with no error to explain why.
 *
 * Two deliberate constraints:
 *
 * 1. **Only `NEXT_PUBLIC_*` keys are copied.** The same file holds `DEPLOYER_PRIVATE_KEY`.
 *    Next would not inline a non-prefixed variable into client code, but a build process that
 *    never loads a private key at all cannot leak one, and that is the better guarantee.
 * 2. **Existing values win.** A real environment variable, or an `apps/web/.env.local`, still
 *    overrides the shared file, so a deployment can point at different contracts without
 *    editing the repo.
 */
const rootEnvPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../.env");
if (existsSync(rootEnvPath)) {
  for (const [key, value] of Object.entries(parse(readFileSync(rootEnvPath)))) {
    if (key.startsWith("NEXT_PUBLIC_") && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Next 16 writes AGENTS.md / CLAUDE.md into the app directory by default. Harmless, but
  // this repo is a submission artefact and they are unrelated clutter.
  agentRules: false,

  // `@sable/config` ships TypeScript source rather than a build step.
  transpilePackages: ["@sable/config"],

  /**
   * Next 16 builds with Turbopack by default, which supports async WebAssembly natively —
   * so the Zama Relayer SDK's TFHE and KMS modules need no bundler configuration. An empty
   * object is enough to declare Turbopack as the intended bundler; adding a `webpack` key
   * here would put the build back on the legacy path.
   */
  turbopack: {
    /**
     * `@x402/*` are optional peer dependencies of `@coinbase/cdp-sdk`, which arrives
     * transitively under Reown AppKit. They are unreachable in Sable — AppKit's Pay feature
     * is disabled — but Turbopack resolves the specifiers statically and fails the build on
     * them. See `src/lib/stubs/x402-unavailable.cjs` for the full reasoning.
     */
    resolveAlias: {
      "@x402/core": "./src/lib/stubs/x402-unavailable.cjs",
      "@x402/core/client": "./src/lib/stubs/x402-unavailable.cjs",
      "@x402/evm": "./src/lib/stubs/x402-unavailable.cjs",
      "@x402/evm/exact/client": "./src/lib/stubs/x402-unavailable.cjs",
      "@x402/evm/upto/client": "./src/lib/stubs/x402-unavailable.cjs",
      "@x402/svm": "./src/lib/stubs/x402-unavailable.cjs",
      "@x402/svm/exact/client": "./src/lib/stubs/x402-unavailable.cjs",
      "@x402/extensions": "./src/lib/stubs/x402-unavailable.cjs",
      "@x402/extensions/builder-code": "./src/lib/stubs/x402-unavailable.cjs",

      /**
       * The Coinbase / Base Account SDKs beacon to `cca-lite.coinbase.com` when their
       * modules evaluate, before a visitor has connected or consented to anything. AppKit's
       * `enableCoinbase` / `enableBaseAccount` flags stop the connectors being registered
       * but were measured not to stop the reporting, so the modules are removed from the
       * graph instead. Full reasoning in `src/lib/stubs/coinbase-sdk-excluded.cjs`.
       */
      "@base-org/account": "./src/lib/stubs/coinbase-sdk-excluded.cjs",
      "@coinbase/wallet-sdk": "./src/lib/stubs/coinbase-sdk-excluded.cjs",
    },
  },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          /**
           * Cross-origin isolation is deliberately **not** enabled here.
           *
           * `Cross-Origin-Embedder-Policy: require-corp` would let the Zama SDK use
           * `SharedArrayBuffer` and run TFHE multi-threaded, which measurably speeds up
           * encryption. It also blocks every subresource that does not carry a CORP header
           * and is a well-known cause of browser wallet extensions failing to inject or
           * communicate — which was observed here: with COEP enabled, resources 403'd and
           * the wallet could not connect at all.
           *
           * A slower deposit is a cost. An app nobody can connect a wallet to is not a
           * product. The SDK falls back to a single-threaded path and works correctly, so
           * correctness wins.
           */
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;
