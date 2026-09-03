import { task, types } from "hardhat/config";
import type { HardhatRuntimeEnvironment } from "hardhat/types";

import { readDeployment } from "./deploy";

/**
 * Batch sizes derived from `test/benchmark.hcu.ts` against the protocol's 20M global /
 * 5M sequential HCU ceilings.
 *
 * Settlement is by far the heaviest phase: with the 14-point tier ladder it costs roughly
 * 7.56M HCU per participant, so only two accounts fit in a transaction. These are defaults,
 * not limits — every task accepts an override, and every phase is resumable, so an operator
 * who changes the tier shape can re-measure and re-tune without touching the contracts.
 */
export const BATCH_DEFAULTS = {
  eligibility: 8,
  tickets: 16,
  draw: 14,
  settle: 2,
} as const;

async function vault(hre: HardhatRuntimeEnvironment) {
  const deployment = readDeployment(hre);
  if (!deployment) {
    throw new Error(`No deployment found for "${hre.network.name}". Run deploy:sable first.`);
  }
  return hre.ethers.getContractAt("Sable", deployment.contracts.Sable.address);
}

const STATE_NAMES = [
  "NONE",
  "SCHEDULED",
  "OPEN",
  "CLOSING",
  "FINALIZED",
  "DRAWING",
  "SETTLING",
  "COMPLETE",
];

/**
 * Round parameters, and why the defaults are what they are.
 *
 * Two properties of a round are set here, and they turn out to be controlled by different
 * knobs — which is not obvious, and getting it wrong made the draw look broken.
 *
 * Tickets are `min(weight / weightPerTicket, 2^ticketBits / maxParticipants)`, so:
 *
 * ```
 * weighting stays proportional up to   2^ticketBits / maxParticipants  tickets
 * fraction of the domain allocated  =  actualParticipants / maxParticipants
 * ```
 *
 * The second falls out of the first: each saver is capped at `domain / maxParticipants`, so
 * however large the domain, the allocated share is just the ratio of real savers to the
 * configured maximum. **`ticketBits` therefore buys weighting range and nothing else, and
 * `maxParticipants` alone decides how often a prize is won at all** — a random point landing
 * outside the allocated span is the rollover.
 *
 * The original `2^16` over 50 participants was poor on both counts. Weighting flattened above
 * about four tokens, so every real deposit had identical odds despite the draw being
 * advertised as deposit-weighted; and with three savers only 6% of the domain was allocated,
 * so the jackpot rolled over in nineteen rounds out of twenty. A saver would have deposited,
 * waited, never won, and been right to think something was wrong.
 *
 * **`ticketBits = 24`, `maxParticipants = 10`** gives proportional weighting up to roughly
 * 4,600 tokens on a six-hour round, and with three savers pays the jackpot 30% of the time,
 * the mid tier 66% and the small tier 97%. Rollover stays a real and visible feature rather
 * than the only outcome.
 *
 * **Six hours** because prize size scales with round length, but a visitor arriving at any
 * moment should find completed rounds behind them and a live one in front. Four draws a day
 * does that while keeping the seven transactions each round costs sensible.
 */
task("round:configure", "Configures the next round")
  .addOptionalParam("duration", "Round length in seconds", 6 * 3600, types.int)
  .addOptionalParam("opensIn", "Seconds until the round may open", 0, types.int)
  .addOptionalParam("ticketBits", "Ticket domain exponent k in 2^k", 24, types.int)
  .addOptionalParam("maxParticipants", "Participants scored this round", 10, types.int)
  .addOptionalParam("weightPerTicket", "Weight required per ticket", "1000000", types.string)
  .setAction(async (args, hre) => {
    const sable = await vault(hre);
    const now = Math.floor(Date.now() / 1000);
    const opensAt = now + Number(args.opensIn);

    const config = {
      opensAt,
      closesAt: opensAt + Number(args.duration),
      ticketBits: Number(args.ticketBits),
      maxParticipants: Number(args.maxParticipants),
      weightPerTicket: BigInt(args.weightPerTicket),
      jackpotWinnerCount: 1,
      midWinnerCount: 3,
      smallWinnerCount: 10,
      jackpotShareBps: 5000,
      midShareBps: 3000,
      smallShareBps: 2000,
    };

    const tx = await sable.configureRound(config);
    await tx.wait();

    const roundId = await sable.roundCount();
    console.log(`Configured round #${roundId}`);
    console.log(`  opens  ${new Date(config.opensAt * 1000).toISOString()}`);
    console.log(`  closes ${new Date(config.closesAt * 1000).toISOString()}`);
    console.log(`  tickets 2^${config.ticketBits}, up to ${config.maxParticipants} participants`);
    console.log(`  tx ${tx.hash}`);
  });

