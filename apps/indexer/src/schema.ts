import {
  bigint,
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * Indexer schema.
 *
 * ## The rule this schema exists to enforce
 *
 * **If something is confidential on-chain, it does not get a column here.** Recreating a
 * plaintext surveillance database beside an encrypted protocol would defeat the entire
 * point — the ciphertext would be immaculate and the answers would be in Postgres.
 *
 * So there is no balance column, no mode column, no weight, no ticket range, no reward, and
 * no per-account amount of any kind. Those values are not merely omitted from writes: there
 * is nowhere to put them.
 *
 * What is indexed is round mechanics and transaction metadata that is already public on
 * Sepolia. The `account_events` table is the closest thing to user data, and it records only
 * *that* an address acted and *when* — exactly what the on-chain event itself contains.
 */

/** Round lifecycle and public configuration. */
export const rounds = pgTable(
  "rounds",
  {
    id: integer("id").primaryKey(),

    // Lifecycle
    state: smallint("state").notNull(),
    openedAt: timestamp("opened_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),

    // Public configuration
    opensAt: timestamp("opens_at", { withTimezone: true }).notNull(),
    closesAt: timestamp("closes_at", { withTimezone: true }).notNull(),
    ticketBits: smallint("ticket_bits").notNull(),
    maxParticipants: integer("max_participants").notNull(),
    weightPerTicket: bigint("weight_per_ticket", { mode: "bigint" }).notNull(),
    jackpotWinnerCount: smallint("jackpot_winner_count").notNull(),
    midWinnerCount: smallint("mid_winner_count").notNull(),
    smallWinnerCount: smallint("small_winner_count").notNull(),
    jackpotShareBps: integer("jackpot_share_bps").notNull(),
    midShareBps: integer("mid_share_bps").notNull(),
    smallShareBps: integer("small_share_bps").notNull(),

    // Aggregate counts. Never per-account.
    participantCount: integer("participant_count").notNull().default(0),
    drawPointCount: integer("draw_point_count").notNull().default(0),

    /**
     * Ciphertext *handles* for the round's publicly decryptable aggregates.
     *
     * Storing a handle is safe: it is a public identifier, not a value, and it is useless
     * without an ACL grant. Clients resolve these through the relayer themselves — the
     * indexer never decrypts and never stores a decrypted figure, so a database compromise
     * yields no financial data.
     */
    prizePoolHandle: text("prize_pool_handle"),
    jackpotPrizeHandle: text("jackpot_prize_handle"),
    midPrizeHandle: text("mid_prize_handle"),
    smallPrizeHandle: text("small_prize_handle"),
    rolloverHandle: text("rollover_handle"),
    jackpotHitHandle: text("jackpot_hit_handle"),

    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("rounds_state_idx").on(table.state)],
);

/** Transactions that advanced a round, for the verification timeline. */
export const roundTransactions = pgTable(
  "round_transactions",
  {
    roundId: integer("round_id").notNull(),
    txHash: text("tx_hash").notNull(),
    logIndex: integer("log_index").notNull(),

    /** `opened`, `closed`, `eligibility`, `finalized`, `tickets`, `draw`, `settled`, `completed`. */
    phase: text("phase").notNull(),

    blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
    blockTime: timestamp("block_time", { withTimezone: true }).notNull(),

    /** Cursor progress after this transaction, for rendering batch progress. */
    cursor: integer("cursor"),
    total: integer("total"),
  },
  (table) => [
    primaryKey({ columns: [table.txHash, table.logIndex] }),
    index("round_tx_round_idx").on(table.roundId),
  ],
);

/**
 * Generic account activity.
 *
 * Mirrors exactly what Sable's events contain: an address, a kind, and a timestamp. There
 * is deliberately no amount column — the protocol's events do not carry one, and adding a
 * nullable column here would invite a future change to start populating it.
 */
export const accountEvents = pgTable(
  "account_events",
  {
    txHash: text("tx_hash").notNull(),
    logIndex: integer("log_index").notNull(),
    account: text("account").notNull(),

    /** `deposit`, `withdrawal`, `mode`, `claim`, `joined`. Never the mode's value. */
    kind: text("kind").notNull(),

    blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
    blockTime: timestamp("block_time", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.txHash, table.logIndex] }),
    index("account_events_account_idx").on(table.account),
    index("account_events_block_idx").on(table.blockNumber),
  ],
);

