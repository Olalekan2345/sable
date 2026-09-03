import { confidentialWrapperAbi } from "@sable/config";
import { and, eq, isNull } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { decodeEventLog, type Log, type PublicClient } from "viem";

import { pendingUnwraps, wrapperEvents } from "./schema.js";

/**
 * Indexes wrap and unwrap activity on Zama's Confidential Wrapper.
 *
 * ## Why these events are safe to index
 *
 * Everything recorded here is already public on-chain:
 *
 * - `Wrap.roundedAmount` is the ERC-20 amount consumed, visible in the accompanying
 *   `Transfer` anyway.
 * - `UnwrapFinalized.cleartextAmount` had to be publicly decrypted before the wrapper would
 *   release anything — it is public by construction.
 * - `UnwrapRequested` carries no amount at all, only a ciphertext handle.
 *
 * Crucially, none of it reveals a Sable position. Wrapping is not depositing: a saver may
 * wrap and never deposit, or deposit an amount unrelated to what they wrapped. The deposit
 * itself is encrypted, so no link between the two is derivable from this table.
 *
 * ## The pending-unwrap ledger
 *
 * Unwrapping burns in one transaction and releases in another. A request can sit
 * half-finished indefinitely, and nothing on-chain advertises that. Tracking open requests
 * is what lets the app tell a saver they have value waiting to be collected rather than
 * leaving a balance that appears to have vanished.
 */

type Database = PostgresJsDatabase<Record<string, never>>;

export class WrapperIndexer {
  constructor(
    private readonly db: Database,
    private readonly client: PublicClient,
    private readonly wrapper: `0x${string}`,
  ) {}

  /** Indexes wrapper logs in `[fromBlock, toBlock]`. */
  async indexRange(fromBlock: bigint, toBlock: bigint): Promise<void> {
    const logs = await this.client.getLogs({
      address: this.wrapper,
      fromBlock,
      toBlock,
    });

    if (logs.length === 0) return;

    const blockTimes = new Map<bigint, Date>();
    for (const blockNumber of new Set(logs.map((l) => l.blockNumber).filter(Boolean) as bigint[])) {
      const block = await this.client.getBlock({ blockNumber });
      blockTimes.set(blockNumber, new Date(Number(block.timestamp) * 1000));
    }

    for (const log of logs) {
      const decoded = this.decode(log);
      if (!decoded) continue;

      const blockTime = blockTimes.get(log.blockNumber ?? 0n) ?? new Date();
      const base = {
        txHash: log.transactionHash as string,
        logIndex: log.logIndex ?? 0,
        wrapper: this.wrapper.toLowerCase(),
        blockNumber: log.blockNumber ?? 0n,
        blockTime,
      };

      if (decoded.eventName === "Wrap") {
        const args = decoded.args as { to: string; roundedAmount: bigint; encryptedWrappedAmount: string };
        await this.db
          .insert(wrapperEvents)
          .values({
            ...base,
            kind: "wrap",
            account: args.to.toLowerCase(),
            amount: args.roundedAmount,
            handle: args.encryptedWrappedAmount,
          })
          .onConflictDoNothing();
        continue;
      }

      if (decoded.eventName === "UnwrapRequested") {
        const args = decoded.args as { receiver: string; unwrapRequestId: string; amount: string };
        await this.db
          .insert(wrapperEvents)
          .values({
            ...base,
            kind: "unwrap_requested",
            account: args.receiver.toLowerCase(),
            // No amount: at request time the figure is still a ciphertext.
            amount: null,
            handle: args.unwrapRequestId,
          })
          .onConflictDoNothing();

        await this.db
          .insert(pendingUnwraps)
          .values({
            requestId: args.unwrapRequestId,
            wrapper: this.wrapper.toLowerCase(),
            receiver: args.receiver.toLowerCase(),
            requestedAt: blockTime,
            requestTxHash: base.txHash,
          })
          .onConflictDoNothing();
        continue;
      }

      if (decoded.eventName === "UnwrapFinalized") {
        const args = decoded.args as {
          receiver: string;
          unwrapRequestId: string;
          encryptedAmount: string;
          cleartextAmount: bigint;
        };

        await this.db
          .insert(wrapperEvents)
          .values({
            ...base,
            kind: "unwrap_finalized",
            account: args.receiver.toLowerCase(),
            amount: args.cleartextAmount,
            handle: args.unwrapRequestId,
          })
          .onConflictDoNothing();

        // Close the open request rather than deleting it: the completed pair is the useful
        // record, and a saver asking "did that unwrap go through?" wants to see both halves.
        await this.db
          .update(pendingUnwraps)
          .set({
            finalizedAt: blockTime,
            finalizeTxHash: base.txHash,
            cleartextAmount: args.cleartextAmount,
          })
          .where(eq(pendingUnwraps.requestId, args.unwrapRequestId));
      }
    }
  }

  /** Unwraps that were requested but never finalized, for a given receiver. */
  async openUnwrapsFor(receiver: string) {
    return this.db
      .select()
      .from(pendingUnwraps)
      .where(and(eq(pendingUnwraps.receiver, receiver.toLowerCase()), isNull(pendingUnwraps.finalizedAt)));
  }

  /** Every unwrap still awaiting finalization, across all accounts. */
  async allOpenUnwraps() {
    return this.db.select().from(pendingUnwraps).where(isNull(pendingUnwraps.finalizedAt));
  }

  private decode(log: Log): { eventName: string; args: unknown } | null {
    try {
      return decodeEventLog({
        abi: confidentialWrapperAbi,
        data: log.data,
        topics: log.topics,
      }) as { eventName: string; args: unknown };
    } catch {
      // The wrapper emits far more than Sable indexes — transfers, operator changes,
      // governance. Skipping an unrecognised log is correct; failing the batch is not.
      return null;
    }
  }
}
