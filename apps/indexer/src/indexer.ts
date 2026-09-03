import { SABLE_CHAIN, deployment, sableAbi } from "@sable/config";
import { eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { createPublicClient, http, type Log, type PublicClient } from "viem";

import type { IndexerEnv } from "./env.js";
import { accountEvents, indexerState, roundTransactions, rounds } from "./schema.js";
import { WrapperIndexer } from "./wrapper-indexer.js";

/**
 * The Sable indexer.
 *
 * Polls public event logs and materialises round state into Postgres so the draw ledger can
 * be served without an RPC round trip per row, and so history survives beyond a node's log
 * retention window.
 *
 * It reads **only public data**. It holds no keys, performs no decryption, and has no code
 * path that could write a confidential value — the schema does not even have columns for
 * them. The application remains fully functional without this service; it is an
 * optimisation and an archive, not a dependency.
 */

const STATE_ID = "sable";

/** Events that advance a round, mapped to the phase they represent. */
const ROUND_PHASES: Record<string, string> = {
  RoundConfigured: "configured",
  RoundOpened: "opened",
  RoundClosed: "closed",
  EligibilityAdvanced: "eligibility",
  RoundFinalized: "finalized",
  TicketsAdvanced: "tickets",
  DrawAdvanced: "draw",
  SettlementAdvanced: "settled",
  RoundCompleted: "completed",
  RoundAggregatesPublished: "aggregates",
  RoundOutcomePublished: "outcome",
};

/** Account-scoped events. The value recorded is the *kind*, never an amount or mode. */
const ACCOUNT_KINDS: Record<string, string> = {
  PrivateDeposit: "deposit",
  PrivateWithdrawal: "withdrawal",
  PrivateModeUpdated: "mode",
  PrivateRewardsClaimed: "claim",
  ParticipantRegistered: "joined",
};

type Database = PostgresJsDatabase<Record<string, never>>;

export class SableIndexer {
  private readonly client: PublicClient;
  private readonly address: `0x${string}`;
  /** Indexes the confidential wrapper alongside the vault, when one is configured. */
  private readonly wrapperIndexer: WrapperIndexer | null;

  constructor(
    private readonly db: Database,
    private readonly env: IndexerEnv,
  ) {
    const address = env.SABLE_ADDRESS ?? deployment?.contracts.Sable.address;
    if (!address) {
      throw new Error(
        "No Sable address. Set SABLE_ADDRESS, or deploy and run `pnpm sync:abis` to generate one.",
      );
    }

    this.address = address as `0x${string}`;
    this.client = createPublicClient({
      chain: SABLE_CHAIN,
      transport: http(env.SEPOLIA_RPC_URL),
    }) as PublicClient;

    // Wrap and unwrap happen on the asset, not the vault, so they need their own log query.
    const assetAddress = deployment?.asset.address;
    this.wrapperIndexer = assetAddress
      ? new WrapperIndexer(db, this.client, assetAddress as `0x${string}`)
      : null;
  }

  /** The wrapper indexer, for callers that need pending-unwrap queries. */
  get wrapper(): WrapperIndexer | null {
    return this.wrapperIndexer;
  }

  /** Runs one catch-up pass. Returns the block indexed up to. */
  async sync(): Promise<bigint> {
    const head = await this.client.getBlockNumber();
    const safeHead = head - BigInt(this.env.CONFIRMATIONS);

    let cursor = await this.readCursor();
    if (cursor >= safeHead) return cursor;

    while (cursor < safeHead) {
      const to = min(cursor + BigInt(this.env.BLOCK_RANGE), safeHead);
      await this.indexRange(cursor + 1n, to);
      if (this.wrapperIndexer) await this.wrapperIndexer.indexRange(cursor + 1n, to);
      cursor = to;
      await this.writeCursor(cursor);
    }

    // Round *state* is not fully derivable from events alone — cursors and lifecycle flags
    // live in contract storage — so touched rounds are re-read directly.
    await this.refreshRounds();

    return cursor;
  }

  private async indexRange(fromBlock: bigint, toBlock: bigint): Promise<void> {
    const logs = await this.client.getLogs({
      address: this.address,
      fromBlock,
      toBlock,
    });

    if (logs.length === 0) return;

    const decoded = await this.decode(logs);

    for (const entry of decoded) {
      const phase = ROUND_PHASES[entry.name];
      if (phase && entry.roundId !== null) {
        await this.db
          .insert(roundTransactions)
          .values({
            roundId: entry.roundId,
            txHash: entry.txHash,
            logIndex: entry.logIndex,
            phase,
            blockNumber: entry.blockNumber,
            blockTime: entry.blockTime,
            cursor: entry.cursor,
            total: entry.total,
          })
          .onConflictDoNothing();
      }

      const kind = ACCOUNT_KINDS[entry.name];
      if (kind && entry.account) {
        await this.db
          .insert(accountEvents)
          .values({
            txHash: entry.txHash,
            logIndex: entry.logIndex,
            account: entry.account.toLowerCase(),
            kind,
            blockNumber: entry.blockNumber,
            blockTime: entry.blockTime,
          })
          .onConflictDoNothing();
      }
    }
  }

  /** Decodes logs and attaches block timestamps, batching block reads. */
  private async decode(logs: Log[]) {
    const blockTimes = new Map<bigint, Date>();

    const uniqueBlocks = [...new Set(logs.map((log) => log.blockNumber).filter(Boolean))] as bigint[];
    for (const blockNumber of uniqueBlocks) {
      const block = await this.client.getBlock({ blockNumber });
      blockTimes.set(blockNumber, new Date(Number(block.timestamp) * 1000));
    }

    const { decodeEventLog } = await import("viem");

    return logs.flatMap((log) => {
      try {
        const event = decodeEventLog({
          abi: sableAbi,
          data: log.data,
          topics: log.topics,
        }) as { eventName: string; args: Record<string, unknown> };

        const args = event.args ?? {};

        return [
          {
            name: event.eventName,
            txHash: log.transactionHash as string,
            logIndex: log.logIndex ?? 0,
            blockNumber: log.blockNumber ?? 0n,
            blockTime: blockTimes.get(log.blockNumber ?? 0n) ?? new Date(),
            roundId: "roundId" in args ? Number(args.roundId as bigint) : null,
            account: "account" in args ? (args.account as string) : null,
            cursor: "cursor" in args ? Number(args.cursor as bigint) : null,
            total: "total" in args ? Number(args.total as bigint) : null,
          },
        ];
      } catch {
        // An unrecognised log is not an error — the contract may emit events this indexer
        // predates. Skipping is correct; failing the batch would not be.
        return [];
      }
    });
  }

  /** Re-reads every round's authoritative state from the contract. */
  async refreshRounds(): Promise<void> {
    const total = (await this.client.readContract({
      address: this.address,
      abi: sableAbi,
      functionName: "roundCount",
    })) as bigint;

    for (let id = 1n; id <= total; id++) {
      const [config, state, aggregates, jackpotHit] = await Promise.all([
        this.client.readContract({
          address: this.address,
          abi: sableAbi,
          functionName: "roundConfig",
          args: [id],
        }),
        this.client.readContract({
          address: this.address,
          abi: sableAbi,
          functionName: "roundState",
          args: [id],
        }),
        this.client.readContract({
          address: this.address,
          abi: sableAbi,
          functionName: "roundAggregates",
          args: [id],
        }),
        this.client.readContract({
          address: this.address,
          abi: sableAbi,
          functionName: "roundJackpotHit",
          args: [id],
        }),
      ]);

      const c = config as Record<string, bigint | number>;
      const s = state as Record<string, bigint | number | boolean>;
      const a = aggregates as readonly string[];

      const row = {
        id: Number(id),
        state: Number(s.state),
        openedAt: toDate(s.openedAt as bigint),
        closedAt: toDate(s.closedAt as bigint),
        completedAt: toDate(s.completedAt as bigint),
        opensAt: new Date(Number(c.opensAt) * 1000),
        closesAt: new Date(Number(c.closesAt) * 1000),
        ticketBits: Number(c.ticketBits),
        maxParticipants: Number(c.maxParticipants),
        weightPerTicket: BigInt(c.weightPerTicket as bigint),
        jackpotWinnerCount: Number(c.jackpotWinnerCount),
        midWinnerCount: Number(c.midWinnerCount),
        smallWinnerCount: Number(c.smallWinnerCount),
        jackpotShareBps: Number(c.jackpotShareBps),
        midShareBps: Number(c.midShareBps),
        smallShareBps: Number(c.smallShareBps),
        participantCount: Number(s.participantCount),
        drawPointCount: Number(s.drawPointCount),
        // Handles only. Never a decrypted value.
        prizePoolHandle: a[0] ?? null,
        jackpotPrizeHandle: a[1] ?? null,
        midPrizeHandle: a[2] ?? null,
        smallPrizeHandle: a[3] ?? null,
        rolloverHandle: a[4] ?? null,
        jackpotHitHandle: (jackpotHit as string) ?? null,
        updatedAt: new Date(),
      };

      await this.db
        .insert(rounds)
        .values(row)
        .onConflictDoUpdate({ target: rounds.id, set: row });
    }
  }

  private async readCursor(): Promise<bigint> {
    const [row] = await this.db.select().from(indexerState).where(eq(indexerState.id, STATE_ID));
    if (row) return row.lastBlock;

    const start = this.env.START_BLOCK ?? deployment?.contracts.Sable.blockNumber ?? 0;
    const initial = BigInt(start);

    await this.db.insert(indexerState).values({ id: STATE_ID, lastBlock: initial }).onConflictDoNothing();
    return initial;
  }

  private async writeCursor(block: bigint): Promise<void> {
    await this.db
      .insert(indexerState)
      .values({ id: STATE_ID, lastBlock: block, healthy: true, lastError: null })
      .onConflictDoUpdate({
        target: indexerState.id,
        set: { lastBlock: block, updatedAt: new Date(), healthy: true, lastError: null },
      });
  }

  async recordFailure(error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    await this.db
      .update(indexerState)
      .set({ healthy: false, lastError: message.slice(0, 500), updatedAt: new Date() })
      .where(eq(indexerState.id, STATE_ID));
  }

  async health(): Promise<{ lastBlock: string; healthy: boolean; lastError: string | null }> {
    const [row] = await this.db.select().from(indexerState).where(eq(indexerState.id, STATE_ID));
    return {
      lastBlock: row?.lastBlock.toString() ?? "0",
      healthy: row?.healthy ?? false,
      lastError: row?.lastError ?? null,
    };
  }

  /** Total indexed rounds, used by the health endpoint. */
  async roundCount(): Promise<number> {
    const [row] = await this.db.select({ count: sql<number>`count(*)::int` }).from(rounds);
    return row?.count ?? 0;
  }
}

function min(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

function toDate(seconds: bigint): Date | null {
  return seconds > 0n ? new Date(Number(seconds) * 1000) : null;
}
