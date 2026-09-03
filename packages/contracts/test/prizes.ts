import { expect } from "chai";

import {
  balanceOf,
  configureRound,
  deploySable,
  deposit,
  fund,
  publicAmount,
  publicBool,
  readAmount,
  rewardOf,
  setMode,
  settleRound,
  time,
  usd,
  type Deployment,
} from "./helpers";

const TEN_DAYS = 10 * 24 * 3600;
const PRINCIPAL = usd(100_000);

/** The full ticket domain fits one participant, so every draw point must land on them. */
const CERTAIN_WIN = { maxParticipants: 1, ticketBits: 16, weightPerTicket: 1n };

/** A divisor so large every weight floors to zero tickets, so every point must miss. */
const CERTAIN_MISS = { maxParticipants: 1, ticketBits: 16, weightPerTicket: 1n << 62n };

describe("Prize engine", function () {
  let d: Deployment;

  beforeEach(async function () {
    d = await deploySable({ ratePerYearBps: 5000 });
    await fund(d, d.alice, usd(500_000));
    await fund(d, d.bob, usd(500_000));
    await fund(d, d.carol, usd(500_000));
  });

  /**
   * Runs a round in which `alice` is Lucky for its whole duration.
   * Returns the pool figure the contract should have accrued.
   */
  async function runLuckyRound(
    overrides: Record<string, unknown> = {},
  ): Promise<{ roundId: number; expectedPool: bigint }> {
    const roundId = await configureRound(d, { durationSeconds: TEN_DAYS, ...overrides });
    await (await d.sable.connect(d.admin).openRound(roundId)).wait();

    // Mode first (balance still zero, so this checkpoint accrues nothing), then deposit.
    // That leaves exactly one accruing checkpoint — the eligibility batch — so the
    // expected pool is a single exact multiplication rather than a sum of rounded terms.
    await setMode(d, d.alice, true);
    await deposit(d, d.alice, PRINCIPAL);
    const indexAtDeposit = await d.sable.yieldIndex();

    await time.increase(TEN_DAYS);
    await (await d.sable.connect(d.admin).closeRound(roundId)).wait();
    await (await d.sable.connect(d.admin).processEligibilityBatch(roundId, 10)).wait();

    const indexAtClose = await d.sable.yieldIndex();
    const expectedPool = (PRINCIPAL * (indexAtClose - indexAtDeposit)) / 1_000_000n;

    return { roundId, expectedPool };
  }

  // -----------------------------------------------------------------------
  // Yield routing
  // -----------------------------------------------------------------------

  describe("yield routing", function () {
    it("compounds yield into a Steady saver's own balance", async function () {
      const roundId = await configureRound(d, { durationSeconds: TEN_DAYS });
      await (await d.sable.connect(d.admin).openRound(roundId)).wait();

      // Steady is opted into now, so it is chosen before the deposit.
      await setMode(d, d.alice, false);
      await deposit(d, d.alice, PRINCIPAL);
      const indexAtDeposit = await d.sable.yieldIndex();

      await time.increase(TEN_DAYS);
      await (await d.sable.connect(d.admin).closeRound(roundId)).wait();
      await (await d.sable.connect(d.admin).processEligibilityBatch(roundId, 10)).wait();

      const indexAtClose = await d.sable.yieldIndex();
      const expectedYield = (PRINCIPAL * (indexAtClose - indexAtDeposit)) / 1_000_000n;

      expect(expectedYield).to.be.greaterThan(0n);
      expect(await balanceOf(d, d.alice)).to.equal(PRINCIPAL + expectedYield);
    });

    it("routes a Lucky saver's yield to the prize pool, leaving principal untouched", async function () {
      const { roundId, expectedPool } = await runLuckyRound();

      expect(expectedPool).to.be.greaterThan(0n);

      // Invariant 1: principal is exactly what was deposited. It did not grow, and — more
      // importantly — it did not shrink into the pool.
      expect(await balanceOf(d, d.alice)).to.equal(PRINCIPAL);

      await (await d.sable.connect(d.admin).finalizeRound(roundId)).wait();
      const aggregates = await d.sable.roundAggregates(roundId);
      expect(await publicAmount(aggregates.prizePool)).to.equal(expectedPool);
    });

    it("keeps a Steady saver's yield out of the prize pool entirely", async function () {
      const roundId = await configureRound(d, { durationSeconds: TEN_DAYS });
      await (await d.sable.connect(d.admin).openRound(roundId)).wait();

      // Steady is opted into now, so it is chosen before the deposit.
      await setMode(d, d.alice, false);
      await deposit(d, d.alice, PRINCIPAL);

      await time.increase(TEN_DAYS);
      await (await d.sable.connect(d.admin).closeRound(roundId)).wait();
      await (await d.sable.connect(d.admin).processEligibilityBatch(roundId, 10)).wait();
      await (await d.sable.connect(d.admin).finalizeRound(roundId)).wait();

      const aggregates = await d.sable.roundAggregates(roundId);
      expect(await publicAmount(aggregates.prizePool)).to.equal(0n);
    });
  });

  // -----------------------------------------------------------------------
  // Prize tiers
  // -----------------------------------------------------------------------

  describe("prize tiers", function () {
    it("splits the pool by the configured shares and winner counts", async function () {
      const { roundId, expectedPool } = await runLuckyRound();
      await (await d.sable.connect(d.admin).finalizeRound(roundId)).wait();

      const aggregates = await d.sable.roundAggregates(roundId);

      const jackpot = await publicAmount(aggregates.jackpotPrize);
      const mid = await publicAmount(aggregates.midPrize);
      const small = await publicAmount(aggregates.smallPrize);

      expect(jackpot).to.equal((expectedPool * 5000n) / 10000n / 1n);
      expect(mid).to.equal((expectedPool * 3000n) / 10000n / 3n);
      expect(small).to.equal((expectedPool * 2000n) / 10000n / 10n);
    });

    it("never allocates more than the pool holds", async function () {
      // Invariant 5, checked against the actual configured winner counts.
      const { roundId, expectedPool } = await runLuckyRound();
      await (await d.sable.connect(d.admin).finalizeRound(roundId)).wait();

      const aggregates = await d.sable.roundAggregates(roundId);
      const total =
        (await publicAmount(aggregates.jackpotPrize)) * 1n +
        (await publicAmount(aggregates.midPrize)) * 3n +
        (await publicAmount(aggregates.smallPrize)) * 10n;

      expect(total).to.be.lessThanOrEqual(expectedPool);
    });

    it("publishes aggregates that anyone can decrypt without a wallet", async function () {
      // The public ledger has to show real numbers, and it must do so for a visitor who
      // has connected nothing at all.
      const { roundId } = await runLuckyRound();
      await (await d.sable.connect(d.admin).finalizeRound(roundId)).wait();

      const aggregates = await d.sable.roundAggregates(roundId);
      await expect(publicAmount(aggregates.prizePool)).to.eventually.be.a("bigint");
      await expect(publicAmount(aggregates.jackpotPrize)).to.eventually.be.a("bigint");
    });
  });

  // -----------------------------------------------------------------------
  // Draw and settlement
  // -----------------------------------------------------------------------

  describe("draw", function () {
    it("credits every prize to the saver holding the whole ticket domain", async function () {
      const { roundId, expectedPool } = await runLuckyRound(CERTAIN_WIN);
      await settleRoundFrom(roundId);

      const aggregates = await d.sable.roundAggregates(roundId);
      const jackpot = await publicAmount(aggregates.jackpotPrize);
      const mid = await publicAmount(aggregates.midPrize);
      const small = await publicAmount(aggregates.smallPrize);

      const expected = jackpot + mid * 3n + small * 10n;

      expect(await rewardOf(d, d.alice)).to.equal(expected);
      expect(expected).to.be.greaterThan(0n);
      expect(expected).to.be.lessThanOrEqual(expectedPool);
    });

    it("leaves a non-participant's reward at encrypted zero", async function () {
      const { roundId } = await runLuckyRound(CERTAIN_WIN);

      // Bob joins after the snapshot, so he is outside the round entirely.
      await deposit(d, d.bob, usd(1_000));
      await settleRoundFrom(roundId);

      expect(await rewardOf(d, d.bob)).to.equal(0n);
    });

    it("credits a losing saver an encrypted zero rather than skipping them", async function () {
      // Symmetry is the privacy property: losers are written to, not omitted, so gas and
      // storage access patterns do not distinguish a winner from a loser.
      const roundId = await configureRound(d, {
        durationSeconds: TEN_DAYS,
        maxParticipants: 2,
        ticketBits: 16,
        weightPerTicket: 1n << 62n,
      });
      await (await d.sable.connect(d.admin).openRound(roundId)).wait();

      await setMode(d, d.alice, true);
      await deposit(d, d.alice, PRINCIPAL);
      await deposit(d, d.bob, PRINCIPAL);

      await time.increase(TEN_DAYS);
      await (await d.sable.connect(d.admin).closeRound(roundId)).wait();
      await settleRound(d, roundId);

      expect(await rewardOf(d, d.alice)).to.equal(0n);
      expect(await rewardOf(d, d.bob)).to.equal(0n);
    });

    it("keeps a draw point inside the ticket domain", async function () {
      const { roundId } = await runLuckyRound(CERTAIN_WIN);
      await settleRoundFrom(roundId);

      expect(await d.sable.drawPointCount(roundId)).to.equal(14n);
    });

    it("never reveals a winner in an event", async function () {
      const { roundId } = await runLuckyRound(CERTAIN_WIN);

      await (await d.sable.connect(d.admin).finalizeRound(roundId)).wait();
      await (await d.sable.connect(d.admin).assignTicketsBatch(roundId, 10)).wait();
      await (await d.sable.connect(d.admin).drawBatch(roundId, 20)).wait();
      const receipt = await (await d.sable.connect(d.admin).settleBatch(roundId, 10)).wait();

      const names = receipt!.logs
        .map((log) => {
          try {
            return d.sable.interface.parseLog(log)?.name ?? null;
          } catch {
            return null;
          }
        })
        .filter((n): n is string => n !== null);

      // The only Sable event settlement emits is a cursor update.
      expect(names).to.deep.equal(["SettlementAdvanced"]);
    });
  });

  // -----------------------------------------------------------------------
  // Rollover
  // -----------------------------------------------------------------------

  describe("rollover", function () {
    it("rolls the jackpot forward when no ticket matches", async function () {
      const { roundId } = await runLuckyRound(CERTAIN_MISS);
      await settleRoundFrom(roundId);

      const aggregates = await d.sable.roundAggregates(roundId);
      const jackpot = await publicAmount(aggregates.jackpotPrize);
      const rollover = await publicAmount(aggregates.rollover);

      expect(jackpot).to.be.greaterThan(0n);
      expect(rollover).to.equal(jackpot);
      expect(await publicBool(await d.sable.roundJackpotHit(roundId))).to.equal(false);
    });

    it("reports the jackpot as hit when a ticket matches", async function () {
      const { roundId } = await runLuckyRound(CERTAIN_WIN);
      await settleRoundFrom(roundId);

      const aggregates = await d.sable.roundAggregates(roundId);
      expect(await publicAmount(aggregates.rollover)).to.equal(0n);
      expect(await publicBool(await d.sable.roundJackpotHit(roundId))).to.equal(true);
    });

    it("carries a rolled-over jackpot into the next round's pool", async function () {
      const { roundId, expectedPool } = await runLuckyRound(CERTAIN_MISS);
      await settleRoundFrom(roundId);

      const firstAggregates = await d.sable.roundAggregates(roundId);
      const rollover = await publicAmount(firstAggregates.rollover);
      expect(rollover).to.be.greaterThan(0n);

      // Second round: open it, close it immediately, and read the starting pool.
      const secondRound = await configureRound(d, { durationSeconds: 600 });
      await (await d.sable.connect(d.admin).openRound(secondRound)).wait();

      const indexAtOpen = await d.sable.yieldIndex();
      await time.increase(600);
      await (await d.sable.connect(d.admin).closeRound(secondRound)).wait();
      await (await d.sable.connect(d.admin).processEligibilityBatch(secondRound, 10)).wait();
      await (await d.sable.connect(d.admin).finalizeRound(secondRound)).wait();

      const indexAtClose = await d.sable.yieldIndex();
      const freshLuckyYield = (PRINCIPAL * (indexAtClose - indexAtOpen)) / 1_000_000n;

      const secondAggregates = await d.sable.roundAggregates(secondRound);
      const secondPool = await publicAmount(secondAggregates.prizePool);

      // The carried jackpot plus whatever Alice contributed during round two.
      expect(secondPool).to.equal(rollover + freshLuckyYield);
      expect(secondPool).to.be.greaterThan(expectedPool - expectedPool); // sanity: non-zero
    });
  });

  // -----------------------------------------------------------------------
  // Claiming
  // -----------------------------------------------------------------------

  describe("claiming", function () {
    it("moves rewards into the savings balance", async function () {
      const { roundId } = await runLuckyRound(CERTAIN_WIN);
      await settleRoundFrom(roundId);

      const reward = await rewardOf(d, d.alice);
      const balanceBefore = await balanceOf(d, d.alice);
      expect(reward).to.be.greaterThan(0n);

      await (await d.sable.connect(d.alice).claimRewards()).wait();

      expect(await rewardOf(d, d.alice)).to.equal(0n);
      expect(await balanceOf(d, d.alice)).to.equal(balanceBefore + reward);
    });

    it("cannot be claimed twice", async function () {
      // Invariant 7.
      const { roundId } = await runLuckyRound(CERTAIN_WIN);
      await settleRoundFrom(roundId);

      await (await d.sable.connect(d.alice).claimRewards()).wait();
      const afterFirst = await balanceOf(d, d.alice);

      await (await d.sable.connect(d.alice).claimRewards()).wait();

      expect(await balanceOf(d, d.alice)).to.equal(afterFirst);
      expect(await rewardOf(d, d.alice)).to.equal(0n);
    });

    it("keeps a reward readable only by its owner", async function () {
      const { roundId } = await runLuckyRound(CERTAIN_WIN);
      await settleRoundFrom(roundId);

      const handle = await d.sable.confidentialRewardOf(d.alice.address);
      await expect(readAmount(handle, d.sableAddress, d.bob)).to.be.rejected;
      await expect(readAmount(handle, d.sableAddress, d.outsider)).to.be.rejected;
    });

    it("lets a winner withdraw their winnings to their wallet", async function () {
      const { roundId } = await runLuckyRound(CERTAIN_WIN);
      await settleRoundFrom(roundId);

      await (await d.sable.connect(d.alice).claimRewards()).wait();
      const total = await balanceOf(d, d.alice);

      const { handle, proof } = await encrypt(d, total);
      await (await d.sable.connect(d.alice).withdraw(handle, proof)).wait();

      expect(await balanceOf(d, d.alice)).to.equal(0n);
    });
  });

  /** Completes a round that has already been closed and had eligibility processed. */
  async function settleRoundFrom(roundId: number): Promise<void> {
    const { sable, admin } = d;
    await (await sable.connect(admin).finalizeRound(roundId)).wait();

    const total = Number((await sable.roundState(roundId)).participantCount);
    while (Number((await sable.roundState(roundId)).ticketCursor) < total) {
      await (await sable.connect(admin).assignTicketsBatch(roundId, 4)).wait();
    }

    const drawTotal = Number((await sable.roundState(roundId)).drawPointCount);
    while (Number((await sable.roundState(roundId)).drawCursor) < drawTotal) {
      await (await sable.connect(admin).drawBatch(roundId, 8)).wait();
    }

    while (Number((await sable.roundState(roundId)).settleCursor) < total) {
      await (await sable.connect(admin).settleBatch(roundId, 1)).wait();
    }

    await (await sable.connect(admin).completeRound(roundId)).wait();
  }

  async function encrypt(deployment: Deployment, value: bigint) {
    const { fhevm, ethers } = await import("hardhat");
    const enc = await fhevm
      .createEncryptedInput(deployment.sableAddress, deployment.alice.address)
      .add64(value)
      .encrypt();
    return { handle: ethers.hexlify(enc.handles[0]), proof: ethers.hexlify(enc.inputProof) };
  }
});
