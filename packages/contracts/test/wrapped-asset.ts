import { expect } from "chai";
import { ethers } from "hardhat";

import {
  MAX_BALANCE,
  RoundState,
  configureRound,
  deployWrappedSable,
  fundReserve,
  fundWrapped,
  publicAmount,
  settleRound,
  time,
  usd,
  type WrappedDeployment,
} from "./helpers";

const TEN_DAYS = 10 * 24 * 3600;

/**
 * Sable running on a confidential asset it does not control.
 *
 * On Sepolia the vault custodies Zama's canonical `cUSDCMock`
 * (`0x7c5BF43B851c1dff1a4feE8dB225b87f2C223639`) — an `ERC7984ERC20Wrapper` over a publicly
 * mintable ERC-20. That is the right asset to use: it is what the ecosystem actually holds,
 * and it removes any suspicion that the protocol conjures its own money.
 *
 * It also removes Sable's ability to mint, which is how the mint-based adapter pays yield.
 * These tests cover the reserve-backed adapter that replaces it, and prove the vault itself
 * needs no changes at all — it was always asset-agnostic.
 *
 * The local fixtures mirror the deployed contracts' shape exactly: six decimals, `rate() == 1`,
 * and a public `mint` capped at one million per call.
 */
describe("Wrapped confidential asset (Zama cUSDCMock shape)", function () {
  let d: WrappedDeployment;

  beforeEach(async function () {
    d = await deployWrappedSable({ ratePerYearBps: 5000, participantCap: 4 });
  });

  // -----------------------------------------------------------------------
  // The asset itself
  // -----------------------------------------------------------------------

  describe("asset compatibility", function () {
    it("matches the deployed cUSDCMock shape", async function () {
      expect(await d.wrapper.decimals()).to.equal(6);
      expect(await d.wrapper.rate()).to.equal(1n);
      expect(await d.wrapper.underlying()).to.equal(await d.underlying.getAddress());
      expect(await d.wrapper.symbol()).to.equal("cUSDCMock");
    });

    it("caps the underlying faucet at one million per call, as Zama's does", async function () {
      await expect(d.underlying.mint(d.alice.address, usd(1_000_000))).to.not.be.reverted;
      await expect(d.underlying.mint(d.alice.address, usd(1_000_001))).to.be.revertedWithCustomError(
        d.underlying,
        "MintLimitExceeded",
      );
    });

    it("wraps public tokens into a confidential balance", async function () {
      await fundWrapped(d, d.alice, usd(5_000));

      const handle = await d.wrapper.confidentialBalanceOf(d.alice.address);
      const { fhevm } = await import("hardhat");
      const balance = await fhevm.userDecryptEuint(5, handle, d.tokenAddress, d.alice);

      expect(balance).to.equal(usd(5_000));
      expect(await d.underlying.balanceOf(d.alice.address)).to.equal(0n);
    });
  });

  // -----------------------------------------------------------------------
  // Vault operations, unchanged
  // -----------------------------------------------------------------------

  describe("vault operations", function () {
    beforeEach(async function () {
      await fundWrapped(d, d.alice, usd(10_000));
    });

    it("accepts deposits of an asset Sable does not control", async function () {
      await depositWrapped(d, d.alice, usd(1_000));
      expect(await balanceOfWrapped(d, d.alice)).to.equal(usd(1_000));
    });

    it("withdraws back to the saver's confidential wallet balance", async function () {
      await depositWrapped(d, d.alice, usd(1_000));
      await withdrawWrapped(d, d.alice, usd(400));

      expect(await balanceOfWrapped(d, d.alice)).to.equal(usd(600));
      expect(await walletOf(d, d.alice)).to.equal(usd(9_400));
    });

    it("still enforces the confidential balance ceiling", async function () {
      // The ceiling protects euint64 arithmetic and is a vault property, not a token one.
      await fundWrapped(d, d.bob, usd(1_000_000));
      await depositWrapped(d, d.bob, MAX_BALANCE);

      expect(await balanceOfWrapped(d, d.bob)).to.equal(MAX_BALANCE);
    });

    it("keeps the confidential mode private on a third-party asset", async function () {
      await depositWrapped(d, d.alice, usd(1_000));
      await setModeWrapped(d, d.alice, true);

      const handle = await d.sable.confidentialModeOf(d.alice.address);
      const { fhevm } = await import("hardhat");
      await expect(fhevm.userDecryptEbool(handle, d.sableAddress, d.bob)).to.be.rejected;
      expect(await fhevm.userDecryptEbool(handle, d.sableAddress, d.alice)).to.equal(true);
    });
  });

  // -----------------------------------------------------------------------
  // Reserve solvency
  // -----------------------------------------------------------------------

  describe("reserve-backed yield", function () {
    it("records funding exactly, from the public ERC-20 leg", async function () {
      const before = await d.reserveAdapter.fundedTotal();
      await fundReserve(d, usd(10_000));

      expect(await d.reserveAdapter.fundedTotal()).to.equal(before + usd(10_000));
    });

    it("caps the yield index at what the reserve provably covers", async function () {
      // coveredDeposits = participantCap × MAX_BALANCE = 4 × 1e12.
      const covered = await d.reserveAdapter.coveredDeposits();
      const funded = await d.reserveAdapter.fundedTotal();

      const expectedCeiling = 1_000_000n + (funded * 1_000_000n) / covered;
      expect(await d.reserveAdapter.maxIndex()).to.equal(expectedCeiling);
    });

    it("refuses to advance the index past the ceiling however long it runs", async function () {
      const ceiling = await d.reserveAdapter.maxIndex();

      // Far longer than the reserve could fund at the published rate.
      await time.increase(400 * 24 * 3600);
      await (await d.reserveAdapter.refreshYieldIndex()).wait();

      expect(await d.reserveAdapter.yieldIndex()).to.equal(ceiling);
      expect(await d.reserveAdapter.yieldIndex()).to.be.lessThanOrEqual(ceiling);
    });

    it("raises the ceiling when the reserve is topped up", async function () {
      const before = await d.reserveAdapter.maxIndex();
      await fundReserve(d, usd(40_000));

      expect(await d.reserveAdapter.maxIndex()).to.be.greaterThan(before);
    });

    it("starts with no yield capacity when unfunded", async function () {
      const empty = await deployWrappedSable({ participantCap: 4, fundUnderlying: 0n });

      expect(await empty.reserveAdapter.fundedTotal()).to.equal(0n);
      // No reserve means no index growth: the protocol will not credit yield it cannot pay.
      expect(await empty.reserveAdapter.maxIndex()).to.equal(1_000_000n);

      await time.increase(TEN_DAYS);
      await (await empty.reserveAdapter.refreshYieldIndex()).wait();
      expect(await empty.reserveAdapter.yieldIndex()).to.equal(1_000_000n);
    });

    it("rejects a zero-value funding call", async function () {
      await expect(d.reserveAdapter.fund(0)).to.be.revertedWithCustomError(
        d.reserveAdapter,
        "NothingToFund",
      );
    });

    it("only lets the vault draw yield", async function () {
      const { fhevm } = await import("hardhat");
      const enc = await fhevm
        .createEncryptedInput(await d.reserveAdapter.getAddress(), d.alice.address)
        .add64(usd(1))
        .encrypt();

      // A non-vault caller is rejected before any transfer is attempted.
      await expect(
        d.reserveAdapter.connect(d.alice).drawYield(ethers.hexlify(enc.handles[0])),
      ).to.be.reverted;
    });
  });

  // -----------------------------------------------------------------------
  // End to end
  // -----------------------------------------------------------------------

  describe("a full round on the wrapped asset", function () {
    it("pays a prize pool out of the reserve and stays solvent", async function () {
      await fundWrapped(d, d.alice, usd(100_000));
      await fundWrapped(d, d.bob, usd(100_000));

      const roundId = await configureRound(d, {
        durationSeconds: TEN_DAYS,
        maxParticipants: 2,
        ticketBits: 16,
        weightPerTicket: 1_000_000n,
      });
      await (await d.sable.connect(d.admin).openRound(roundId)).wait();

      // Both sides stated: Alice stays on the Lucky default, Bob opts out to Steady. Leaving
      // Bob unset would now put him in the draw too, which is the point of the new default.
      await setModeWrapped(d, d.alice, true);
      await setModeWrapped(d, d.bob, false);
      await depositWrapped(d, d.alice, usd(50_000));
      await depositWrapped(d, d.bob, usd(50_000));

      await time.increase(TEN_DAYS);
      await (await d.sable.connect(d.admin).closeRound(roundId)).wait();
      await settleRound(d, roundId, 2);

      const state = await d.sable.roundState(roundId);
      expect(state.state).to.equal(RoundState.COMPLETE);

      // Alice was Lucky, so the pool is funded — from the reserve, not from anyone's principal.
      const aggregates = await d.sable.roundAggregates(roundId);
      const pool = await publicAmount(aggregates.prizePool);
      expect(pool).to.be.greaterThan(0n);

      // Bob was Steady: his principal is intact and his yield compounded to him.
      expect(await balanceOfWrapped(d, d.bob)).to.be.greaterThan(usd(50_000));

      // Alice's principal is exactly intact — her yield went to the pool.
      expect(await balanceOfWrapped(d, d.alice)).to.equal(usd(50_000));

      // Solvency: both savers can drain their positions entirely.
      for (const account of [d.alice, d.bob]) {
        await (await d.sable.connect(account).claimRewards()).wait();
        const position = await balanceOfWrapped(d, account);
        await withdrawWrapped(d, account, position);
        expect(await balanceOfWrapped(d, account)).to.equal(0n);
      }
    });
  });
});

