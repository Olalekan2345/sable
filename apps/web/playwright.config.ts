import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright configuration.
 *
 * The suite covers the surfaces that work **without a wallet**: the landing page, the public
 * draw ledger, and the explanatory pages. Those are exactly the surfaces a first-time visitor
 * sees, and they are also the ones where a regression would be least likely to be noticed
 * during manual testing of the connected flows.
 *
 * Connected flows are covered too, but only where mocking does not hollow out the test: an
 * announced provider is enough to exercise routing, network switching and the reconstruction
 * of history from logs, all of which read the *live* deployment. What is deliberately not
 * simulated is encryption, the relayer round trip and the wallet signature — mocking those
 * would test the mock. They are verified against a live deployment using the checklist in
 * `docs/DEPLOYMENT.md`.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000",
    trace: "on-first-retry",
  },

  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile",
      use: { ...devices["Pixel 7"] },
      /*
       * The activity suite is skipped on the phone viewport.
       *
       * It is by far the most network-heavy set of tests — three contracts' logs plus a block
       * timestamp for every row — and every assertion in it is about data, not layout. Running
       * it a second time doubles the load on a shared public endpoint and buys no coverage;
       * it only produced rate-limit flakes that retries then hid.
       */
      testIgnore: ["**/activity.spec.ts"],
    },
  ],

  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: "pnpm build && pnpm start",
        url: "http://127.0.0.1:3000",
        reuseExistingServer: !process.env.CI,
        timeout: 300_000,
      },
});
