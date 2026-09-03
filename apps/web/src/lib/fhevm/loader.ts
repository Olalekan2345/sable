"use client";

import type { FhevmInstance, FhevmInstanceConfig } from "@zama-fhe/relayer-sdk/web";

/**
 * Runtime loader for the Zama Relayer SDK.
 *
 * ## Why the SDK is loaded rather than imported
 *
 * The SDK's TFHE and KMS WebAssembly modules total ~5.4 MB. Putting them through Turbopack
 * takes the production build from 43 seconds to over twenty minutes — measured by building
 * the identical application with the SDK removed from the module graph. It never fails
 * outright, which is worse than failing: it just never finishes.
 *
 * The SDK ships a prebuilt UMD bundle for exactly this case. `scripts/copy-relayer-sdk.mjs`
 * copies it into `public/relayer-sdk/` at build time, and this module injects it on first
 * use. The bundle is self-hosted rather than pulled from a public CDN — a confidential
 * savings product should not fetch its cryptography from an origin it does not control.
 *
 * Types still come from the real package via `import type`, which the compiler erases. The
 * integration is fully typed and costs the bundler nothing.
 */

/** The UMD bundle assigns itself here. */
type RelayerSdkGlobal = {
  initSDK: (options?: { tfheParams?: string; kmsParams?: string }) => Promise<unknown>;
  createInstance: (config: FhevmInstanceConfig) => Promise<FhevmInstance>;
  SepoliaConfig: Omit<FhevmInstanceConfig, "network">;
};

declare global {
  interface Window {
    relayerSDK?: RelayerSdkGlobal;
  }
}

const SCRIPT_ID = "zama-relayer-sdk";
/** Where `scripts/copy-relayer-sdk.mjs` places the bundle and its WASM. */
const SDK_BASE = "/relayer-sdk";
// Served as `.js`, not `.cjs`: Next serves `.cjs` from `public/` as
// `application/octet-stream`, which `X-Content-Type-Options: nosniff` refuses to execute.
const SCRIPT_SRC = `${SDK_BASE}/relayer-sdk.js`;

let loadPromise: Promise<RelayerSdkGlobal> | null = null;

/** Injects the bundle once and resolves when the global is available. */
function injectScript(): Promise<RelayerSdkGlobal> {
  return new Promise((resolve, reject) => {
    if (window.relayerSDK) {
      resolve(window.relayerSDK);
      return;
    }

    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;

    const onLoad = () => {
      if (window.relayerSDK) {
        resolve(window.relayerSDK);
      } else {
        reject(new Error("The relayer SDK loaded but did not register itself."));
      }
    };

    if (existing) {
      existing.addEventListener("load", onLoad, { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error("Failed to load the relayer SDK.")),
        { once: true },
      );
      return;
    }

    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.src = SCRIPT_SRC;
    script.async = true;
    script.addEventListener("load", onLoad, { once: true });
    script.addEventListener(
      "error",
      () =>
        reject(
          new Error(
            "Could not load the encryption library. Check that /relayer-sdk/ is being served — " +
              "run `pnpm --filter @sable/web sdk:copy` if it is missing.",
          ),
        ),
      { once: true },
    );

    document.head.appendChild(script);
  });
}

/**
 * Loads the SDK and initialises its WASM runtime, exactly once.
 *
 * A failure resets the cached promise so a transient problem — offline, a blocked request —
 * can be retried, rather than poisoning every later call with the same rejection.
 */
export function loadRelayerSdk(): Promise<RelayerSdkGlobal> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("The Zama Relayer SDK is browser-only."));
  }

  if (!loadPromise) {
    loadPromise = (async () => {
      const sdk = await injectScript();

      // The WASM paths must be given explicitly. Left to itself the bundle resolves them
      // against the *document* URL, so it fetches `/tfhe_bg.wasm` from whatever route the
      // saver happens to be on — which 404s, and surfaces as an opaque
      // "Failed to execute 'compile' on 'WebAssembly'" rather than a missing-file error.
      await sdk.initSDK({
        tfheParams: `${SDK_BASE}/tfhe_bg.wasm`,
        kmsParams: `${SDK_BASE}/kms_lib_bg.wasm`,
      });

      return sdk;
    })().catch((error) => {
      loadPromise = null;
      throw error;
    });
  }

  return loadPromise;
}

/** True once the SDK is loaded, so the UI can skip its "preparing" copy. */
export function isSdkLoaded(): boolean {
  return typeof window !== "undefined" && Boolean(window.relayerSDK);
}

export type { FhevmInstance, FhevmInstanceConfig };
