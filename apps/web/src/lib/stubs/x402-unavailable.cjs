/**
 * Stub for the `@x402/*` packages.
 *
 * ## Why this file exists
 *
 * Reown AppKit depends on `@base-org/account`, which depends on `@coinbase/cdp-sdk`, which
 * can sign x402 machine payments. The CDP SDK declares every `@x402/*` package as an
 * **optional** peer dependency (`peerDependenciesMeta.optional: true`) and loads them through
 * a `try`/`catch` dynamic import that, when they are missing, throws a clear "install the
 * x402 peer dependencies" error. Running without them is the SDK's designed default.
 *
 * Turbopack does not care about that design: it resolves the specifiers statically and fails
 * the build on all five, even though the code around them is unreachable here.
 *
 * ## Why a stub rather than installing them
 *
 * Sable is a savings protocol. It never signs an x402 payment — AppKit's Pay feature is
 * switched off in `lib/appkit.ts`. Installing `@x402/core`, `@x402/evm` and `@x402/svm`
 * (which pulls a Solana stack) would put megabytes of unreachable code into a bundle that
 * already ships a TFHE WASM runtime, purely to satisfy a static resolver.
 *
 * ## Why it throws on use rather than on import
 *
 * `@coinbase/cdp-sdk/x402/account-signers` imports `@x402/evm` *statically*, so a module that
 * threw while evaluating could break an unrelated import chain at load time. Every export is
 * therefore a function that throws only if it is actually called — which, in Sable, is never.
 * If that assumption ever stops holding, the failure names itself instead of surfacing as
 * `undefined is not a function`.
 */

const message =
  "@x402/* is not bundled in Sable. AppKit's Pay feature is disabled and this code path " +
  "should be unreachable. If you need x402 payments, install @x402/core, @x402/evm and " +
  "@x402/svm and remove the aliases in next.config.ts.";

const unavailable = () => {
  throw new Error(message);
};

/**
 * A Proxy so that *any* named import resolves, whatever the CDP SDK asks for. The exports of
 * these packages are not enumerated here — that list would rot on the next upgrade.
 */
module.exports = new Proxy(unavailable, {
  get(target, property) {
    if (property === "__esModule") return true;
    if (property === "default") return module.exports;
    if (property === "then") return undefined; // never look thenable to `await import()`
    return unavailable;
  },
});
