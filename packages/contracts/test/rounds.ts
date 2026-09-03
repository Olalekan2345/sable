import { FhevmType } from "@fhevm/hardhat-plugin";
import { expect } from "chai";

import {
  RoundState,
  configureRound,
  deploySable,
  deposit,
  fund,
  publicAmount,
  setMode,
  settleRound,
  time,
  usd,
  type Deployment,
} from "./helpers";

const HOUR = 3600;

/** A configuration that passes validation, used as the base for negative cases. */
async function baseConfig(d: Deployment, overrides: Record<string, unknown> = {}) {
  const now = await time.latest();
  return {
    opensAt: now,
    closesAt: now + HOUR,
    ticketBits: 16,
    maxParticipants: 8,
    weightPerTicket: 10_000_000n,
    jackpotWinnerCount: 1,
    midWinnerCount: 3,
    smallWinnerCount: 10,
    jackpotShareBps: 5000,
    midShareBps: 3000,
    smallShareBps: 2000,
    ...overrides,
  };
}

describe("Round lifecycle", function () {
  let d: Deployment;

  beforeEach(async function () {
    d = await deploySable({ ratePerYearBps: 0 });
    await fund(d, d.alice, usd(50_000));
    await fund(d, d.bob, usd(50_000));
  });

  // -----------------------------------------------------------------------
  // Draw verifiability
  // -----------------------------------------------------------------------

  describe("draw point publication", function () {
    /**
     * The draw is the part of Sable that has to be checkable by strangers.
     *
     * Its randomness comes from `FHE.randEuint64`, which nobody — including the operator who
     * submits the transaction — can read or steer. That is a strong property, but on its own
     * it asks the world to take the protocol's word for what happened. Publishing the points
     * once settlement is finished turns "trust the mechanism" into "here are the numbers,
     * check them yourself".
     *
     * The tests below hold both halves of the trade in place: the points must be unreadable
     * while the round can still change, readable afterwards, and publishing them must not
     * make any individual's ticket range readable.
     */
    async function drawnRound(): Promise<number> {
      const roundId = await configureRound(d);
      await (await d.sable.connect(d.admin).openRound(roundId)).wait();

      await deposit(d, d.alice, usd(10_000));
      await setMode(d, d.alice, true);
      await deposit(d, d.bob, usd(10_000));
      await setMode(d, d.bob, true);

      await time.increase(HOUR);
      await (await d.sable.connect(d.admin).closeRound(roundId)).wait();
      await (await d.sable.connect(d.admin).processEligibilityBatch(roundId, 10)).wait();
      await (await d.sable.connect(d.admin).finalizeRound(roundId)).wait();
      await (await d.sable.connect(d.admin).assignTicketsBatch(roundId, 10)).wait();
      await (await d.sable.connect(d.admin).drawBatch(roundId, 20)).wait();
      return roundId;
    }

    it("keeps the drawn numbers unreadable while settlement is still running", async function () {
      const roundId = await drawnRound();
      const points = await d.sable.drawPoints(roundId);

      expect(points.length).to.be.greaterThan(0);
      // A point readable here would let a saver who can decrypt their own range work out
      // their result before the protocol had finished computing it.
      for (const point of points) {
        await expect(publicAmount(point)).to.be.rejected;
      }
    });

    it("publishes every drawn number once the round completes", async function () {
      const roundId = await drawnRound();
      await (await d.sable.connect(d.admin).settleBatch(roundId, 10)).wait();
      await (await d.sable.connect(d.admin).completeRound(roundId)).wait();

      const points = await d.sable.drawPoints(roundId);
      const config = await d.sable.roundConfig(roundId);

      const expected =
        Number(config.jackpotWinnerCount) +
        Number(config.midWinnerCount) +
        Number(config.smallWinnerCount);
      expect(points.length).to.equal(expected);

      const domain = 2n ** BigInt(config.ticketBits);
      for (const point of points) {
        const value = await publicAmount(point);
        // Bounded by construction: `randEuint64` was given the ticket domain as its upper
        // bound, and a point outside it could never match any range.
        expect(value).to.be.lessThan(domain);
      }
    });

    it("announces the publication so a ledger can index it", async function () {
      const roundId = await drawnRound();
      await (await d.sable.connect(d.admin).settleBatch(roundId, 10)).wait();

      await expect(d.sable.connect(d.admin).completeRound(roundId))
        .to.emit(d.sable, "RoundDrawPointsPublished")
        .withArgs(roundId, (await d.sable.drawPoints(roundId)).length);
    });

    it("does not make any saver's ticket range readable", async function () {
      const roundId = await drawnRound();
      await (await d.sable.connect(d.admin).settleBatch(roundId, 10)).wait();
      await (await d.sable.connect(d.admin).completeRound(roundId)).wait();

      // This is the whole trade. Public points plus private ranges means an observer sees
      // where the darts landed and not whose territory they hit — so the draw is auditable
      // and the participants are still confidential.
      const { fhevm } = await import("hardhat");
      const [aliceStart, aliceEnd] = await d.sable.confidentialTicketRange(
        roundId,
        d.alice.address,
      );
      const [bobStart, bobEnd] = await d.sable.confidentialTicketRange(roundId, d.bob.address);

      // The very first range starts at a trivially-encrypted zero. That one *is* readable and
      // is meant to be: allocation always begins at the bottom of the domain, so the value is
      // a public constant that describes the scheme rather than anybody's position.
      expect(await fhevm.publicDecryptEuint(FhevmType.euint64, aliceStart)).to.equal(0n);

      // Every boundary that carries allocation information must stay private. These are what
      // would reveal how many tickets a saver holds — and therefore their weight, and
      // therefore their balance.
      for (const handle of [aliceEnd, bobStart, bobEnd]) {
        await expect(fhevm.publicDecryptEuint(FhevmType.euint64, handle)).to.be.rejected;
      }
    });
  });

  // -----------------------------------------------------------------------
  // Configuration validation
  // -----------------------------------------------------------------------

  describe("configuration", function () {
    it("accepts a valid configuration", async function () {
      const roundId = await configureRound(d);
      expect(roundId).to.equal(1);
      expect((await d.sable.roundState(roundId)).state).to.equal(RoundState.SCHEDULED);
    });

    it("rejects prize shares summing above 100%", async function () {
      // Invariant 5's first line of defence: a round can never be configured to pay out
      // more than the pool holds.
      const config = await baseConfig(d, { jackpotShareBps: 6000, midShareBps: 3000, smallShareBps: 2000 });
      await expect(d.sable.connect(d.admin).configureRound(config)).to.be.revertedWithCustomError(
        d.sable,
        "InvalidPrizeShares",
      );
    });

    it("accepts prize shares summing below 100%", async function () {
      // Leaving part of the pool unallocated is legitimate; it simply carries forward.
      const config = await baseConfig(d, { jackpotShareBps: 4000, midShareBps: 2000, smallShareBps: 1000 });
      await expect(d.sable.connect(d.admin).configureRound(config)).to.not.be.reverted;
    });

    it("rejects an inverted window", async function () {
      const now = await time.latest();
      const config = await baseConfig(d, { opensAt: now + HOUR, closesAt: now });
      await expect(d.sable.connect(d.admin).configureRound(config)).to.be.revertedWithCustomError(
        d.sable,
        "InvalidRoundWindow",
      );
    });

    it("rejects a round longer than the overflow budget allows", async function () {
      const now = await time.latest();
      const config = await baseConfig(d, { opensAt: now, closesAt: now + 31 * 24 * HOUR });
      await expect(d.sable.connect(d.admin).configureRound(config)).to.be.revertedWithCustomError(
        d.sable,
        "RoundTooLong",
      );
    });

    it("rejects a ticket domain outside the supported range", async function () {
      const config = await baseConfig(d, { ticketBits: 7 });
      await expect(d.sable.connect(d.admin).configureRound(config)).to.be.revertedWithCustomError(
        d.sable,
        "InvalidTicketBits",
      );
    });

    it("rejects a zero weight-per-ticket divisor", async function () {
      const config = await baseConfig(d, { weightPerTicket: 0n });
      await expect(d.sable.connect(d.admin).configureRound(config)).to.be.revertedWithCustomError(
        d.sable,
        "InvalidWeightPerTicket",
      );
    });

    it("rejects a tier with a share but no winners", async function () {
      const config = await baseConfig(d, { midWinnerCount: 0 });
      await expect(d.sable.connect(d.admin).configureRound(config)).to.be.revertedWithCustomError(
        d.sable,
        "InvalidTierConfig",
      );
    });

    it("rejects a tier with winners but no share", async function () {
      const config = await baseConfig(d, { midShareBps: 0, jackpotShareBps: 8000 });
      await expect(d.sable.connect(d.admin).configureRound(config)).to.be.revertedWithCustomError(
        d.sable,
        "InvalidTierConfig",
      );
    });

    it("rejects more participants than the ticket domain can seat", async function () {
      const config = await baseConfig(d, { ticketBits: 8, maxParticipants: 1000 });
      await expect(d.sable.connect(d.admin).configureRound(config)).to.be.revertedWithCustomError(
        d.sable,
        "InvalidParticipantCap",
      );
    });

    it("rejects a draw schedule larger than the per-round maximum", async function () {
      const config = await baseConfig(d, {
        jackpotWinnerCount: 60,
        midWinnerCount: 3,
        smallWinnerCount: 10,
      });
      await expect(d.sable.connect(d.admin).configureRound(config)).to.be.revertedWithCustomError(
        d.sable,
        "TooManyDrawPoints",
      );
    });
  });

  // -----------------------------------------------------------------------
  // State machine
  // -----------------------------------------------------------------------

  describe("state machine", function () {
    it("walks the full pipeline in order", async function () {
      const roundId = await configureRound(d, { durationSeconds: HOUR });
      await deposit(d, d.alice, usd(1_000));
      await setMode(d, d.alice, true);

      await (await d.sable.connect(d.admin).openRound(roundId)).wait();
      expect((await d.sable.roundState(roundId)).state).to.equal(RoundState.OPEN);

      await time.increase(HOUR);
      await (await d.sable.connect(d.admin).closeRound(roundId)).wait();
      expect((await d.sable.roundState(roundId)).state).to.equal(RoundState.CLOSING);

      await (await d.sable.connect(d.admin).processEligibilityBatch(roundId, 10)).wait();
      await (await d.sable.connect(d.admin).finalizeRound(roundId)).wait();
      expect((await d.sable.roundState(roundId)).state).to.equal(RoundState.FINALIZED);

      await (await d.sable.connect(d.admin).assignTicketsBatch(roundId, 10)).wait();
      expect((await d.sable.roundState(roundId)).state).to.equal(RoundState.DRAWING);

      await (await d.sable.connect(d.admin).drawBatch(roundId, 20)).wait();
      expect((await d.sable.roundState(roundId)).state).to.equal(RoundState.SETTLING);

      await (await d.sable.connect(d.admin).settleBatch(roundId, 10)).wait();
      await (await d.sable.connect(d.admin).completeRound(roundId)).wait();
      expect((await d.sable.roundState(roundId)).state).to.equal(RoundState.COMPLETE);
    });

    it("refuses to skip from OPEN straight to settlement", async function () {
      const roundId = await configureRound(d);
      await (await d.sable.connect(d.admin).openRound(roundId)).wait();

      await expect(d.sable.connect(d.admin).finalizeRound(roundId)).to.be.revertedWithCustomError(
        d.sable,
        "InvalidRoundState",
      );
      await expect(d.sable.connect(d.admin).drawBatch(roundId, 1)).to.be.revertedWithCustomError(
        d.sable,
        "InvalidRoundState",
      );
      await expect(d.sable.connect(d.admin).settleBatch(roundId, 1)).to.be.revertedWithCustomError(
        d.sable,
        "InvalidRoundState",
      );
      await expect(d.sable.connect(d.admin).completeRound(roundId)).to.be.revertedWithCustomError(
        d.sable,
        "InvalidRoundState",
      );
    });

    it("refuses to close before the scheduled close time", async function () {
      const roundId = await configureRound(d);
      await (await d.sable.connect(d.admin).openRound(roundId)).wait();

      await expect(d.sable.connect(d.admin).closeRound(roundId)).to.be.revertedWithCustomError(
        d.sable,
        "RoundNotClosable",
      );
    });

    it("refuses to open a second round while one is open", async function () {
      const first = await configureRound(d);
      const second = await configureRound(d);

      await (await d.sable.connect(d.admin).openRound(first)).wait();
      await expect(d.sable.connect(d.admin).openRound(second)).to.be.revertedWithCustomError(
        d.sable,
        "RoundAlreadyOpen",
      );
    });

    it("refuses to open a round before its scheduled open time", async function () {
      const roundId = await configureRound(d, { opensInSeconds: HOUR });
      await expect(d.sable.connect(d.admin).openRound(roundId)).to.be.revertedWithCustomError(
        d.sable,
        "InvalidRoundWindow",
      );
    });

    it("refuses to finalize while eligibility is incomplete", async function () {
      const roundId = await configureRound(d);
      await deposit(d, d.alice, usd(1_000));
      await deposit(d, d.bob, usd(1_000));

      await (await d.sable.connect(d.admin).openRound(roundId)).wait();
      await time.increase(HOUR);
      await (await d.sable.connect(d.admin).closeRound(roundId)).wait();

      // Only one of two participants processed.
      await (await d.sable.connect(d.admin).processEligibilityBatch(roundId, 1)).wait();

      await expect(d.sable.connect(d.admin).finalizeRound(roundId)).to.be.revertedWithCustomError(
        d.sable,
        "BatchIncomplete",
      );
    });

    it("refuses to complete while settlement is incomplete", async function () {
      const roundId = await configureRound(d);
      await deposit(d, d.alice, usd(1_000));
      await deposit(d, d.bob, usd(1_000));

      await (await d.sable.connect(d.admin).openRound(roundId)).wait();
      await time.increase(HOUR);
      await (await d.sable.connect(d.admin).closeRound(roundId)).wait();
      await (await d.sable.connect(d.admin).processEligibilityBatch(roundId, 10)).wait();
      await (await d.sable.connect(d.admin).finalizeRound(roundId)).wait();
      await (await d.sable.connect(d.admin).assignTicketsBatch(roundId, 10)).wait();
      await (await d.sable.connect(d.admin).drawBatch(roundId, 20)).wait();
      await (await d.sable.connect(d.admin).settleBatch(roundId, 1)).wait();

      await expect(d.sable.connect(d.admin).completeRound(roundId)).to.be.revertedWithCustomError(
        d.sable,
        "BatchIncomplete",
      );
    });

    it("refuses to run a completed round again", async function () {
      // Invariant 6.
      const roundId = await configureRound(d);
      await deposit(d, d.alice, usd(1_000));
      await setMode(d, d.alice, true);

      await (await d.sable.connect(d.admin).openRound(roundId)).wait();
      await time.increase(HOUR);
      await (await d.sable.connect(d.admin).closeRound(roundId)).wait();
      await settleRound(d, roundId);

      await expect(d.sable.connect(d.admin).completeRound(roundId)).to.be.revertedWithCustomError(
        d.sable,
        "InvalidRoundState",
      );
      await expect(d.sable.connect(d.admin).drawBatch(roundId, 1)).to.be.revertedWithCustomError(
        d.sable,
        "InvalidRoundState",
      );
      await expect(d.sable.connect(d.admin).settleBatch(roundId, 1)).to.be.revertedWithCustomError(
        d.sable,
        "InvalidRoundState",
      );
      await expect(d.sable.connect(d.admin).closeRound(roundId)).to.be.revertedWithCustomError(
        d.sable,
        "InvalidRoundState",
      );
    });

    it("completes a round nobody joined", async function () {
      // The first round of any deployment is opened before anyone has deposited, so an
      // empty round is the common case rather than an exotic one.
      //
      // Regression: `assignTicketsBatch` reverts `BatchAlreadyComplete` on an empty
      // participant set (cursor 0 >= total 0), so a round that reached FINALIZED with zero
      // participants had no legal transition out and was stuck forever. `finalizeRound` now
      // skips the ticket phase when there is nobody to allocate to.
      const roundId = await configureRound(d);

      await (await d.sable.connect(d.admin).openRound(roundId)).wait();
      await time.increase(HOUR);
      await (await d.sable.connect(d.admin).closeRound(roundId)).wait();

      expect((await d.sable.roundState(roundId)).participantCount).to.equal(0);

      // Eligibility is trivially complete, so finalize runs immediately...
      await (await d.sable.connect(d.admin).finalizeRound(roundId)).wait();

      // ...and the ticket phase is skipped entirely.
      expect((await d.sable.roundState(roundId)).state).to.equal(RoundState.DRAWING);

      await (await d.sable.connect(d.admin).drawBatch(roundId, 20)).wait();
      expect((await d.sable.roundState(roundId)).state).to.equal(RoundState.SETTLING);

      // Nothing to settle, so the round completes directly.
      await (await d.sable.connect(d.admin).completeRound(roundId)).wait();
      expect((await d.sable.roundState(roundId)).state).to.equal(RoundState.COMPLETE);
    });

    it("still requires the ticket phase when the round has participants", async function () {
      const roundId = await configureRound(d);
      await deposit(d, d.alice, usd(1_000));

      await (await d.sable.connect(d.admin).openRound(roundId)).wait();
      await time.increase(HOUR);
      await (await d.sable.connect(d.admin).closeRound(roundId)).wait();
      await (await d.sable.connect(d.admin).processEligibilityBatch(roundId, 10)).wait();
      await (await d.sable.connect(d.admin).finalizeRound(roundId)).wait();

      // Not skipped: there is an allocation to make.
      expect((await d.sable.roundState(roundId)).state).to.equal(RoundState.FINALIZED);
    });

    it("rejects an unknown round id", async function () {
      await expect(d.sable.connect(d.admin).openRound(99)).to.be.revertedWithCustomError(
        d.sable,
        "UnknownRound",
      );
    });

    it("rejects an empty batch", async function () {
      const roundId = await configureRound(d);
      await deposit(d, d.alice, usd(1_000));
      await (await d.sable.connect(d.admin).openRound(roundId)).wait();
      await time.increase(HOUR);
      await (await d.sable.connect(d.admin).closeRound(roundId)).wait();

      await expect(
        d.sable.connect(d.admin).processEligibilityBatch(roundId, 0),
      ).to.be.revertedWithCustomError(d.sable, "EmptyBatch");
    });

    it("rejects processing past the end of a phase", async function () {
      const roundId = await configureRound(d);
      await deposit(d, d.alice, usd(1_000));
      await (await d.sable.connect(d.admin).openRound(roundId)).wait();
      await time.increase(HOUR);
      await (await d.sable.connect(d.admin).closeRound(roundId)).wait();
      await (await d.sable.connect(d.admin).processEligibilityBatch(roundId, 10)).wait();

      await expect(
        d.sable.connect(d.admin).processEligibilityBatch(roundId, 10),
      ).to.be.revertedWithCustomError(d.sable, "BatchAlreadyComplete");
    });

    it("resumes each phase across several transactions", async function () {
      const roundId = await configureRound(d, { maxParticipants: 8 });
      for (const account of [d.alice, d.bob, d.carol, d.dave]) {
        await fund(d, account, usd(10_000));
        await deposit(d, account, usd(1_000));
        await setMode(d, account, true);
      }

      await (await d.sable.connect(d.admin).openRound(roundId)).wait();
      await time.increase(HOUR);
      await (await d.sable.connect(d.admin).closeRound(roundId)).wait();

      // One participant at a time, all the way through.
      await settleRound(d, roundId, 1);

      const state = await d.sable.roundState(roundId);
      expect(state.state).to.equal(RoundState.COMPLETE);
      expect(state.eligibilityCursor).to.equal(4);
      expect(state.ticketCursor).to.equal(4);
      expect(state.settleCursor).to.equal(4);
    });

    it("snapshots the participant set at close", async function () {
      const roundId = await configureRound(d);
      await deposit(d, d.alice, usd(1_000));

      await (await d.sable.connect(d.admin).openRound(roundId)).wait();
      await time.increase(HOUR);
      await (await d.sable.connect(d.admin).closeRound(roundId)).wait();

      expect((await d.sable.roundState(roundId)).participantCount).to.equal(1);

      // Registering during settlement must not move the goalposts for a running batch.
      await fund(d, d.carol, usd(1_000));
      await deposit(d, d.carol, usd(1_000));

      expect((await d.sable.roundState(roundId)).participantCount).to.equal(1);
      expect(await d.sable.participantCount()).to.equal(2n);

      await settleRound(d, roundId);
      expect((await d.sable.roundState(roundId)).state).to.equal(RoundState.COMPLETE);
    });

    it("caps the scored set at the round's configured maximum", async function () {
      const roundId = await configureRound(d, { maxParticipants: 2, ticketBits: 16 });
      for (const account of [d.alice, d.bob, d.carol]) {
        await fund(d, account, usd(10_000));
        await deposit(d, account, usd(1_000));
      }

      await (await d.sable.connect(d.admin).openRound(roundId)).wait();
      await time.increase(HOUR);
      await (await d.sable.connect(d.admin).closeRound(roundId)).wait();

      expect((await d.sable.roundState(roundId)).participantCount).to.equal(2);
    });
  });

  // -----------------------------------------------------------------------
  // Authorisation
  // -----------------------------------------------------------------------

  describe("authorisation", function () {
    it("restricts configuration to admins", async function () {
      const config = await baseConfig(d);
      await expect(d.sable.connect(d.alice).configureRound(config)).to.be.revertedWithCustomError(
        d.sable,
        "Unauthorized",
      );
    });

    it("lets anyone advance a round, so no keeper is a single point of failure", async function () {
      /*
       * The property this replaces the old operator gate with.
       *
       * Configuration stays administrative — it sets the window, the tiers and the ticket
       * domain. Advancing an already-configured round does not: every step is gated by a
       * timestamp, a state or a cursor, so there is no ordering to game and no moment to
       * choose. `drawBatch` draws from `FHE.randEuint64`, which the sender can neither steer
       * nor read, so submitting it reveals nothing to whoever submits it.
       *
       * What it buys: a saver whose prize is sitting in a stalled round can finish the round
       * themselves rather than waiting on somebody else's uptime.
       */
      const roundId = await configureRound(d);

      await deposit(d, d.alice, usd(10_000));

      // `d.bob` holds no role at all.
      await expect(d.sable.connect(d.bob).openRound(roundId)).to.not.be.reverted;

      await time.increase(HOUR);
      await expect(d.sable.connect(d.bob).closeRound(roundId)).to.not.be.reverted;
      await expect(d.sable.connect(d.bob).processEligibilityBatch(roundId, 10)).to.not.be.reverted;
      await expect(d.sable.connect(d.bob).finalizeRound(roundId)).to.not.be.reverted;
      await expect(d.sable.connect(d.bob).assignTicketsBatch(roundId, 10)).to.not.be.reverted;
      await expect(d.sable.connect(d.bob).drawBatch(roundId, 20)).to.not.be.reverted;
      await expect(d.sable.connect(d.bob).settleBatch(roundId, 10)).to.not.be.reverted;
      await expect(d.sable.connect(d.bob).completeRound(roundId)).to.not.be.reverted;

      expect((await d.sable.roundState(roundId)).state).to.equal(RoundState.COMPLETE);
    });

    it("still refuses to close a round before its window has passed", async function () {
      // Permissionless advancement is safe precisely because the gates are not the caller's
      // identity. Anyone may close a round; nobody may close it early.
      const roundId = await configureRound(d);
      await (await d.sable.connect(d.admin).openRound(roundId)).wait();

      await expect(d.sable.connect(d.bob).closeRound(roundId)).to.be.revertedWithCustomError(
        d.sable,
        "RoundNotClosable",
      );
    });

    it("keeps configuration administrative", async function () {
      // The parameters of a round — its window, tier shares and ticket domain — remain an
      // administrative act. Only the advancing of one is open.
      const config = await baseConfig(d);
      await expect(
        d.sable.connect(d.alice).configureRound(config),
      ).to.be.revertedWithCustomError(d.sable, "Unauthorized");
    });

    it("lets an admin delegate configuration through the operator role", async function () {
      // The role still exists and still means something — it just no longer stands between a
      // saver and the completion of their own round.
      const operatorRole = await d.sable.OPERATOR_ROLE();
      await (await d.sable.connect(d.admin).grantRole(operatorRole, d.bob.address)).wait();
      expect(await d.sable.hasRole(operatorRole, d.bob.address)).to.equal(true);

      await (await d.sable.connect(d.admin).revokeRole(operatorRole, d.bob.address)).wait();
      expect(await d.sable.hasRole(operatorRole, d.bob.address)).to.equal(false);
    });

    it("refuses to lower the participant cap below the registry size", async function () {
      await deposit(d, d.alice, usd(100));
      await deposit(d, d.bob, usd(100));

      await expect(d.sable.connect(d.admin).setParticipantCap(1)).to.be.revertedWithCustomError(
        d.sable,
        "InvalidParticipantCap",
      );
    });
  });
});
