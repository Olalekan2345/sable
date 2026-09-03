import { expect } from "chai";

import {
  configureRound,
  deploySable,
  deposit,
  fund,
  isUninitialized,
  setMode,
  settleRound,
  time,
  usd,
  weightOf,
  withdraw,
  type Deployment,
} from "./helpers";

/**
 * Weight accrues as `balance * whole_minutes`, gated by the encrypted mode:
 *
 *     roundWeight += FHE.select(isLucky, balance * elapsedUnits, 0)
 *
 * These tests pin the arithmetic to exact values rather than asserting inequalities, so a
 * regression in the checkpoint ordering shows up as a wrong number rather than as a
 * still-passing "greater than zero".
 */
describe("Time-weighted eligibility", function () {
  let d: Deployment;
  let roundId: number;
  let openedAt: number;
  let closesAt: number;

  const DURATION = 3600; // one hour
  const AMOUNT = usd(1_000);

  beforeEach(async function () {
    // Yield is disabled here so balances stay constant and weight is exactly predictable.
    d = await deploySable({ ratePerYearBps: 0 });
    await fund(d, d.alice, usd(50_000));
    await fund(d, d.bob, usd(50_000));
    await fund(d, d.carol, usd(50_000));

    roundId = await configureRound(d, { durationSeconds: DURATION });
    await (await d.sable.connect(d.admin).openRound(roundId)).wait();

    const state = await d.sable.roundState(roundId);
    openedAt = Number(state.openedAt);
    closesAt = openedAt + DURATION;
  });

  /** Closes the round at exactly `closesAt` and runs the final checkpoints. */
  async function closeAndScore(): Promise<void> {
    await time.setNextBlockTimestamp(closesAt);
    await (await d.sable.connect(d.admin).closeRound(roundId)).wait();

    const total = Number((await d.sable.roundState(roundId)).participantCount);
    await (await d.sable.connect(d.admin).processEligibilityBatch(roundId, total)).wait();
  }

  /** Performs `action` at exactly `timestamp`. */
  async function at(timestamp: number, action: () => Promise<void>): Promise<void> {
    await time.setNextBlockTimestamp(timestamp);
    await action();
  }

  const minutesBetween = (from: number, to: number) => BigInt(Math.floor((to - from) / 60));

  it("credits a full round of weight to a saver present from the start", async function () {
    const depositAt = openedAt + 60;

    await at(depositAt, () => setMode(d, d.alice, true));
    await at(depositAt + 60, () => deposit(d, d.alice, AMOUNT));

    await closeAndScore();

    // Weight only starts accruing once the balance exists.
    const expected = AMOUNT * minutesBetween(depositAt + 60, closesAt);
    expect(await weightOf(d, roundId, d.alice)).to.equal(expected);
  });

  it("gives a late depositor proportionally less weight than an early one", async function () {
    // This is the anti-sniping property: identical capital, different holding time.
    const early = openedAt + 60;
    const late = closesAt - 600; // ten minutes before the close

    await at(early, () => setMode(d, d.alice, true));
    await at(early + 30, () => deposit(d, d.alice, AMOUNT));

    await at(late - 30, () => setMode(d, d.bob, true));
    await at(late, () => deposit(d, d.bob, AMOUNT));

    await closeAndScore();

    const aliceWeight = await weightOf(d, roundId, d.alice);
    const bobWeight = await weightOf(d, roundId, d.bob);

    expect(aliceWeight).to.equal(AMOUNT * minutesBetween(early + 30, closesAt));
    expect(bobWeight).to.equal(AMOUNT * minutesBetween(late, closesAt));

    // Roughly an hour of holding versus ten minutes.
    expect(aliceWeight).to.be.greaterThan(bobWeight * 5n);
  });

  it("gives a saver who deposits at the very last moment effectively nothing", async function () {
    await at(closesAt - 20, () => setMode(d, d.alice, true));
    await at(closesAt - 10, () => deposit(d, d.alice, usd(500_000)));

    await closeAndScore();

    // Under a minute of eligible holding time floors to zero whole units, so an enormous
    // last-second deposit buys no eligibility at all. The contract skips the FHE work
    // rather than storing an encrypted zero, leaving the handle uninitialised.
    const handle = await d.sable.confidentialWeightOf(roundId, d.alice.address);
    expect(isUninitialized(handle)).to.equal(true);
    expect(await weightOf(d, roundId, d.alice)).to.equal(0n);
  });

  it("gives a Steady saver no weight at all", async function () {
    // Steady is now opted *into*, so it has to be selected before the deposit for the saver
    // to spend the whole round outside the draw.
    await at(openedAt + 30, () => setMode(d, d.alice, false));
    await at(openedAt + 60, () => deposit(d, d.alice, AMOUNT));

    await closeAndScore();

    expect(await weightOf(d, roundId, d.alice)).to.equal(0n);
  });

  it("does not back-date Steady time when switching to Lucky", async function () {
    // Switching mode must not retroactively convert time already spent in Steady into
    // eligibility. `setMode` checkpoints before it flips the bit, which is what enforces it.
    const steadyAt = openedAt + 30;
    const depositAt = openedAt + 60;
    const switchAt = openedAt + 1800; // halfway

    await at(steadyAt, () => setMode(d, d.alice, false));
    await at(depositAt, () => deposit(d, d.alice, AMOUNT));
    await at(switchAt, () => setMode(d, d.alice, true));

    await closeAndScore();

    const expected = AMOUNT * minutesBetween(switchAt, closesAt);
    expect(await weightOf(d, roundId, d.alice)).to.equal(expected);
  });

  it("keeps weight already earned when switching from Lucky to Steady", async function () {
    const depositAt = openedAt + 60;
    const switchAt = openedAt + 1800;

    await at(depositAt - 30, () => setMode(d, d.alice, true));
    await at(depositAt, () => deposit(d, d.alice, AMOUNT));
    await at(switchAt, () => setMode(d, d.alice, false));

    await closeAndScore();

    // Earned up to the switch, nothing after it.
    const expected = AMOUNT * minutesBetween(depositAt, switchAt);
    expect(await weightOf(d, roundId, d.alice)).to.equal(expected);
  });

  it("reduces subsequent weight after a withdrawal", async function () {
    const depositAt = openedAt + 60;
    const withdrawAt = openedAt + 1800;

    await at(depositAt - 30, () => setMode(d, d.alice, true));
    await at(depositAt, () => deposit(d, d.alice, AMOUNT));
    await at(withdrawAt, () => withdraw(d, d.alice, usd(750)));

    await closeAndScore();

    const firstLeg = AMOUNT * minutesBetween(depositAt, withdrawAt);
    const secondLeg = usd(250) * minutesBetween(withdrawAt, closesAt);

    expect(await weightOf(d, roundId, d.alice)).to.equal(firstLeg + secondLeg);
  });

  it("weights a top-up only for the time it was actually present", async function () {
    const depositAt = openedAt + 60;
    const topUpAt = openedAt + 1800;

    await at(depositAt - 30, () => setMode(d, d.alice, true));
    await at(depositAt, () => deposit(d, d.alice, AMOUNT));
    await at(topUpAt, () => deposit(d, d.alice, AMOUNT));

    await closeAndScore();

    const firstLeg = AMOUNT * minutesBetween(depositAt, topUpAt);
    const secondLeg = usd(2_000) * minutesBetween(topUpAt, closesAt);

    expect(await weightOf(d, roundId, d.alice)).to.equal(firstLeg + secondLeg);
  });

  it("accrues no further weight once the round has closed", async function () {
    const depositAt = openedAt + 60;

    await at(depositAt - 30, () => setMode(d, d.alice, true));
    await at(depositAt, () => deposit(d, d.alice, AMOUNT));

    await closeAndScore();
    const scored = await weightOf(d, roundId, d.alice);

    // A deposit landing after the close must not disturb a frozen round.
    await time.increase(600);
    await deposit(d, d.alice, AMOUNT);

    expect(await weightOf(d, roundId, d.alice)).to.equal(scored);
  });

  it("is idempotent when a saver checkpoints during the closing phase", async function () {
    // A saver may transact between `closeRound` and their eligibility batch. Their
    // checkpoint accrues up to the close time; the batch must then add nothing further.
    const depositAt = openedAt + 60;

    await at(depositAt - 30, () => setMode(d, d.alice, true));
    await at(depositAt, () => deposit(d, d.alice, AMOUNT));

    await time.setNextBlockTimestamp(closesAt);
    await (await d.sable.connect(d.admin).closeRound(roundId)).wait();

    // Alice acts while the round is CLOSING, before her batch runs.
    await deposit(d, d.alice, usd(10));

    const total = Number((await d.sable.roundState(roundId)).participantCount);
    await (await d.sable.connect(d.admin).processEligibilityBatch(roundId, total)).wait();

    const expected = AMOUNT * minutesBetween(depositAt, closesAt);
    expect(await weightOf(d, roundId, d.alice)).to.equal(expected);
  });

  it("starts each round's weight from zero", async function () {
    await at(openedAt + 60, () => setMode(d, d.alice, true));
    await at(openedAt + 120, () => deposit(d, d.alice, AMOUNT));

    await closeAndScore();
    const firstWeight = await weightOf(d, roundId, d.alice);
    expect(firstWeight).to.be.greaterThan(0n);

    await settleRound(d, roundId);

    // Second round: same balance, no new action from Alice at all.
    const secondRound = await configureRound(d, { durationSeconds: DURATION });
    await (await d.sable.connect(d.admin).openRound(secondRound)).wait();

    const secondState = await d.sable.roundState(secondRound);
    const secondOpenedAt = Number(secondState.openedAt);
    const secondClosesAt = secondOpenedAt + DURATION;

    await time.setNextBlockTimestamp(secondClosesAt);
    await (await d.sable.connect(d.admin).closeRound(secondRound)).wait();
    const total = Number((await d.sable.roundState(secondRound)).participantCount);
    await (await d.sable.connect(d.admin).processEligibilityBatch(secondRound, total)).wait();

    // A dormant saver still earns a full round of weight — no re-entry action needed —
    // and the previous round's total is not carried forward.
    const secondWeight = await weightOf(d, secondRound, d.alice);
    expect(secondWeight).to.equal(AMOUNT * minutesBetween(secondOpenedAt, secondClosesAt));
    expect(await weightOf(d, roundId, d.alice)).to.equal(firstWeight);
  });
});
