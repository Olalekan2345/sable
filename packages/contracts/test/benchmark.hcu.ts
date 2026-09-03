import { expect } from "chai";
import { fhevm } from "hardhat";
import type { ContractTransactionReceipt } from "ethers";

import {
  configureRound,
  deploySable,
  deposit,
  fund,
  setMode,
  time,
  usd,
  type Deployment,
} from "./helpers";

/**
 * Homomorphic-complexity benchmark.
 *
 * The brief suggested "roughly 50 participants per round" and explicitly said not to
 * assume that number works. This file is the measurement that replaces the assumption.
 *
 * It reports two figures per transaction:
 *
 * - `globalHCU`   — total homomorphic work in the transaction.
 * - `maxHCUDepth` — the longest *sequential* dependency chain, which is the figure that
 *                   actually constrains a transaction, since independent operations
 *                   parallelise across the coprocessor.
 *
 * The mock coprocessor **does** enforce the protocol's HCU ceilings — an oversized batch
 * reverts here with `HCUTransactionLimitExceeded()` exactly as it would on Sepolia — so
 * these numbers are a real constraint rather than an estimate.
 *
 * The headline result: with the product's 14-point tier ladder, settlement costs about
 * **7.56M HCU per participant** against a 20M ceiling, so **at most two accounts can be
 * settled per transaction**. A 50-participant round is therefore entirely feasible, but it
 * takes ~25 settlement transactions rather than one. That is an operational cost, not a
 * wall — which is precisely why every phase is resumable.
 */

/**
 * The protocol's hard per-transaction ceilings, read from
 * `@fhevm/host-contracts/contracts/HCULimit.sol`. These are enforced on-chain — exceeding
 * either reverts with `HCUTransactionLimitExceeded()` — and the mock enforces them too,
 * which is what makes this benchmark meaningful rather than decorative.
 */
const MAX_GLOBAL_HCU = 20_000_000;
const MAX_DEPTH_HCU = 5_000_000;

/** Leaves room for the tier ladder growing slightly without re-tuning every batch size. */
const SAFETY_FACTOR = 0.8;

interface Measurement {
  label: string;
  globalHCU: number;
  depth: number;
  participants: number;
}

const results: Measurement[] = [];

function record(label: string, receipt: ContractTransactionReceipt, participants: number): Measurement {
  const info = fhevm.computeTransactionHCU(receipt);
  const measurement: Measurement = {
    label,
    globalHCU: info.globalHCU,
    depth: info.maxHCUDepth,
    participants,
  };
  results.push(measurement);
  return measurement;
}

