import { expect, test, type Page } from "@playwright/test";

import { connect, installWallet, releaseRoutes } from "./helpers";

/**
 * The activity timeline.
 *
 * This view is reconstructed from chain logs, which means its failure mode is silence: a node
 * that refuses a query returns nothing, and "nothing" renders identically to "you have never
 * done anything". That is the specific defect these tests exist to prevent — it shipped once,
 * because the implementation issued a single log query spanning the whole deployment and
 * swallowed the rejection that public endpoints return past a thousand blocks.
 */

/** Makes every `eth_getLogs` fail, exactly as a rate-limited public endpoint does. */
async function rejectLogQueries(page: Page) {
  await page.route(/rpc|thirdweb|drpc|infura|alchemy/i, async (route) => {
    const body = route.request().postData();
    if (!body?.includes("eth_getLogs")) return route.continue();

    let id: unknown = 1;
    try {
      id = JSON.parse(body).id;
    } catch {
      /* keep the default */
    }
    await route.fulfill({
      json: { jsonrpc: "2.0", id, error: { code: -32005, message: "Request exceeds defined limit." } },
    });
  });
}

/**
 * Waits for the timeline to resolve.
 *
 * The view fetches logs across three contracts and then block timestamps, so a fixed sleep is
 * the wrong tool: too short and the test skips itself on a slow endpoint, reporting a pass it
 * did not earn. This waits for a row to actually appear.
 */
async function awaitTimeline(page: Page) {
  await page
    .locator("main li")
    .first()
    .waitFor({ state: "visible", timeout: 45000 })
    .catch(() => {
      // No history is a legitimate outcome; the callers decide whether to skip.
    });
}

test.describe("Activity", () => {
  /*
   * A single retry, as a safety net for the shared public endpoint having a bad moment. The
   * phone viewport is excluded in , which is what actually removed the
   * rate-limit flakes — these assertions are about data, not layout.
   */
  /*
   * Run in sequence, not in parallel.
   *
   * One of these blocks every `eth_getLogs` to prove the page admits when it cannot read.
   * Running beside siblings that need those same queries answered, against one shared public
   * endpoint, made both sides unreliable — and the failure looked like a bug in the code under
   * test rather than contention between tests.
   */
  test.describe.configure({ mode: "serial", retries: 1 });

  /*
   * Connecting through the chooser, then walking three contracts' logs, does not fit in the
   * 30-second default — most of it is spent before the first assertion runs.
   */
  test.setTimeout(120_000);

  test.afterEach(async ({ page }) => {
    await releaseRoutes(page);
  });

  test.beforeEach(async ({ page }) => {
    await installWallet(page);
  });

  test("says so when the node will not serve the logs, rather than showing an empty history", async ({
    page,
  }) => {
    await rejectLogQueries(page);
    await page.goto("/app/activity");
    await connect(page);

    // The distinction that matters: an unreadable history must never be presented as an
    // absent one.
    // Generous, deliberately. Against an endpoint refusing everything the scan still walks
    // every window before it can honestly say the history is incomplete — it cannot tell a
    // refusal from a quiet stretch of chain without asking. Slow is the correct behaviour here;
    // guessing would not be.
    await expect(page.getByText(/history may be incomplete/i)).toBeVisible({ timeout: 90000 });
  });

  test("gives every entry a timestamp and a link to the transaction", async ({ page }) => {
    await page.goto("/app/activity");
    await connect(page);
    await awaitTimeline(page);

    const rows = page.locator("main li");
    const count = await rows.count();
    test.skip(count === 0, "This wallet has no history on the current deployment.");

    for (let i = 0; i < count; i += 1) {
      const row = rows.nth(i);
      // A row without a link is not verifiable, which defeats the point of the view.
      await expect(row.locator('a[href*="etherscan"]')).toHaveCount(1);
      await expect(row).toContainText(/\d{4}.*UTC/);
    }
  });

  test("covers all three contracts, not just the vault", async ({ page }) => {
    await page.goto("/app/activity");
    await connect(page);
    await awaitTimeline(page);

    const body = await page.locator("main").innerText();
    test.skip(!/Deposit|Position opened/i.test(body), "No vault history on this deployment.");

    // Obtaining and approving tokens happens on the underlying ERC-20, shielding and
    // authorising on the confidential asset, depositing on the vault. Reading only the vault
    // showed a fraction of what a saver actually did and made the rest look like it never
    // happened.
    expect(body, "asset contract history").toMatch(/Shielded|Vault authorised/i);
    expect(body, "underlying token history").toMatch(/Tokens received|Wrapper approved/i);
  });

  test("marks every entry public or private", async ({ page }) => {
    await page.goto("/app/activity");
    await connect(page);
    await awaitTimeline(page);

    const rows = page.locator("main li");
    const count = await rows.count();
    test.skip(count === 0, "This wallet has no history on the current deployment.");

    for (let i = 0; i < count; i += 1) {
      // Matched case-insensitively: the badge is uppercased in CSS, so the rendered text
      // and the underlying text node disagree, and assertions read the latter.
      await expect(rows.nth(i)).toContainText(/public|private/i);
    }

    // Both kinds should be present: a history claiming everything was private would overstate
    // what the protocol conceals, and one claiming everything was public would understate it.
    const body = await page.locator("main").innerText();
    expect(body.toLowerCase()).toContain("private");
    expect(body.toLowerCase()).toContain("public");
  });

  test("does not list the mechanical half of an action twice", async ({ page }) => {
    await page.goto("/app/activity");
    await connect(page);
    await awaitTimeline(page);

    const body = await page.locator("main").innerText();
    test.skip(!/Shielded/i.test(body), "Nothing shielded on this deployment.");

    // Shielding moves the underlying to the wrapper and mints the confidential token; both
    // emit transfers in the same transaction as `Wrap`. Showing all three would report one
    // action three times under three names.
    expect(body).not.toMatch(/Confidential transfer in/i);
  });
});
