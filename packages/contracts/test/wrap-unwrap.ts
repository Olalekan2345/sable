import { FhevmType } from "@fhevm/hardhat-plugin";
import { expect } from "chai";
import { ethers, fhevm } from "hardhat";

import { deployWrappedSable, time, usd, type WrappedDeployment } from "./helpers";

/**
 * The boundary between the public token economy and the confidential one.
 *
 * Sable issues nothing, so wrapping and unwrapping are the *only* ways value enters or
 * leaves the confidential side. These tests walk a saver all the way round — public ERC-20,
 * into the wrapper, into the vault, back out, and back to a public ERC-20 — because a
 * one-way door would be a product failure no unit test of the vault alone would catch.
 *
 * Unwrapping is deliberately asynchronous in Zama's design, and this suite exercises all
 * three steps rather than a convenience wrapper around them:
 *
 *   1. `unwrap(...)`        burns the confidential amount, marks the handle publicly
 *                           decryptable, and returns a request id
 *   2. `publicDecrypt(...)` turns that handle into a cleartext plus a KMS proof
 *   3. `finalizeUnwrap(...)` re-verifies the proof on-chain and releases the underlying
 *
 * The request id **is** the burned amount's ciphertext handle, which is why step 2 needs
 * nothing from the logs.
 */