describe("HCU benchmark", function () {
  let d: Deployment;

  const TEN_MINUTES = 600;

  after(function () {
    if (results.length === 0) return;

    const rows = results.map((r) => ({
      phase: r.label,
      accounts: r.participants,
      globalHCU: r.globalHCU.toLocaleString("en-US"),
      depth: r.depth.toLocaleString("en-US"),
      perAccount: r.participants > 0 ? Math.round(r.globalHCU / r.participants).toLocaleString("en-US") : "—",
    }));

    // eslint-disable-next-line no-console
    console.log("\n  Measured homomorphic cost by phase:");
    // eslint-disable-next-line no-console
    console.table(rows);
  });

  beforeEach(async function () {
    d = await deploySable({ ratePerYearBps: 5000, participantCap: 64 });
  });

  it("measures the cost of each user-facing action", async function () {
    await fund(d, d.alice, usd(50_000));

    const roundId = await configureRound(d, { durationSeconds: TEN_MINUTES });
    await (await d.sable.connect(d.admin).openRound(roundId)).wait();

    const { fhevm: hh, ethers } = await import("hardhat");

    const modeInput = await hh
      .createEncryptedInput(d.sableAddress, d.alice.address)
      .addBool(true)
      .encrypt();
    const modeReceipt = await (
      await d.sable
        .connect(d.alice)
        .setMode(ethers.hexlify(modeInput.handles[0]), ethers.hexlify(modeInput.inputProof))
    ).wait();
    const mode = record("setMode", modeReceipt!, 1);

    const depositInput = await hh
      .createEncryptedInput(d.sableAddress, d.alice.address)
      .add64(usd(1_000))
      .encrypt();
    const depositReceipt = await (
      await d.sable
        .connect(d.alice)
        .deposit(ethers.hexlify(depositInput.handles[0]), ethers.hexlify(depositInput.inputProof))
    ).wait();
    const dep = record("deposit", depositReceipt!, 1);

    const withdrawInput = await hh
      .createEncryptedInput(d.sableAddress, d.alice.address)
      .add64(usd(100))
      .encrypt();
    const withdrawReceipt = await (
      await d.sable
        .connect(d.alice)
        .withdraw(ethers.hexlify(withdrawInput.handles[0]), ethers.hexlify(withdrawInput.inputProof))
    ).wait();
    const wit = record("withdraw", withdrawReceipt!, 1);

    // Every user-facing action must fit comfortably in one transaction — savers are not
    // going to submit a batched deposit.
    for (const m of [mode, dep, wit]) {
      expect(m.depth, `${m.label} sequential depth`).to.be.lessThan(MAX_DEPTH_HCU);
      expect(m.globalHCU, `${m.label} global HCU`).to.be.lessThan(MAX_GLOBAL_HCU);
    }
  });

  it("measures settlement cost per participant against the full 14-point ladder", async function () {
    // The product's target tier shape: 1 jackpot + 3 mid + 10 small.
    const accounts = [d.alice, d.bob, d.carol, d.dave];
    for (const account of accounts) {
      await fund(d, account, usd(50_000));
    }

    const roundId = await configureRound(d, {
      durationSeconds: TEN_MINUTES,
      maxParticipants: 8,
      weightPerTicket: 1_000n,
    });
    await (await d.sable.connect(d.admin).openRound(roundId)).wait();

    for (const account of accounts) {
      await setMode(d, account, true);
      await deposit(d, account, usd(1_000));
    }

    await time.increase(TEN_MINUTES);
    await (await d.sable.connect(d.admin).closeRound(roundId)).wait();

    const eligibility = await (
      await d.sable.connect(d.admin).processEligibilityBatch(roundId, 4)
    ).wait();
    record("processEligibilityBatch (4 accounts)", eligibility!, 4);

    const finalize = await (await d.sable.connect(d.admin).finalizeRound(roundId)).wait();
    record("finalizeRound", finalize!, 0);

    const tickets = await (await d.sable.connect(d.admin).assignTicketsBatch(roundId, 4)).wait();
    record("assignTicketsBatch (4 accounts)", tickets!, 4);

    const draw = await (await d.sable.connect(d.admin).drawBatch(roundId, 14)).wait();
    record("drawBatch (14 points)", draw!, 0);

    // One participant at a time: this is the marginal cost that sets the batch size.
    const settleOne = await (await d.sable.connect(d.admin).settleBatch(roundId, 1)).wait();
    const one = record("settleBatch (1 account x 14 points)", settleOne!, 1);

    const settleTwo = await (await d.sable.connect(d.admin).settleBatch(roundId, 2)).wait();
    const two = record("settleBatch (2 accounts x 14 points)", settleTwo!, 2);

    const settleRest = await (await d.sable.connect(d.admin).settleBatch(roundId, 1)).wait();
    record("settleBatch (1 account, tail)", settleRest!, 1);

    const complete = await (await d.sable.connect(d.admin).completeRound(roundId)).wait();
    record("completeRound", complete!, 0);

    // Settlement is the dominant phase and the one that decides how many transactions a
    // round takes.
    expect(one.globalHCU).to.be.greaterThan(0);
    expect(two.globalHCU).to.be.greaterThan(one.globalHCU);

    // Global HCU is the binding constraint here, not sequential depth: participants are
    // independent, so depth stays flat while total work scales linearly.
    expect(two.depth).to.be.lessThan(one.depth * 2);
    expect(two.globalHCU).to.be.lessThan(MAX_GLOBAL_HCU);

    // The derived batch size the operator tooling should use.
    const perAccount = one.globalHCU;
    const derived = Math.max(1, Math.floor((MAX_GLOBAL_HCU * SAFETY_FACTOR) / perAccount));

    // eslint-disable-next-line no-console
    console.log(
      `\n  Settlement costs ~${perAccount.toLocaleString("en-US")} HCU per account ` +
        `against a ${MAX_GLOBAL_HCU.toLocaleString("en-US")} ceiling ` +
        `=> settle at most ${derived} account(s) per transaction.`,
    );

    expect(derived, "derived settlement batch size").to.be.greaterThanOrEqual(1);
  });

  it("rejects a settlement batch that would exceed the protocol HCU ceiling", async function () {
    // Documents the wall rather than pretending it is not there: at 14 draw points, three
    // participants in one transaction is over the 20M limit and reverts on-chain.
    const accounts = [d.alice, d.bob, d.carol, d.dave];
    for (const account of accounts) {
      await fund(d, account, usd(50_000));
    }

    const roundId = await configureRound(d, {
      durationSeconds: TEN_MINUTES,
      maxParticipants: 8,
      weightPerTicket: 1_000n,
    });
    await (await d.sable.connect(d.admin).openRound(roundId)).wait();

    for (const account of accounts) {
      await setMode(d, account, true);
      await deposit(d, account, usd(1_000));
    }

    await time.increase(TEN_MINUTES);
    await (await d.sable.connect(d.admin).closeRound(roundId)).wait();
    await (await d.sable.connect(d.admin).processEligibilityBatch(roundId, 4)).wait();
    await (await d.sable.connect(d.admin).finalizeRound(roundId)).wait();
    await (await d.sable.connect(d.admin).assignTicketsBatch(roundId, 4)).wait();
    await (await d.sable.connect(d.admin).drawBatch(roundId, 14)).wait();

    await expect(d.sable.connect(d.admin).settleBatch(roundId, 4)).to.be.rejected;

    // The cursor did not move, so the round is simply resumable at a smaller batch size.
    expect((await d.sable.roundState(roundId)).settleCursor).to.equal(0);

    await (await d.sable.connect(d.admin).settleBatch(roundId, 2)).wait();
    expect((await d.sable.roundState(roundId)).settleCursor).to.equal(2);
  });

  it("confirms a full round completes within a conservative per-transaction budget", async function () {
    const accounts = [d.alice, d.bob, d.carol, d.dave];
    for (const account of accounts) {
      await fund(d, account, usd(50_000));
    }

    const roundId = await configureRound(d, {
      durationSeconds: TEN_MINUTES,
      maxParticipants: 8,
      weightPerTicket: 1_000n,
    });
    await (await d.sable.connect(d.admin).openRound(roundId)).wait();

    for (const account of accounts) {
      await setMode(d, account, true);
      await deposit(d, account, usd(1_000));
    }

    await time.increase(TEN_MINUTES);
    await (await d.sable.connect(d.admin).closeRound(roundId)).wait();

    const receipts: ContractTransactionReceipt[] = [];
    receipts.push((await (await d.sable.connect(d.admin).processEligibilityBatch(roundId, 4)).wait())!);
    receipts.push((await (await d.sable.connect(d.admin).finalizeRound(roundId)).wait())!);
    receipts.push((await (await d.sable.connect(d.admin).assignTicketsBatch(roundId, 4)).wait())!);
    receipts.push((await (await d.sable.connect(d.admin).drawBatch(roundId, 14)).wait())!);
    for (let i = 0; i < 4; i++) {
      receipts.push((await (await d.sable.connect(d.admin).settleBatch(roundId, 1)).wait())!);
    }
    receipts.push((await (await d.sable.connect(d.admin).completeRound(roundId)).wait())!);

    for (const receipt of receipts) {
      const info = fhevm.computeTransactionHCU(receipt);
      expect(info.maxHCUDepth, `tx ${receipt.hash} sequential depth`).to.be.lessThan(MAX_DEPTH_HCU);
      expect(info.globalHCU, `tx ${receipt.hash} global HCU`).to.be.lessThan(MAX_GLOBAL_HCU);
    }
  });
});