task("round:open", "Opens a scheduled round")
  .addParam("id", "Round id", undefined, types.int)
  .setAction(async (args, hre) => {
    const sable = await vault(hre);
    const tx = await sable.openRound(args.id);
    await tx.wait();
    console.log(`Round #${args.id} open — tx ${tx.hash}`);
  });

task("round:close", "Closes an open round")
  .addParam("id", "Round id", undefined, types.int)
  .setAction(async (args, hre) => {
    const sable = await vault(hre);
    const tx = await sable.closeRound(args.id);
    await tx.wait();
    const state = await sable.roundState(args.id);
    console.log(`Round #${args.id} closing with ${state.participantCount} participants — tx ${tx.hash}`);
  });

task("round:status", "Prints a round's public state")
  .addParam("id", "Round id", undefined, types.int)
  .setAction(async (args, hre) => {
    const sable = await vault(hre);
    const state = await sable.roundState(args.id);
    const config = await sable.roundConfig(args.id);

    console.log(`\nRound #${args.id}`);
    console.log(`  state         ${STATE_NAMES[Number(state.state)]}`);
    console.log(`  window        ${new Date(Number(config.opensAt) * 1000).toISOString()}`);
    console.log(`             -> ${new Date(Number(config.closesAt) * 1000).toISOString()}`);
    console.log(`  participants  ${state.participantCount}`);
    console.log(`  eligibility   ${state.eligibilityCursor}/${state.participantCount}`);
    console.log(`  tickets       ${state.ticketCursor}/${state.participantCount}`);
    console.log(`  draws         ${state.drawCursor}/${state.drawPointCount}`);
    console.log(`  settlement    ${state.settleCursor}/${state.participantCount}`);
  });

/**
 * Drives a closed round all the way to COMPLETE, resuming wherever it currently is.
 *
 * Safe to re-run: each phase reads its cursor from chain state first, so an interrupted
 * run picks up exactly where it stopped rather than repeating work or skipping accounts.
 */
task("round:run", "Advances a round through every remaining phase")
  .addParam("id", "Round id", undefined, types.int)
  .addOptionalParam("settleBatch", "Accounts per settlement transaction", BATCH_DEFAULTS.settle, types.int)
  .setAction(async (args, hre) => {
    const sable = await vault(hre);
    const roundId = args.id;

    const refresh = async () => sable.roundState(roundId);
    let state = await refresh();

    if (Number(state.state) === 2) {
      console.log("Closing round ...");
      await (await sable.closeRound(roundId)).wait();
      state = await refresh();
    }

    const total = Number(state.participantCount);

    while (Number((await refresh()).eligibilityCursor) < total) {
      const cursor = Number((await refresh()).eligibilityCursor);
      console.log(`Eligibility ${cursor}/${total} ...`);
      await (await sable.processEligibilityBatch(roundId, BATCH_DEFAULTS.eligibility)).wait();
    }

    if (Number((await refresh()).state) === 3) {
      console.log("Finalizing (deriving prize tiers, publishing aggregates) ...");
      await (await sable.finalizeRound(roundId)).wait();
    }

    while (Number((await refresh()).ticketCursor) < total) {
      const cursor = Number((await refresh()).ticketCursor);
      console.log(`Tickets ${cursor}/${total} ...`);
      await (await sable.assignTicketsBatch(roundId, BATCH_DEFAULTS.tickets)).wait();
    }

    let current = await refresh();
    while (Number(current.drawCursor) < Number(current.drawPointCount)) {
      console.log(`Drawing ${current.drawCursor}/${current.drawPointCount} ...`);
      await (await sable.drawBatch(roundId, BATCH_DEFAULTS.draw)).wait();
      current = await refresh();
    }

    while (Number((await refresh()).settleCursor) < total) {
      const cursor = Number((await refresh()).settleCursor);
      console.log(`Settling ${cursor}/${total} ...`);
      await (await sable.settleBatch(roundId, args.settleBatch)).wait();
    }

    if (Number((await refresh()).state) === 6) {
      console.log("Completing (resolving rollover) ...");
      const tx = await sable.completeRound(roundId);
      await tx.wait();
      console.log(`Round #${roundId} complete — tx ${tx.hash}`);
    } else {
      console.log(`Round #${roundId} already complete.`);
    }
  });

