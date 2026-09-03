import { cp, mkdir, readFile, rm, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Copies the Zama Relayer SDK's prebuilt bundle into `public/relayer-sdk/`.
 *
 * ## Why this exists
 *
 * The SDK cannot be put through the application bundler. Its TFHE and KMS WebAssembly
 * modules total roughly 5.4 MB, and asking Turbopack to process them takes the production
 * build from **43 seconds to over 20 minutes** — it does not fail, it simply never finishes
 * in any reasonable time. That was measured, not assumed: building the identical app with
 * the SDK removed from the module graph completes in 43s.
 *
 * The SDK ships a prebuilt UMD bundle precisely for this situation. Serving that bundle as a
 * static asset and loading it at runtime keeps the WASM entirely out of the bundler while
 * changing nothing about how the app uses it.
 *
 * Self-hosting rather than loading from a public CDN is deliberate: a confidential savings
 * product should not fetch its cryptography from a third-party origin it does not control,
 * and the files are already on disk as a dependency.
 *
 * TypeScript types come from `import type` against the real package, which the compiler
 * erases — so the integration stays fully typed with zero bundling cost.
 */

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const destination = resolve(here, "..", "public", "relayer-sdk");

/**
 * The UMD bundle, renamed to `.js` on the way out.
 *
 * This rename is load-bearing, not cosmetic. Next serves `.cjs` from `public/` as
 * `application/octet-stream`, and the app sets `X-Content-Type-Options: nosniff` — so a
 * `<script src=".cjs">` is **refused execution** by the browser. The asset returns 200 and
 * the encryption silently never initialises, which is a nasty way to fail.
 */
const BUNDLE_SOURCE = "relayer-sdk-js.umd.cjs";
const BUNDLE_TARGET = "relayer-sdk.js";

/** Files the browser actually needs. The ESM `.js` build is not used. */
const REQUIRED = [BUNDLE_TARGET, "tfhe_bg.wasm", "kms_lib_bg.wasm", "workerHelpers.js"];

async function main() {
  let bundleDir;

  try {
    const packageJson = require.resolve("@zama-fhe/relayer-sdk/package.json");
    bundleDir = join(dirname(packageJson), "bundle");
    await stat(bundleDir);
  } catch {
    console.error(
      "[relayer-sdk] Could not locate @zama-fhe/relayer-sdk. Run `pnpm install` first.",
    );
    process.exit(1);
  }

  await mkdir(destination, { recursive: true });
  await cp(bundleDir, destination, { recursive: true });

  // Serve the UMD bundle under a `.js` name so the browser will execute it (see above).
  await cp(join(destination, BUNDLE_SOURCE), join(destination, BUNDLE_TARGET));
  await rm(join(destination, BUNDLE_SOURCE), { force: true });

  const missing = [];
  for (const file of REQUIRED) {
    try {
      await stat(join(destination, file));
    } catch {
      missing.push(file);
    }
  }

  if (missing.length > 0) {
    console.error(`[relayer-sdk] Bundle is incomplete, missing: ${missing.join(", ")}`);
    process.exit(1);
  }

  // Record the version so a stale copy after a dependency bump is obvious.
  const { version } = JSON.parse(
    await readFile(require.resolve("@zama-fhe/relayer-sdk/package.json"), "utf8"),
  );

  console.log(`[relayer-sdk] Copied bundle v${version} to public/relayer-sdk/`);
}

main().catch((error) => {
  console.error("[relayer-sdk]", error);
  process.exit(1);
});