/* ------------------------------------------------------------------ helpers */
/* The shared helpers are typed against the own-token deployment; these adapt   */
/* them to the wrapped fixture without weakening either type.                   */

async function depositWrapped(d: WrappedDeployment, account: WrappedDeployment["alice"], amount: bigint) {
  const { fhevm } = await import("hardhat");
  const enc = await fhevm.createEncryptedInput(d.sableAddress, account.address).add64(amount).encrypt();
  await (
    await d.sable.connect(account).deposit(ethers.hexlify(enc.handles[0]), ethers.hexlify(enc.inputProof))
  ).wait();
}

async function withdrawWrapped(d: WrappedDeployment, account: WrappedDeployment["alice"], amount: bigint) {
  const { fhevm } = await import("hardhat");
  const enc = await fhevm.createEncryptedInput(d.sableAddress, account.address).add64(amount).encrypt();
  await (
    await d.sable.connect(account).withdraw(ethers.hexlify(enc.handles[0]), ethers.hexlify(enc.inputProof))
  ).wait();
}

async function setModeWrapped(d: WrappedDeployment, account: WrappedDeployment["alice"], lucky: boolean) {
  const { fhevm } = await import("hardhat");
  const enc = await fhevm.createEncryptedInput(d.sableAddress, account.address).addBool(lucky).encrypt();
  await (
    await d.sable.connect(account).setMode(ethers.hexlify(enc.handles[0]), ethers.hexlify(enc.inputProof))
  ).wait();
}

async function balanceOfWrapped(d: WrappedDeployment, account: WrappedDeployment["alice"]): Promise<bigint> {
  const { fhevm } = await import("hardhat");
  const handle = await d.sable.confidentialBalanceOf(account.address);
  if (handle === ethers.ZeroHash) return 0n;
  return fhevm.userDecryptEuint(5, handle, d.sableAddress, account);
}

async function walletOf(d: WrappedDeployment, account: WrappedDeployment["alice"]): Promise<bigint> {
  const { fhevm } = await import("hardhat");
  const handle = await d.wrapper.confidentialBalanceOf(account.address);
  if (handle === ethers.ZeroHash) return 0n;
  return fhevm.userDecryptEuint(5, handle, d.tokenAddress, account);
}
