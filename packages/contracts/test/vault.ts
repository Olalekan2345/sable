import { expect } from "chai";
import { ethers } from "hardhat";

import {
  balanceOf,
  deploySable,
  deposit,
  encryptAmount,
  fund,
  modeOf,
  readAmount,
  setMode,
  usd,
  walletBalanceOf,
  withdraw,
  MAX_BALANCE,
  type Deployment,
} from "./helpers";

describe("SableVault — confidential savings", function () {
  let d: Deployment;

  beforeEach(async function () {
    d = await deploySable();
    await fund(d, d.alice, usd(50_000));
    await fund(d, d.bob, usd(50_000));
  });

  // -----------------------------------------------------------------------
  // Deposits
  // -----------------------------------------------------------------------

  describe("deposit", function () {
    it("credits a first deposit and registers the participant", async function () {
      await deposit(d, d.alice, usd(1_000));

      expect(await balanceOf(d, d.alice)).to.equal(usd(1_000));
      expect(await d.sable.isParticipant(d.alice.address)).to.equal(true);
      expect(await d.sable.participantCount()).to.equal(1n);
    });

    it("accumulates additional deposits", async function () {
      await deposit(d, d.alice, usd(1_000));
      await deposit(d, d.alice, usd(250));

      expect(await balanceOf(d, d.alice)).to.equal(usd(1_250));
    });

    it("moves the tokens out of the depositor's wallet", async function () {
      const before = await walletBalanceOf(d, d.alice);
      await deposit(d, d.alice, usd(1_000));

      expect(await walletBalanceOf(d, d.alice)).to.equal(before - usd(1_000));
    });

    it("accepts a zero deposit as a no-op rather than reverting", async function () {
      // A revert here would be a side channel: it would confirm to an observer that the
      // encrypted amount was exactly zero.
      await deposit(d, d.alice, 0n);
      expect(await balanceOf(d, d.alice)).to.equal(0n);
    });

    it("credits nothing when the wallet cannot cover the amount", async function () {
      // ERC-7984 transfers are all-or-nothing: `_update` returns `select(success, amount, 0)`,
      // so an under-funded transfer yields an encrypted zero rather than a partial fill and
      // never reverts. The vault must credit that returned handle, never the requested
      // amount — crediting the request would mint savings balance out of nothing, silently.
      await fund(d, d.carol, usd(100));
      await deposit(d, d.carol, usd(5_000));

      expect(await balanceOf(d, d.carol)).to.equal(0n);
      expect(await walletBalanceOf(d, d.carol)).to.equal(usd(100));
    });

    it("credits a deposit that exactly matches the wallet balance", async function () {
      await fund(d, d.carol, usd(100));
      await deposit(d, d.carol, usd(100));

      expect(await balanceOf(d, d.carol)).to.equal(usd(100));
      expect(await walletBalanceOf(d, d.carol)).to.equal(0n);
    });

    it("clamps a deposit at the per-account confidential balance ceiling", async function () {
      // The ceiling is what keeps `balance * indexDelta` and `balance * elapsedUnits`
      // inside euint64, where overflow would wrap silently instead of reverting.
      await fund(d, d.dave, MAX_BALANCE + usd(1_000));
      await deposit(d, d.dave, MAX_BALANCE + usd(1_000));

      expect(await balanceOf(d, d.dave)).to.equal(MAX_BALANCE);
      expect(await walletBalanceOf(d, d.dave)).to.equal(usd(1_000));
    });

    it("rejects a proof bound to a different account", async function () {
      const forged = await encryptAmount(d.sableAddress, d.alice, usd(1_000));
      await expect(d.sable.connect(d.bob).deposit(forged.handle, forged.proof)).to.be.reverted;
    });

    it("rejects a proof bound to a different contract", async function () {
      const forged = await encryptAmount(d.tokenAddress, d.alice, usd(1_000));
      await expect(d.sable.connect(d.alice).deposit(forged.handle, forged.proof)).to.be.reverted;
    });

    it("reverts once the participant cap is reached", async function () {
      const small = await deploySable({ participantCap: 1 });
      await fund(small, small.alice, usd(1_000));
      await fund(small, small.bob, usd(1_000));

      await deposit(small, small.alice, usd(100));

      await expect(deposit(small, small.bob, usd(100))).to.be.revertedWithCustomError(
        small.sable,
        "ParticipantCapReached",
      );
    });

    it("emits an event that carries no amount", async function () {
      const { handle, proof } = await encryptAmount(d.sableAddress, d.alice, usd(1_000));
      const receipt = await (await d.sable.connect(d.alice).deposit(handle, proof)).wait();

      const logs = receipt!.logs
        .map((log) => {
          try {
            return d.sable.interface.parseLog(log);
          } catch {
            return null;
          }
        })
        .filter((parsed) => parsed?.name === "PrivateDeposit");

      expect(logs).to.have.lengthOf(1);
      // Address only. No amount field exists on this event at all.
      expect(logs[0]!.args.length).to.equal(1);
      expect(logs[0]!.args[0]).to.equal(d.alice.address);
    });
  });

  // -----------------------------------------------------------------------
  // ACL
  // -----------------------------------------------------------------------

  describe("access control over ciphertexts", function () {
    it("lets the owner decrypt their own balance", async function () {
      await deposit(d, d.alice, usd(1_000));
      expect(await balanceOf(d, d.alice)).to.equal(usd(1_000));
    });

    it("prevents another account from decrypting a balance", async function () {
      await deposit(d, d.alice, usd(1_000));
      const handle = await d.sable.confidentialBalanceOf(d.alice.address);

      // The handle is readable on-chain by anyone; the ACL is what makes it useless.
      await expect(readAmount(handle, d.sableAddress, d.bob)).to.be.rejected;
    });

    it("prevents an unrelated observer from decrypting a balance", async function () {
      await deposit(d, d.alice, usd(1_000));
      const handle = await d.sable.confidentialBalanceOf(d.alice.address);

      await expect(readAmount(handle, d.sableAddress, d.outsider)).to.be.rejected;
    });

    it("keeps permissions alive across repeated mutations", async function () {
      // Each FHE operation yields a *new* handle and permissions attach to handles, not to
      // storage slots — so a missing re-grant only surfaces on the second interaction.
      for (let i = 0; i < 4; i++) {
        await deposit(d, d.alice, usd(100));
        expect(await balanceOf(d, d.alice)).to.equal(usd(100 * (i + 1)));
      }
    });
  });

  // -----------------------------------------------------------------------
  // Confidential mode
  // -----------------------------------------------------------------------

  describe("confidential mode", function () {
    it("defaults to Lucky, so depositing enters the draw", async function () {
      // The default is the product decision, not an implementation detail: a saver who
      // deposits and does nothing else is in the prize pool. Steady is what you opt out to.
      await deposit(d, d.alice, usd(1_000));
      expect(await modeOf(d, d.alice)).to.equal(true);
    });

    it("stores an encrypted Steady selection", async function () {
      await deposit(d, d.alice, usd(1_000));
      await setMode(d, d.alice, false);

      expect(await modeOf(d, d.alice)).to.equal(false);
    });

    it("stores an encrypted Lucky selection", async function () {
      await deposit(d, d.alice, usd(1_000));
      await setMode(d, d.alice, true);

      expect(await modeOf(d, d.alice)).to.equal(true);
    });

    it("stores an encrypted Steady selection", async function () {
      await deposit(d, d.alice, usd(1_000));
      await setMode(d, d.alice, true);
      await setMode(d, d.alice, false);

      expect(await modeOf(d, d.alice)).to.equal(false);
    });

    it("registers an account that sets a mode before ever depositing", async function () {
      await setMode(d, d.alice, true);
      expect(await d.sable.isParticipant(d.alice.address)).to.equal(true);
      expect(await modeOf(d, d.alice)).to.equal(true);
    });

    it("hides the selection from every other account", async function () {
      await deposit(d, d.alice, usd(1_000));
      await setMode(d, d.alice, true);

      const handle = await d.sable.confidentialModeOf(d.alice.address);
      await expect(readAmount(handle, d.sableAddress, d.bob)).to.be.rejected;
      await expect(readAmount(handle, d.sableAddress, d.outsider)).to.be.rejected;
    });

    it("produces identical calldata shape and identical logs for both modes", async function () {
      // This is the property the whole design rests on: an observer sees the same function
      // selector, the same calldata length and the same event regardless of the choice.
      await deposit(d, d.alice, usd(1_000));
      await deposit(d, d.bob, usd(1_000));

      const lucky = await (await d.sable.connect(d.alice).setMode(
        ...(await encryptedModeArgs(d, d.alice, true)),
      )).wait();
      const steady = await (await d.sable.connect(d.bob).setMode(
        ...(await encryptedModeArgs(d, d.bob, false)),
      )).wait();

      const luckyTx = await ethers.provider.getTransaction(lucky!.hash);
      const steadyTx = await ethers.provider.getTransaction(steady!.hash);

      expect(luckyTx!.data.slice(0, 10)).to.equal(steadyTx!.data.slice(0, 10));
      expect(luckyTx!.data.length).to.equal(steadyTx!.data.length);

      const luckyEvents = parseNames(d, lucky!.logs);
      const steadyEvents = parseNames(d, steady!.logs);
      expect(luckyEvents).to.deep.equal(steadyEvents);
      expect(luckyEvents).to.include("PrivateModeUpdated");
    });

    it("exposes no mode-revealing function on the ABI", async function () {
      const names = d.sable.interface.fragments
        .filter((f) => f.type === "function" || f.type === "event")
        .map((f) => (f as { name?: string }).name ?? "")
        .join(" ")
        .toLowerCase();

      expect(names).to.not.include("lucky");
      expect(names).to.not.include("steady");
    });
  });

  // -----------------------------------------------------------------------
  // Withdrawals
  // -----------------------------------------------------------------------

  describe("withdraw", function () {
    beforeEach(async function () {
      await deposit(d, d.alice, usd(1_000));
    });

    it("withdraws part of a position", async function () {
      await withdraw(d, d.alice, usd(400));

      expect(await balanceOf(d, d.alice)).to.equal(usd(600));
    });

    it("withdraws a whole position", async function () {
      await withdraw(d, d.alice, usd(1_000));

      expect(await balanceOf(d, d.alice)).to.equal(0n);
    });

    it("returns the tokens to the saver's wallet", async function () {
      const before = await walletBalanceOf(d, d.alice);
      await withdraw(d, d.alice, usd(400));

      expect(await walletBalanceOf(d, d.alice)).to.equal(before + usd(400));
    });

    it("clamps an over-withdrawal to the available balance", async function () {
      // Reverting would leak whether the caller holds at least the requested amount.
      const before = await walletBalanceOf(d, d.alice);
      await withdraw(d, d.alice, usd(9_999));

      expect(await balanceOf(d, d.alice)).to.equal(0n);
      expect(await walletBalanceOf(d, d.alice)).to.equal(before + usd(1_000));
    });

    it("rejects a withdrawal from a non-participant", async function () {
      await expect(withdraw(d, d.outsider, usd(1))).to.be.revertedWithCustomError(
        d.sable,
        "NotAParticipant",
      );
    });

    it("remains available while the protocol is paused", async function () {
      // A pause that trapped principal would make the product's central promise
      // conditional on operator behaviour.
      await (await d.sable.connect(d.admin).setPaused(true)).wait();

      await withdraw(d, d.alice, usd(1_000));
      expect(await balanceOf(d, d.alice)).to.equal(0n);
    });

    it("blocks deposits while paused", async function () {
      await (await d.sable.connect(d.admin).setPaused(true)).wait();

      // Asserted through `staticCall`: the `whenNotPaused` guard reverts *before* the
      // encrypted input is consumed, and the FHEVM mock provider surfaces its own error
      // for such a send rather than the contract's revert data.
      const { handle, proof } = await encryptAmount(d.sableAddress, d.alice, usd(10));
      await expect(
        d.sable.connect(d.alice).deposit.staticCall(handle, proof),
      ).to.be.revertedWithCustomError(d.sable, "Paused");
    });
  });
});

async function encryptedModeArgs(
  d: Deployment,
  signer: Deployment["alice"],
  lucky: boolean,
): Promise<[string, string]> {
  const { fhevm } = await import("hardhat");
  const enc = await fhevm.createEncryptedInput(d.sableAddress, signer.address).addBool(lucky).encrypt();
  return [ethers.hexlify(enc.handles[0]), ethers.hexlify(enc.inputProof)];
}

function parseNames(d: Deployment, logs: readonly unknown[]): string[] {
  return logs
    .map((log) => {
      try {
        return d.sable.interface.parseLog(log as never)?.name ?? null;
      } catch {
        return null;
      }
    })
    .filter((n): n is string => n !== null)
    .sort();
}