/**
 * Obtains test tokens for the caller.
 *
 * The route depends on who issues the asset. On Zama's `cUSDCMock` there is no faucet on the
 * confidential token itself — the underlying ERC-20 is publicly mintable, and the
 * confidential balance is created by wrapping it. That is three transactions rather than
 * one, and the task performs all three.
 */
task("faucet", "Obtains test tokens for the caller")
  .addOptionalParam("amount", "Whole tokens to obtain", "10000", types.string)
  .setAction(async (args: { amount: string }, hre) => {
    const deployment = readDeployment(hre);
    if (!deployment) throw new Error(`No deployment found for "${hre.network.name}".`);

    const { ethers } = hre;
    const [signer] = await ethers.getSigners();
    const { asset } = deployment;
    const amount = BigInt(args.amount) * 10n ** BigInt(asset.decimals);

    if (asset.selfIssued) {
      const token = await ethers.getContractAt("SableConfidentialUSD", asset.address);
      const tx = await token.faucet();
      await tx.wait();
      console.log(`Claimed 10,000 ${asset.symbol} — tx ${tx.hash}`);
      return;
    }

    if (!asset.underlying) throw new Error("Deployment record has no underlying token address.");

    const underlying = await ethers.getContractAt("IERC20Mintable", asset.underlying);
    const wrapper = await ethers.getContractAt("IConfidentialWrapper", asset.address);

    // Obtaining `amount` confidential units needs `amount x rate` of the underlying.
    const rate: bigint = await wrapper.rate();
    const underlyingAmount = amount * rate;

    console.log(`1/3  minting ${args.amount} underlying (rate ${rate}) ...`);
    await (await underlying.mint(signer.address, underlyingAmount)).wait();

    console.log("2/3  approving the wrapper ...");
    await (await underlying.approve(asset.address, underlyingAmount)).wait();

    console.log("3/3  wrapping into a confidential balance ...");
    const tx = await wrapper.wrap(signer.address, underlyingAmount);
    await tx.wait();

    console.log(`
Obtained ${args.amount} ${asset.symbol} — tx ${tx.hash}`);
  });

/**
 * Funds the reserve-backed yield adapter.
 *
 * Only meaningful when Sable is running on an asset it does not control — on Zama's
 * `cUSDCMock` there is no minting, so yield must be paid from tokens somebody actually put
 * in. The adapter refuses to advance its index beyond what this covers, so an unfunded
 * deployment simply accrues no yield rather than crediting savers with money it cannot pay.
 */
task("reserve:fund", "Wraps underlying tokens into the yield adapter's reserve")
  .addParam("amount", "Whole tokens of the underlying to add", undefined, types.string)
  .setAction(async (args: { amount: string }, hre) => {
    const deployment = readDeployment(hre);
    if (!deployment) throw new Error(`No deployment found for "${hre.network.name}".`);

    if (deployment.parameters.adapterKind !== "reserve") {
      throw new Error(
        "This deployment uses the mint-based adapter, which needs no reserve. " +
          "reserve:fund applies only to deployments on an external confidential asset.",
      );
    }

    const { ethers } = hre;
    const [signer] = await ethers.getSigners();

    const decimals = BigInt(deployment.asset.decimals);
    const adapterAddress = deployment.contracts.YieldAdapter.address;
    const adapter = await ethers.getContractAt("SableReserveYieldAdapter", adapterAddress);

    const underlyingAddress = deployment.asset.underlying;
    if (!underlyingAddress) throw new Error("Deployment record has no underlying token address.");

    const wrapper = await ethers.getContractAt("IConfidentialWrapper", deployment.asset.address);
    const underlying = await ethers.getContractAt("IERC20Mintable", underlyingAddress);

    // The wrapper divides by `rate`, so seeding N confidential units needs N x rate of the
    // underlying. Read it from the chain: 1 over a 6-decimal token, 1e12 over an 18-decimal
    // one. Using the confidential decimals instead would fund a millionth of what was asked
    // for, silently, because the wrapped amount is a ciphertext.
    const rate: bigint = await wrapper.rate();
    const underlyingDecimals = BigInt(deployment.asset.underlyingDecimals ?? Number(decimals));
    const amount = BigInt(args.amount) * 10n ** decimals * rate;

    console.log(`Funding the reserve with ${args.amount} ${deployment.asset.symbol}`);
    console.log(`  rate ${rate}, ${ethers.formatUnits(amount, underlyingDecimals)} underlying`);

    const balance = await underlying.balanceOf(signer.address);
    if (balance < amount) {
      const needed = amount - balance;
      console.log(`  minting ${ethers.formatUnits(needed, underlyingDecimals)} underlying ...`);
      // Zama's mock caps each mint at one million; loop rather than fail on large amounts.
      const limit = 1_000_000n * 10n ** underlyingDecimals;
      let remaining = needed;
      while (remaining > 0n) {
        const chunk = remaining > limit ? limit : remaining;
        await (await underlying.mint(signer.address, chunk)).wait();
        remaining -= chunk;
      }
    }

    console.log("  approving the adapter ...");
    await (await underlying.approve(adapterAddress, amount)).wait();

    console.log("  wrapping into the reserve ...");
    const tx = await adapter.fund(amount);
    await tx.wait();

    const funded = await adapter.fundedTotal();
    const ceiling = await adapter.maxIndex();

    console.log(`\nReserve funded. tx ${tx.hash}`);
    console.log(`  fundedTotal ${ethers.formatUnits(funded, decimals)} ${deployment.asset.symbol}`);
    console.log(`  index ceiling ${ceiling} (starts at 1000000)`);
  });

