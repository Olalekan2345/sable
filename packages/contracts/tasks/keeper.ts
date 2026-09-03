import { task, types } from "hardhat/config";
import type { HardhatRuntimeEnvironment } from "hardhat/types";

import { readDeployment } from "./deploy";
import { BATCH_DEFAULTS } from "./lifecycle";

const STATE = ["NONE", "SCHEDULED", "OPEN", "CLOSING", "FINALIZED", "DRAWING", "SETTLING", "COMPLETE"];

async function vault(hre: HardhatRuntimeEnvironment) {
  const deployment = readDeployment(hre);
  if (!deployment) throw new Error(`No deployment found for "${hre.network.name}".`);
  return hre.ethers.getContractAt("Sable", deployment.contracts.Sable.address);
}

const stamp = (seconds: number | bigint) => new Date(Number(seconds) * 1000).toISOString();

/**
 * Schedules a run of rounds in advance.
 *
 * ## Why this is separate from the keeper
 *
 * Configuring a round is the one part of the lifecycle that stays administrative: it sets the
 * window, the tier shares, the ticket domain and the participant ceiling — parameters that
 * decide how prizes are sized and how often they are won. Opening that up would let anyone
 * configure a thirty-day round scored over a single participant, which is griefing with extra
 * steps.
 *
 * So the admin lays out the calendar ahead of time and the keeper, which holds no privileges,
 * simply opens each round when its turn comes. A week of six-hour rounds is twenty-eight
 * `configureRound` calls signed once, and the keeper can then run unattended on a key that is
 * worthless if it leaks.
 */
task("rounds:schedule", "Configures a run of future rounds (admin)")
  .addOptionalParam("count", "How many rounds to schedule", 28, types.int)
  .addOptionalParam("duration", "Length of each round, in seconds", 6 * 3600, types.int)
  .addOptionalParam("ticketBits", "Ticket domain exponent k in 2^k", 24, types.int)
  .addOptionalParam("maxParticipants", "Participants scored per round", 10, types.int)
  .addOptionalParam("startIn", "Seconds until the first round opens", 0, types.int)
  .setAction(async (args, hre) => {
    const sable = await vault(hre);
    const duration = Number(args.duration);

    // Continue from wherever the calendar currently ends, so this can be run again to extend
    // it without leaving a gap or overlapping an existing window.
    const existing = Number(await sable.roundCount());
    let opensAt = Math.floor(Date.now() / 1000) + Number(args.startIn);
    if (existing > 0) {
      const last = await sable.roundConfig(existing);
      const lastCloses = Number(last.closesAt);
      if (lastCloses > opensAt) opensAt = lastCloses;
    }

    console.log(`\nScheduling ${args.count} round(s) of ${duration / 3600}h`);
    console.log(`  first opens ${stamp(opensAt)}`);

    for (let i = 0; i < Number(args.count); i += 1) {
      const config = {
        opensAt,
        closesAt: opensAt + duration,
        ticketBits: Number(args.ticketBits),
        maxParticipants: Number(args.maxParticipants),
        weightPerTicket: 1_000_000n,
        jackpotWinnerCount: 1,
        midWinnerCount: 3,
        smallWinnerCount: 10,
        jackpotShareBps: 5000,
        midShareBps: 3000,
        smallShareBps: 2000,
      };

      await (await sable.configureRound(config)).wait();
      opensAt += duration;
    }

    const total = Number(await sable.roundCount());
    const lastConfig = await sable.roundConfig(total);
    console.log(`\n${total} round(s) on the calendar`);
    console.log(`  last closes ${stamp(lastConfig.closesAt)}`);
  });

type Vault = Awaited<ReturnType<typeof vault>>;

/**
 * Performs whatever transition is currently possible, and reports whether it did anything.
 *
 * Returning a boolean rather than looping internally is what lets the caller decide how far to
 * go in one invocation. Every branch either performs work and returns `true`, or finds the
 * chain already where it should be and returns `false`.
 */
async function advance(sable: Vault, settleBatch: number): Promise<boolean> {
  const total = Number(await sable.roundCount());
  const active = Number(await sable.activeRoundId());
  const now = () => Math.floor(Date.now() / 1000);

  // Nothing is open: bring forward the earliest scheduled round whose window has arrived.
  if (active === 0) {
    for (let id = 1; id <= total; id += 1) {
      const state = await sable.roundState(id);
      if (Number(state.state) !== 1) continue;

      const config = await sable.roundConfig(id);
      if (now() < Number(config.opensAt)) {
        console.log(`\nRound #${id} opens ${stamp(config.opensAt)} — nothing to do yet`);
        return false;
      }

      console.log(`\nOpening round #${id} ...`);
      await (await sable.openRound(id)).wait();
      console.log(`  open until ${stamp(config.closesAt)}`);
      return true;
    }

    console.log("\nEvery scheduled round has run. Extend the calendar with `rounds:schedule`.");
    return false;
  }

  const roundId = active;
  const config = await sable.roundConfig(roundId);
  const refresh = async () => sable.roundState(roundId);
  let state = await refresh();

  console.log(`\nRound #${roundId} — ${STATE[Number(state.state)] ?? state.state}`);

  if (Number(state.state) === 2) {
    if (now() < Number(config.closesAt)) {
      const mins = Math.ceil((Number(config.closesAt) - now()) / 60);
      console.log(`  closes in ${mins} minute(s) — nothing to do`);
      return false;
    }
    console.log("  closing ...");
    await (await sable.closeRound(roundId)).wait();
    state = await refresh();
  }

  const scored = Number(state.participantCount);

  while (Number((await refresh()).eligibilityCursor) < scored) {
    console.log(`  eligibility ${(await refresh()).eligibilityCursor}/${scored} ...`);
    await (await sable.processEligibilityBatch(roundId, BATCH_DEFAULTS.eligibility)).wait();
  }

  if (Number((await refresh()).state) === 3) {
    console.log("  finalizing (prize tiers, published aggregates) ...");
    await (await sable.finalizeRound(roundId)).wait();
  }

  while (Number((await refresh()).ticketCursor) < scored) {
    console.log(`  tickets ${(await refresh()).ticketCursor}/${scored} ...`);
    await (await sable.assignTicketsBatch(roundId, BATCH_DEFAULTS.tickets)).wait();
  }

  let current = await refresh();
  while (Number(current.drawCursor) < Number(current.drawPointCount)) {
    console.log(`  drawing ${current.drawCursor}/${current.drawPointCount} ...`);
    await (await sable.drawBatch(roundId, BATCH_DEFAULTS.draw)).wait();
    current = await refresh();
  }

  while (Number((await refresh()).settleCursor) < scored) {
    console.log(`  settling ${(await refresh()).settleCursor}/${scored} ...`);
    await (await sable.settleBatch(roundId, settleBatch)).wait();
  }

  if (Number((await refresh()).state) === 6) {
    console.log("  completing (resolving rollover) ...");
    const tx = await sable.completeRound(roundId);
    await tx.wait();
    console.log(`  round #${roundId} complete — ${tx.hash}`);
    console.log(`  scored ${scored} participant(s)`);
  }

  return true;
}