describe("Wrap and unwrap", function () {
  let d: WrappedDeployment;

  beforeEach(async function () {
    d = await deployWrappedSable({ ratePerYearBps: 0, participantCap: 4 });
  });

  /** Mints the public ERC-20 and wraps it, the way a saver would. */
  async function wrap(account: WrappedDeployment["alice"], amount: bigint) {
    await (await d.underlying.mint(account.address, amount)).wait();
    await (await d.underlying.connect(account).approve(await d.wrapper.getAddress(), amount)).wait();
    await (await d.wrapper.connect(account).wrap(account.address, amount)).wait();
  }

  async function confidentialBalance(account: WrappedDeployment["alice"]): Promise<bigint> {
    const handle = await d.wrapper.confidentialBalanceOf(account.address);
    if (handle === ethers.ZeroHash) return 0n;
    return fhevm.userDecryptEuint(FhevmType.euint64, handle, d.tokenAddress, account);
  }

  /**
   * Runs the full three-step unwrap and returns the request id.
   *
   * Mirrors exactly what the web app does, including obtaining the decryption proof rather
   * than only the value — `finalizeUnwrap` re-checks the KMS signatures and releases nothing
   * without them.
   */
  async function unwrap(account: WrappedDeployment["alice"], amount: bigint): Promise<string> {
    const wrapperAddress = await d.wrapper.getAddress();

    // 1. Request: encrypt, then burn.
    const enc = await fhevm
      .createEncryptedInput(wrapperAddress, account.address)
      .add64(amount)
      .encrypt();

    const receipt = await (
      await d.wrapper
        .connect(account)
        ["unwrap(address,address,bytes32,bytes)"](
          account.address,
          account.address,
          ethers.hexlify(enc.handles[0]),
          ethers.hexlify(enc.inputProof),
        )
    ).wait();

    const requested = receipt!.logs
      .map((log) => {
        try {
          return d.wrapper.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((parsed) => parsed?.name === "UnwrapRequested");

    expect(requested, "unwrap must emit UnwrapRequested").to.not.be.undefined;
    const requestId = requested!.args.unwrapRequestId as string;

    // 2. Public decryption, with the proof finalizeUnwrap will verify.
    const proven = await fhevm.publicDecrypt([requestId]);
    const cleartext = proven.clearValues[requestId as `0x${string}`];

    // 3. Finalize: the contract re-checks the signatures before releasing anything.
    await (
      await d.wrapper
        .connect(account)
        .finalizeUnwrap(requestId, cleartext as bigint, proven.decryptionProof)
    ).wait();

    return requestId;
  }

  // -----------------------------------------------------------------------
  // Wrapping
  // -----------------------------------------------------------------------

  describe("wrapping", function () {
    it("converts the public token into a confidential balance", async function () {
      await wrap(d.alice, usd(5_000));

      expect(await confidentialBalance(d.alice)).to.equal(usd(5_000));
      expect(await d.underlying.balanceOf(d.alice.address)).to.equal(0n);
    });

    it("moves the underlying into the wrapper's custody", async function () {
      const wrapperAddress = await d.wrapper.getAddress();

      // Measured as a delta: the fixture has already wrapped a yield reserve into this same
      // wrapper, so its balance is not zero to begin with.
      const before = await d.underlying.balanceOf(wrapperAddress);
      await wrap(d.alice, usd(5_000));

      expect((await d.underlying.balanceOf(wrapperAddress)) - before).to.equal(usd(5_000));
    });

    it("keeps the confidential balance unreadable by anyone else", async function () {
      await wrap(d.alice, usd(5_000));
      const handle = await d.wrapper.confidentialBalanceOf(d.alice.address);

      await expect(fhevm.userDecryptEuint(FhevmType.euint64, handle, d.tokenAddress, d.bob)).to.be
        .rejected;
    });
  });

  // -----------------------------------------------------------------------
  // Unwrapping
  // -----------------------------------------------------------------------

  describe("unwrapping", function () {
    it("returns the public token through the full three-step flow", async function () {
      await wrap(d.alice, usd(5_000));

      await unwrap(d.alice, usd(2_000));

      expect(await confidentialBalance(d.alice)).to.equal(usd(3_000));
      expect(await d.underlying.balanceOf(d.alice.address)).to.equal(usd(2_000));
    });

    it("burns the amount at request time, before any underlying moves", async function () {
      // The two steps are separate transactions, so this ordering is observable — and it is
      // what makes an interrupted unwrap safe to resume rather than a lost balance.
      await wrap(d.alice, usd(5_000));
      const wrapperAddress = await d.wrapper.getAddress();

      const enc = await fhevm
        .createEncryptedInput(wrapperAddress, d.alice.address)
        .add64(usd(2_000))
        .encrypt();

      await (
        await d.wrapper
          .connect(d.alice)
          ["unwrap(address,address,bytes32,bytes)"](
            d.alice.address,
            d.alice.address,
            ethers.hexlify(enc.handles[0]),
            ethers.hexlify(enc.inputProof),
          )
      ).wait();

      // Confidential side already debited...
      expect(await confidentialBalance(d.alice)).to.equal(usd(3_000));
      // ...but nothing public has been released yet.
      expect(await d.underlying.balanceOf(d.alice.address)).to.equal(0n);
    });

    it("records the pending request against its receiver", async function () {
      await wrap(d.alice, usd(5_000));
      const wrapperAddress = await d.wrapper.getAddress();

      const enc = await fhevm
        .createEncryptedInput(wrapperAddress, d.alice.address)
        .add64(usd(1_000))
        .encrypt();

      const receipt = await (
        await d.wrapper
          .connect(d.alice)
          ["unwrap(address,address,bytes32,bytes)"](
            d.alice.address,
            d.alice.address,
            ethers.hexlify(enc.handles[0]),
            ethers.hexlify(enc.inputProof),
          )
      ).wait();

      const requested = receipt!.logs
        .map((log) => {
          try {
            return d.wrapper.interface.parseLog(log);
          } catch {
            return null;
          }
        })
        .find((parsed) => parsed?.name === "UnwrapRequested");

      const requestId = requested!.args.unwrapRequestId as string;
      expect(await d.wrapper.unwrapRequester(requestId)).to.equal(d.alice.address);
    });

    it("refuses to finalize an unknown request", async function () {
      await expect(
        d.wrapper.connect(d.alice).finalizeUnwrap(ethers.ZeroHash, 1n, "0x"),
      ).to.be.revertedWithCustomError(d.wrapper, "InvalidUnwrapRequest");
    });

    it("refuses to finalize the same request twice", async function () {
      await wrap(d.alice, usd(5_000));
      const requestId = await unwrap(d.alice, usd(2_000));

      // The request is consumed on finalization, so a replay finds nothing to release.
      await expect(
        d.wrapper.connect(d.alice).finalizeUnwrap(requestId, usd(2_000), "0x"),
      ).to.be.revertedWithCustomError(d.wrapper, "InvalidUnwrapRequest");

      expect(await d.underlying.balanceOf(d.alice.address)).to.equal(usd(2_000));
    });

    it("clamps an over-sized unwrap to the balance rather than reverting", async function () {
      // ERC-7984 burns are all-or-nothing on the encrypted comparison, so asking for more
      // than the balance releases nothing rather than leaking that the balance was too low.
      await wrap(d.alice, usd(1_000));
      await unwrap(d.alice, usd(9_999));

      expect(await confidentialBalance(d.alice)).to.equal(usd(1_000));
      expect(await d.underlying.balanceOf(d.alice.address)).to.equal(0n);
    });
  });

  // -----------------------------------------------------------------------
  // The full journey
  // -----------------------------------------------------------------------

  describe("public -> confidential -> Sable -> confidential -> public", function () {
    it("completes a full round trip with the saver's balance intact", async function () {
      const START = usd(10_000);

      // 1. Public tokens in hand.
      await (await d.underlying.mint(d.alice.address, START)).wait();
      expect(await d.underlying.balanceOf(d.alice.address)).to.equal(START);

      // 2. Wrap into the confidential token.
      await (await d.underlying.connect(d.alice).approve(await d.wrapper.getAddress(), START)).wait();
      await (await d.wrapper.connect(d.alice).wrap(d.alice.address, START)).wait();
      expect(await confidentialBalance(d.alice)).to.equal(START);

      // 3. Deposit into Sable.
      const expiry = (await time.latest()) + 365 * 24 * 3600;
      await (await d.wrapper.connect(d.alice).setOperator(d.sableAddress, expiry)).wait();

      const depositInput = await fhevm
        .createEncryptedInput(d.sableAddress, d.alice.address)
        .add64(START)
        .encrypt();
      await (
        await d.sable
          .connect(d.alice)
          .deposit(
            ethers.hexlify(depositInput.handles[0]),
            ethers.hexlify(depositInput.inputProof),
          )
      ).wait();

      expect(await confidentialBalance(d.alice)).to.equal(0n);

      // 4. Withdraw from Sable.
      const withdrawInput = await fhevm
        .createEncryptedInput(d.sableAddress, d.alice.address)
        .add64(START)
        .encrypt();
      await (
        await d.sable
          .connect(d.alice)
          .withdraw(
            ethers.hexlify(withdrawInput.handles[0]),
            ethers.hexlify(withdrawInput.inputProof),
          )
      ).wait();

      expect(await confidentialBalance(d.alice)).to.equal(START);

      // 5. Unwrap back to the public token.
      await unwrap(d.alice, START);

      expect(await d.underlying.balanceOf(d.alice.address)).to.equal(START);
      expect(await confidentialBalance(d.alice)).to.equal(0n);
    });
  });
});