/**
 * Sets the published annual rate.
 *
 * Separated from deployment because the rate is the one parameter that legitimately changes
 * after launch, and because getting it wrong is a **product** error rather than a technical
 * one: a testnet deployment publishing an implausible headline rate undermines every careful
 * claim the interface makes around it.
 *
 * The adapter accrues to the present before applying the change, so a new rate never
 * retroactively re-prices interest that already accrued under the old one.
 *
 * Note that lowering the rate lengthens the reserve's runway proportionally — the solvency
 * ceiling is fixed by `fundedTotal`, so a slower rate simply takes longer to reach it. Check
 * `reserve:status` afterwards to see the remaining headroom.
 */
task("yield:rate", "Sets the yield adapter's published annual rate")
  .addParam("bps", "Annual rate in basis points (500 = 5%)", undefined, types.string)
  .setAction(async (args: { bps: string }, hre) => {
    const deployment = readDeployment(hre);
    if (!deployment) throw new Error(`No deployment found for "${hre.network.name}".`);

    const adapter = await hre.ethers.getContractAt(
      deployment.parameters.adapterKind === "reserve"
        ? "SableReserveYieldAdapter"
        : "SableTestnetYieldAdapter",
      deployment.contracts.YieldAdapter.address,
    );

    const previous = await adapter.ratePerYearBps();
    const next = BigInt(args.bps);

    console.log(`
Rate ${previous} -> ${next} bps/year`);
    const tx = await adapter.setRate(next);
    await tx.wait();

    console.log(`  tx ${tx.hash}`);
    console.log(`  index now ${await adapter.yieldIndex()}`);
  });

task("reserve:status", "Prints the yield adapter's reserve and solvency bound").setAction(
  async (_args, hre) => {
    const deployment = readDeployment(hre);
    if (!deployment) throw new Error(`No deployment found for "${hre.network.name}".`);

    const { ethers } = hre;
    const adapter = await hre.ethers.getContractAt(
      deployment.parameters.adapterKind === "reserve"
        ? "SableReserveYieldAdapter"
        : "SableTestnetYieldAdapter",
      deployment.contracts.YieldAdapter.address,
    );

    console.log(`\nYield adapter (${deployment.parameters.adapterKind}-backed)`);
    console.log(`  asset          ${deployment.asset.symbol} ${deployment.asset.address}`);
    console.log(`  rate           ${await adapter.ratePerYearBps()} bps/year`);
    console.log(`  index          ${await adapter.yieldIndex()}`);

    if (deployment.parameters.adapterKind === "reserve") {
      const reserve = adapter as unknown as {
        fundedTotal: () => Promise<bigint>;
        maxIndex: () => Promise<bigint>;
        coveredDeposits: () => Promise<bigint>;
      };
      const decimals = deployment.asset.decimals;
      console.log(`  funded         ${ethers.formatUnits(await reserve.fundedTotal(), decimals)}`);
      console.log(`  covers up to   ${ethers.formatUnits(await reserve.coveredDeposits(), decimals)} of deposits`);
      console.log(`  index ceiling  ${await reserve.maxIndex()}`);
    }
  },
);