/** Indexer checkpoint, so restarts resume rather than rescan. */
export const indexerState = pgTable("indexer_state", {
  id: text("id").primaryKey(),
  lastBlock: bigint("last_block", { mode: "bigint" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  healthy: boolean("healthy").notNull().default(true),
  lastError: text("last_error"),
});

/**
 * Wrap and unwrap activity on the confidential wrapper.
 *
 * These are the boundary crossings between the public token economy and the confidential
 * one, and they are the *only* points where an amount is legitimately public:
 *
 * - `Wrap` carries `roundedAmount`, the public ERC-20 consumed. Public because it was an
 *   ordinary ERC-20 transfer that anyone could already read.
 * - `UnwrapFinalized` carries `cleartextAmount`, which had to be publicly decrypted before
 *   the wrapper would release anything.
 *
 * Indexing them is therefore not a privacy regression: both figures are already on-chain in
 * plaintext, and neither reveals a Sable position. What is *not* recorded is any link
 * between a wrap and a subsequent deposit — the deposit amount stays encrypted, so no such
 * link is derivable from this table.
 *
 * `UnwrapRequested` records no amount at all: at request time the figure is still a
 * ciphertext, and only the handle exists.
 */
export const wrapperEvents = pgTable(
  "wrapper_events",
  {
    txHash: text("tx_hash").notNull(),
    logIndex: integer("log_index").notNull(),

    /** `wrap`, `unwrap_requested`, or `unwrap_finalized`. */
    kind: text("kind").notNull(),

    /** The wrapper contract, so a deployment can index more than one asset. */
    wrapper: text("wrapper").notNull(),
    account: text("account").notNull(),

    /**
     * Public amount in underlying units for a wrap, or confidential units for a finalized
     * unwrap. Null for a request, where the amount is still encrypted.
     */
    amount: bigint("amount", { mode: "bigint" }),

    /** Ciphertext handle, which for an unwrap is also the request id. */
    handle: text("handle"),

    blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
    blockTime: timestamp("block_time", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.txHash, table.logIndex] }),
    index("wrapper_events_account_idx").on(table.account),
    index("wrapper_events_kind_idx").on(table.kind),
    index("wrapper_events_handle_idx").on(table.handle),
  ],
);

/**
 * Unwrap requests that have not been finalized.
 *
 * An unwrap burns the confidential amount in one transaction and releases the underlying in
 * another, so a request can sit half-completed indefinitely — the saver closed the tab, the
 * relayer was briefly unavailable, gas ran out. Those tokens are not lost, but nothing
 * on-chain surfaces them either.
 *
 * Tracking them lets the app tell a saver they have value waiting, which is the difference
 * between a recoverable interruption and an apparently vanished balance.
 */
export const pendingUnwraps = pgTable(
  "pending_unwraps",
  {
    /** The request id, which is the burned amount's ciphertext handle. */
    requestId: text("request_id").primaryKey(),
    wrapper: text("wrapper").notNull(),
    receiver: text("receiver").notNull(),

    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull(),
    requestTxHash: text("request_tx_hash").notNull(),

    /** Set once finalized; a null value means the request is still outstanding. */
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    finalizeTxHash: text("finalize_tx_hash"),
    /** Released amount, known only after the public decryption that finalization requires. */
    cleartextAmount: bigint("cleartext_amount", { mode: "bigint" }),
  },
  (table) => [
    index("pending_unwraps_receiver_idx").on(table.receiver),
    index("pending_unwraps_open_idx").on(table.finalizedAt),
  ],
);

export type WrapperEvent = typeof wrapperEvents.$inferSelect;
export type PendingUnwrap = typeof pendingUnwraps.$inferSelect;

export type Round = typeof rounds.$inferSelect;
export type RoundTransaction = typeof roundTransactions.$inferSelect;
export type AccountEvent = typeof accountEvents.$inferSelect;
