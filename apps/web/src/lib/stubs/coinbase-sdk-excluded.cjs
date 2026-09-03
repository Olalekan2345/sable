/**
 * Stub for the Coinbase / Base Account wallet SDKs.
 *
 * ## What this removes and why
 *
 * Reown AppKit bundles `@base-org/account` and `@coinbase/wallet-sdk` to offer the Coinbase
 * Smart Wallet. Both initialise analytics when their module is evaluated — not when a wallet
 * is chosen — and POST to `cca-lite.coinbase.com/amp` and `/metrics` on page load, carrying
 * device-fingerprinting signals (`is_low_end_device`, `save_data`, `service_worker`) about
 * every visitor who has connected nothing and consented to nothing.
 *
 * That is untenable in this particular app. Sable's privacy page states plainly what does and
 * does not leak, and its test suite asserts those statements stay honest. Silently reporting
 * visitors to a third party while making that claim would make the claim false.
 *
 * Setting `enableCoinbase: false` and `enableBaseAccount: false` in `lib/appkit.ts` stops the
 * connectors from being *registered*, and was verified not to stop the beacons: the reporting
 * happens at import time, below the level those flags control. Removing the modules from the
 * graph is what actually works — measured before and after.
 *
 * ## What is not lost
 *
 * The Coinbase Wallet browser extension still appears in the wallet list, because it
 * announces itself over EIP-6963 like every other extension and needs none of this code. What
 * goes is the Coinbase Smart Wallet passkey flow, which was already switched off above.
 *
 * ## Reversing it
 *
 * Delete the aliases in `next.config.mjs` and set both flags back to true. Every export here
 * throws with that instruction rather than returning `undefined`, so a future re-enable fails
 * loudly and legibly instead of misbehaving somewhere further downstream.
 */

const message =
  "The Coinbase / Base Account SDK is deliberately excluded from Sable's bundle because it " +
  "reports visitors to cca-lite.coinbase.com on page load. See " +
  "src/lib/stubs/coinbase-sdk-excluded.cjs. To re-enable it, remove the aliases in " +
  "next.config.mjs and set enableCoinbase/enableBaseAccount to true in src/lib/appkit.ts.";

const unavailable = () => {
  throw new Error(message);
};

module.exports = new Proxy(unavailable, {
  get(target, property) {
    if (property === "__esModule") return true;
    if (property === "default") return module.exports;
    if (property === "then") return undefined; // never look thenable to `await import()`
    return unavailable;
  },
});
