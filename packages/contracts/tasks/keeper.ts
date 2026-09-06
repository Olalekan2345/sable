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
  .addOptionalParam("duration", "Length of each round, in seconds", 12 * 3600, types.int)
  .addOptionalParam("ticketBits", "Ticket domain exponent k in 2^k", 24, types.int)
  .addOptionalParam("maxParticipants", "Participants scored per round", 5, types.int)
  .addOptionalParam("startIn", "Seconds until the first round opens", 0, types.int)
  /*
   * Weight per ticket, derived from the round length unless given.
   *
   * Weight is `balance x minutes held`, so the tokens needed to reach a full ticket share
   * scale with the window. Pinning this to a constant while the duration moved is a mistake
   * already made twice here — once inverted, once left behind — and both times the symptom
   * was the same: savers far below the cap, most of the ticket domain unallocated, and the
   * jackpot rolling forward instead of paying out.
   *
   * The default keeps a full share at roughly 5,600 tokens, which one faucet press covers, at
   * any duration. Pass a value to override.
   */
  .addOptionalParam("weightPerTicket", "Weight units per ticket (0 derives it)", 0, types.int)
  .setAction(async (args, hre) => {
    const sable = await vault(hre);
    const duration = Number(args.duration);

    // 1e5 suits an hour; scale linearly so the token cap holds at any window.
    const weightPerTicket =
      Number(args.weightPerTicket) > 0
        ? Number(args.weightPerTicket)
        : Math.max(Math.round((100_000 * (duration / 60)) / 60), 1);

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
    console.log(`  first opens      ${stamp(opensAt)}`);
    console.log(`  ticket domain    2^${args.ticketBits}, ${args.maxParticipants} participant slots`);

    // The numbers that decide whether prizes actually land, stated up front rather than left
    // to be inferred from an empty round.
    const capTickets = 2 ** Number(args.ticketBits) / Number(args.maxParticipants);
    const capTokens = (capTickets * weightPerTicket) / (duration / 60) / 1e6;
    console.log(`  per-saver cap    ${capTickets.toLocaleString()} tickets`);
    console.log(`  reached at       ~${capTokens.toFixed(0)} tokens held all round`);
    console.log(`  full allocation  needs ${args.maxParticipants} savers at that cap`);

    for (let i = 0; i < Number(args.count); i += 1) {
      const config = {
        opensAt,
        closesAt: opensAt + duration,
        ticketBits: Number(args.ticketBits),
        maxParticipants: Number(args.maxParticipants),
        weightPerTicket: BigInt(weightPerTicket),
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
 * Waits until a read reflects a write that has already been mined.
 *
 * A mined transaction is not the same as a node that will tell you about it. Public endpoints
 * sit behind pools of replicas at different heights, so the read immediately after a write can
 * be served by one that has not caught up — and the keeper, which decides what to do next
 * entirely from chain state, then takes a branch based on the past.
 *
 * Not hypothetical: after opening a round, the next pass read `activeRoundId` as 0, concluded
 * nothing was open, and tried to open the *following* round on top of it. That transaction was
 * doomed, and the plugin surfaced it as an unrelated initialisation error — a long way from
 * the actual cause.
 *
 * Polling the one value that was just changed is enough. Giving up quietly is deliberate:
 * every step is idempotent against on-chain cursors, so the worst case is the next invocation
 * doing what this one could not confirm.
 */
async function settle(sable: Vault, roundId: number, expectedState: number): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const state = Number((await sable.roundState(roundId)).state);
    if (state === expectedState) return;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
}

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

  /*
   * Nothing is open: bring forward a round, preferring one whose window is actually running.
   *
   * This used to take the lowest scheduled id, which is right only while the calendar keeps
   * pace with the clock. Once the keeper falls behind — and it does, since GitHub honours an
   * hourly cron loosely — the front of the queue fills with rounds whose windows have already
   * elapsed. Opening one of those is close to pointless: it is instantly closable, so there is
   * no countdown, nobody can deposit into it, and it draws over a window nobody was told
   * about. Worse, each costs a full round of settlement gas to clear.
   *
   * `openRound` imposes no ordering, so preferring a live window is free. Elapsed rounds stay
   * as the fallback, because working through a backlog is better than stalling on it.
   */
  if (active === 0) {
    let live: number | null = null;
    let stale: number | null = null;
    let upcoming: { id: number; opensAt: number } | null = null;

    for (let id = 1; id <= total; id += 1) {
      const state = await sable.roundState(id);
      if (Number(state.state) !== 1) continue;

      const config = await sable.roundConfig(id);
      const opensAt = Number(config.opensAt);
      const closesAt = Number(config.closesAt);

      if (now() >= opensAt && now() < closesAt) {
        live = id;
        break;
      }
      if (now() >= closesAt) stale ??= id;
      else upcoming ??= { id, opensAt };
    }

    const chosen = live ?? stale;
    if (chosen === null) {
      if (upcoming) {
        console.log(`\nRound #${upcoming.id} opens ${stamp(upcoming.opensAt)} — nothing to do yet`);
      } else {
        console.log("\nEvery scheduled round has run. Extend the calendar with `rounds:schedule`.");
      }
      return false;
    }

    const config = await sable.roundConfig(chosen);
    console.log(`\nOpening round #${chosen}${live === null ? " (window already elapsed)" : ""} ...`);
    await (await sable.openRound(chosen)).wait();
    await settle(sable, chosen, 2);
    console.log(`  open until ${stamp(config.closesAt)}`);
    return true;
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
    await settle(sable, roundId, 7);
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
    /*
     * Stop before starting, rather than failing partway through.
     *
     * A zero check was not enough. Settlement is the expensive step by a wide margin — one
     * `settleBatch` measured 4.2M gas, around 0.0043 ETH at 1 gwei — so a balance that looks
     * healthy next to an `openRound` still dies mid-round, leaving a part-settled round and a
     * stack trace in CI. Which is exactly what happened: 0.0004 ETH left, 0.0043 needed.
     *
     * Being out of gas is not a malfunction, and reporting it as one trains people to ignore
     * the alert. So this exits cleanly with a GitHub warning annotation: the run stays green,
     * the notice is visible on the workflow, and no failure email goes out for a wallet that
     * simply needs topping up.
     *
     * Nothing is lost by stopping here. Every step is idempotent against on-chain cursors, so
     * a round left part-advanced resumes from where it stopped once the keeper has gas.
     */
    const RESERVE = ethers.parseEther("0.012"); // ~one full round, measured rather than guessed

    const lowOnGas = (remaining: bigint) => {
      console.log(`::warning::Keeper ${signer.address} is low on gas.`);
      console.log(`\n  Has   ${ethers.formatEther(remaining)} ETH`);
      console.log(`  Needs ${ethers.formatEther(RESERVE)} ETH for a full round`);
      console.log("\n  Rounds do not advance until it is funded. Nothing is broken: every");
      console.log("  step resumes from its on-chain cursor, so topping up is all that is needed.");
    };

    if (balance < RESERVE) {
      lowOnGas(balance);
      return;
    }

    if (Number(await sable.roundCount()) === 0) {
      console.log("\nNo rounds on the calendar. Run `rounds:schedule` first.");
      return;
    }

    const maxPasses = Number(args.maxPasses);
    for (let pass = 0; pass < maxPasses; pass += 1) {
      /*
       * Re-checked every pass, not just at startup.
       *
       * One invocation completes several rounds, and a balance that comfortably covered the
       * first will not cover the third. Checking once at the top caught an empty wallet and
       * missed the commoner case — running dry partway through — which surfaces as a
       * settleBatch reverting for funds: a stack trace, a red run, and an email about a
       * wallet that only needs topping up.
       */
      const remaining = await ethers.provider.getBalance(signer.address);
      if (remaining < RESERVE) {
        lowOnGas(remaining);
        return;
      }

      let acted: boolean;
      try {
        acted = await advance(sable, Number(args.settleBatch));
      } catch (error) {
        // A price rise between that check and the transaction lands here, and it is the same
        // non-event. Anything else rethrows — a genuine failure should still be loud.
        const message = error instanceof Error ? error.message : String(error);
        if (!/insufficient funds/i.test(message)) throw error;
        lowOnGas(await ethers.provider.getBalance(signer.address));
        return;
      }

      if (!acted) {
        console.log("\nNothing further to do.");
        return;
      }
    }

    console.log(`\nStopped after ${maxPasses} transitions. Run again to continue.`);
  });

/**
 * A round that starts now, for filming or a walkthrough.
 *
 * The scheduled calendar is laid out in advance and falls behind whenever the keeper misses
 * its window, so the next round on it is often one whose window has already elapsed. Those
 * open and are immediately closable — useful for clearing a backlog, useless for showing
 * anybody a countdown, and they draw over a window nobody had a chance to deposit in.
 *
 * This configures a single round beginning a minute from now, which is long enough to open it
 * on camera and short enough to draw before an audience loses interest.
 *
 * `openRound` imposes no ordering — any scheduled round past its `opensAt` may be opened — so
 * this coexists with the calendar rather than disturbing it.
 *
 * `weightPerTicket` scales with the window. Weight is `balance x minutes`, so a fifteen-minute
 * round accrues a twenty-fourth of a six-hour one; left at the calendar's value, nobody would
 * come close to a full ticket share and most of the domain would go unallocated, which is what
 * makes a jackpot roll over instead of paying out.
 */
task("round:demo", "Configures a short round starting now (admin)")
  .addOptionalParam("minutes", "How long the round should run", 20, types.int)
  .addOptionalParam("maxParticipants", "Participants scored", 5, types.int)
  .setAction(async (args, hre) => {
    const sable = await vault(hre);
    const minutes = Number(args.minutes);
    if (minutes < 5) throw new Error("The contract enforces a five-minute minimum.");

    const opensAt = Math.floor(Date.now() / 1000) + 60;
    const closesAt = opensAt + minutes * 60;

    /*
     * 1e5 suits an hour, and this scales *with* the window, not against it.
     *
     * tickets = balance x minutes / weightPerTicket, so holding the token cap fixed as the
     * window shrinks means shrinking weightPerTicket in step. Inverting that — which this did
     * at first — quadrupled the tokens needed for a full share on a half-hour round, leaving
     * most of the ticket domain unallocated and the jackpot rolling over.
     */
    const weightPerTicket = BigInt(Math.max(Math.round((100_000 * minutes) / 60), 1));

    await (
      await sable.configureRound({
        opensAt,
        closesAt,
        ticketBits: 24,
        maxParticipants: Number(args.maxParticipants),
        weightPerTicket,
        jackpotWinnerCount: 1,
        midWinnerCount: 3,
        smallWinnerCount: 10,
        jackpotShareBps: 5000,
        midShareBps: 3000,
        smallShareBps: 2000,
      })
    ).wait();

    const id = Number(await sable.roundCount());
    const capTickets = 2 ** 24 / Number(args.maxParticipants);
    console.log(`\nRound #${id} — ${minutes} minutes`);
    console.log(`  opens  ${stamp(opensAt)}`);
    console.log(`  closes ${stamp(closesAt)}`);
    console.log(`  a full ticket share needs ~${Math.round((capTickets * Number(weightPerTicket)) / minutes / 1e6)} tokens held throughout`);
    console.log(`\nOpen it from the overview, or: npx hardhat keeper --network ${hre.network.name}`);
  });