/**
 * The keeper.
 *
 * Pushes the round state machine forward: opens a scheduled round when its window arrives,
 * closes an open one whose window has passed, then walks eligibility, ticketing, the draw and
 * settlement through to completion.
 *
 * ## It holds no privileges
 *
 * Every step it calls is permissionless. The account it runs as needs gas and nothing else —
 * no role, no ownership, no access to the reserve. That is the point of opening up round
 * advancement, and it changes what hosting this safely requires: a leaked keeper key lets
 * somebody advance rounds that were going to advance anyway, and nothing more.
 *
 * **Never give this the deployer key.** Generate a throwaway, fund it with a little Sepolia
 * ETH, and put that in CI.
 *
 * ## It is a convenience, not a dependency
 *
 * If it stops, the round stays open: deposits keep working, weight keeps accruing, and yield
 * banked between rounds waits in the carry pool. When anything runs this again — a cron, a
 * person, or a saver impatient for their prize — the round completes as normal, just later.
 * Principal stays withdrawable throughout.
 *
 * ## Runs until quiescent, then exits
 *
 * Deliberately not a `while (true)` daemon, and equally deliberately not one transition per
 * invocation. Completing a round and opening its successor are two separate transitions, so a
 * keeper that stopped after the first would leave the vault with no open round until the next
 * scheduled run — on a six-hour cadence, a six-hour hole in which nobody can enter the draw.
 *
 * Instead each invocation repeats until a pass reports the chain is already where it should
 * be, then exits. Cadence stops being load-bearing: run it every fifteen minutes or every six
 * hours and the calendar is followed either way — only the punctuality changes.
 *
 * The pass ceiling is a safety rail against an unforeseen state that reports progress without
 * making any. Reaching it is not an error; the next invocation carries on from there.
 */
task("keeper", "Advances the round state machine (permissionless)")
  .addOptionalParam("settleBatch", "Accounts per settlement transaction", BATCH_DEFAULTS.settle, types.int)
  .addOptionalParam("maxPasses", "Transitions to perform before exiting", 8, types.int)
  .setAction(async (args, hre) => {
    const { ethers } = hre;
    const signers = await ethers.getSigners();

    /*
     * Sign with the keeper key when one is configured, and say which account is being used.
     *
     * Matched on the derived address rather than a position in the array, because the array is
     * whatever `SEPOLIA_ACCOUNTS` assembled and an index would quietly sign as the wrong
     * account the moment that changed. Falling back to the deployer is deliberate: every call
     * this task makes is permissionless, so running it as the deployer is fine for a one-off.
     * It is only a bad idea on a schedule, which is why the fallback is printed rather than
     * left for someone to infer.
     */
    let signer = signers[0];
    let usingKeeperKey = false;
    const configured = process.env.KEEPER_PRIVATE_KEY;
    if (configured) {
      const wanted = new ethers.Wallet(configured).address.toLowerCase();
      const match = signers.find((s) => s.address.toLowerCase() === wanted);
      if (match) {
        signer = match;
        usingKeeperKey = true;
      }
    }
    if (!signer) {
      throw new Error("No signer configured. Set KEEPER_PRIVATE_KEY or DEPLOYER_PRIVATE_KEY.");
    }

    const sable = (await vault(hre)).connect(signer) as Vault;

    const balance = await ethers.provider.getBalance(signer.address);
    console.log(`\nKeeper ${signer.address}`);
    console.log(`  key      ${usingKeeperKey ? "KEEPER_PRIVATE_KEY" : "DEPLOYER_PRIVATE_KEY (fallback)"}`);
    console.log(`  balance  ${ethers.formatEther(balance)} ETH`);
    if (balance === 0n) throw new Error("Keeper has no ETH. Fund it before running.");

    if (Number(await sable.roundCount()) === 0) {
      console.log("\nNo rounds on the calendar. Run `rounds:schedule` first.");
      return;
    }

    const maxPasses = Number(args.maxPasses);
    for (let pass = 0; pass < maxPasses; pass += 1) {
      if (!(await advance(sable, Number(args.settleBatch)))) {
        console.log("\nNothing further to do.");
        return;
      }
    }

    console.log(`\nStopped after ${maxPasses} transitions. Run again to continue.`);
  });
