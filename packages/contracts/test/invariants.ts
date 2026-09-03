import { expect } from "chai";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

import {
  balanceOf,
  configureRound,
  deploySable,
  deposit,
  fund,
  publicAmount,
  rewardOf,
  setMode,
  settleRound,
  time,
  usd,
  walletBalanceOf,
  type Deployment,
} from "./helpers";

const ROUND = 5 * 24 * 3600;
const PRINCIPAL = usd(100_000);

/**
 * The protocol's non-negotiable invariants, exercised end-to-end on a mixed round with
 * both Steady and Lucky savers.
 *
 * These are deliberately written as whole-protocol assertions rather than unit tests: the
 * properties that matter are about what is true *after* money has moved through deposits,
 * yield accrual, a draw and settlement.
 */
describe("Protocol invariants", function () {
  let d: Deployment;
  let roundId: number;

  /** Alice saves Steady; Bob and Carol play Lucky. */
  beforeEach(async function () {
    d = await deploySable({ ratePerYearBps: 5000, participantCap: 16 });

    for (const account of [d.alice, d.bob, d.carol]) {
      await fund(d, account, usd(500_000));
    }

    roundId = await configureRound(d, {
      durationSeconds: ROUND,
      maxParticipants: 4,
      ticketBits: 16,
      weightPerTicket: 1_000_000n,
    });
    await (await d.sable.connect(d.admin).openRound(roundId)).wait();

    // Alice opts out to Steady; Bob and Carol are left on the Lucky default. Stating both
    // sides keeps the scenario readable now that the default has a direction of its own.
    await setMode(d, d.alice, false);
    await setMode(d, d.bob, true);
    await setMode(d, d.carol, true);

    await deposit(d, d.alice, PRINCIPAL);
    await deposit(d, d.bob, PRINCIPAL);
    await deposit(d, d.carol, PRINCIPAL);

    await time.increase(ROUND);
    await (await d.sable.connect(d.admin).closeRound(roundId)).wait();
    await settleRound(d, roundId, 2);
  });

  it("Invariant 1 — a saver's principal never becomes another saver's prize", async function () {
    // Alice is Steady, so she contributed nothing to the pool. Her balance must be at
    // least her principal: it can grow with her own yield, but nothing in the protocol can
    // move it into someone else's reward.
    expect(await balanceOf(d, d.alice)).to.be.greaterThanOrEqual(PRINCIPAL);

    // Bob and Carol contributed only yield. Their principal is intact even though they
    // played — that is the entire point of prize-linked saving.
    expect(await balanceOf(d, d.bob)).to.be.greaterThanOrEqual(PRINCIPAL);
    expect(await balanceOf(d, d.carol)).to.be.greaterThanOrEqual(PRINCIPAL);
  });

  it("Invariant 2 — only Lucky yield funds the prize pool", async function () {
    const aggregates = await d.sable.roundAggregates(roundId);
    const pool = await publicAmount(aggregates.prizePool);

    // Alice's Steady yield compounded to her, so her balance grew.
    const aliceBalance = await balanceOf(d, d.alice);
    const aliceYield = aliceBalance - PRINCIPAL;
    expect(aliceYield).to.be.greaterThan(0n);

    // Bob and Carol's balances did not grow — their yield went to the pool instead.
    expect(await balanceOf(d, d.bob)).to.equal(PRINCIPAL);
    expect(await balanceOf(d, d.carol)).to.equal(PRINCIPAL);

    // Two Lucky savers with identical principal and identical timing contributed the pool.
    expect(pool).to.be.greaterThan(0n);
    expect(pool).to.be.closeTo(aliceYield * 2n, aliceYield / 100n);
  });

  it("Invariant 5 — settlement never distributes more than the pool holds", async function () {
    const aggregates = await d.sable.roundAggregates(roundId);
    const pool = await publicAmount(aggregates.prizePool);
    const rollover = await publicAmount(aggregates.rollover);

    let credited = 0n;
    for (const account of [d.alice, d.bob, d.carol]) {
      credited += await rewardOf(d, account);
    }

    expect(credited + rollover).to.be.lessThanOrEqual(pool);
  });

  it("stays solvent — every saver can withdraw their whole position", async function () {
    // The strongest practical solvency statement available when every balance is a
    // ciphertext: if all three savers can drain their positions to their wallets, the
    // vault genuinely custodied everything it credited.
    const expected = new Map<HardhatEthersSigner, bigint>();

    for (const account of [d.alice, d.bob, d.carol]) {
      await (await d.sable.connect(account).claimRewards()).wait();
      const walletBefore = await walletBalanceOf(d, account);
      const position = await balanceOf(d, account);
      expected.set(account, walletBefore + position);
    }

    for (const account of [d.alice, d.bob, d.carol]) {
      const position = await balanceOf(d, account);
      const { fhevm, ethers } = await import("hardhat");
      const enc = await fhevm
        .createEncryptedInput(d.sableAddress, account.address)
        .add64(position)
        .encrypt();
      await (
        await d.sable
          .connect(account)
          .withdraw(ethers.hexlify(enc.handles[0]), ethers.hexlify(enc.inputProof))
      ).wait();
    }

    for (const account of [d.alice, d.bob, d.carol]) {
      expect(await balanceOf(d, account)).to.equal(0n);
      expect(await walletBalanceOf(d, account)).to.equal(expected.get(account));
    }
  });

  it("Invariant 3/4 — no participant's balance, mode or weight is publicly readable", async function () {
    // `publicDecrypt` succeeds only for handles the contract explicitly marked public.
    // Aggregates are; positions are not, and this asserts the distinction holds.
    const balanceHandle = await d.sable.confidentialBalanceOf(d.bob.address);
    const modeHandle = await d.sable.confidentialModeOf(d.bob.address);
    const weightHandle = await d.sable.confidentialWeightOf(roundId, d.bob.address);
    const rewardHandle = await d.sable.confidentialRewardOf(d.bob.address);

    const { fhevm } = await import("hardhat");
    for (const handle of [balanceHandle, weightHandle, rewardHandle]) {
      await expect(fhevm.publicDecryptEuint(5, handle)).to.be.rejected;
    }
    await expect(fhevm.publicDecryptEbool(modeHandle)).to.be.rejected;
  });

  it("keeps the round's aggregates publicly readable", async function () {
    // The complement of the previous test: round mechanics must be verifiable by anyone.
    const aggregates = await d.sable.roundAggregates(roundId);

    expect(await publicAmount(aggregates.prizePool)).to.be.a("bigint");
    expect(await publicAmount(aggregates.jackpotPrize)).to.be.a("bigint");
    expect(await publicAmount(aggregates.midPrize)).to.be.a("bigint");
    expect(await publicAmount(aggregates.smallPrize)).to.be.a("bigint");
    expect(await publicAmount(aggregates.rollover)).to.be.a("bigint");
  });

  it("gives two identically-positioned Lucky savers identical eligibility", async function () {
    // Fairness check: Bob and Carol deposited the same amount at the same time in the same
    // mode, so their ticket ranges must be the same width.
    const bobRange = await d.sable.confidentialTicketRange(roundId, d.bob.address);
    const carolRange = await d.sable.confidentialTicketRange(roundId, d.carol.address);

    const { fhevm } = await import("hardhat");
    const bobStart = await fhevm.userDecryptEuint(5, bobRange.start, d.sableAddress, d.bob);
    const bobEnd = await fhevm.userDecryptEuint(5, bobRange.end, d.sableAddress, d.bob);
    const carolStart = await fhevm.userDecryptEuint(5, carolRange.start, d.sableAddress, d.carol);
    const carolEnd = await fhevm.userDecryptEuint(5, carolRange.end, d.sableAddress, d.carol);

    expect(bobEnd - bobStart).to.equal(carolEnd - carolStart);
    expect(bobEnd - bobStart).to.be.greaterThan(0n);

    // Ranges are disjoint and ordered, which is what makes a single random point select at
    // most one winner per draw.
    expect(carolStart).to.be.greaterThanOrEqual(bobEnd);
  });

  it("gives a Steady saver an empty ticket range", async function () {
    const range = await d.sable.confidentialTicketRange(roundId, d.alice.address);

    const { fhevm } = await import("hardhat");
    const start = await fhevm.userDecryptEuint(5, range.start, d.sableAddress, d.alice);
    const end = await fhevm.userDecryptEuint(5, range.end, d.sableAddress, d.alice);

    // No random point can fall inside a zero-width range, so Alice cannot win — without
    // the contract ever branching on her mode.
    expect(end).to.equal(start);
    expect(await rewardOf(d, d.alice)).to.equal(0n);
  });

  it("keeps total allocated tickets inside the fixed 2^k domain", async function () {
    const { fhevm } = await import("hardhat");

    const bobRange = await d.sable.confidentialTicketRange(roundId, d.bob.address);
    const carolRange = await d.sable.confidentialTicketRange(roundId, d.carol.address);

    const bobEnd = await fhevm.userDecryptEuint(5, bobRange.end, d.sableAddress, d.bob);
    const carolEnd = await fhevm.userDecryptEuint(5, carolRange.end, d.sableAddress, d.carol);

    const domain = 1n << 16n;
    expect(bobEnd).to.be.lessThanOrEqual(domain);
    expect(carolEnd).to.be.lessThanOrEqual(domain);
  });
});
