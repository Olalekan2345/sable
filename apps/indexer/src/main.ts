import { serve } from "@hono/node-server";
import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { Hono } from "hono";
import postgres from "postgres";

import { loadEnv } from "./env.js";
import { SableIndexer } from "./indexer.js";
import { accountEvents, roundTransactions, rounds, wrapperEvents } from "./schema.js";

/**
 * Indexer entry point.
 *
 * Runs the poll loop and serves a small read-only API over public round metadata.
 *
 * Every response here is derived from data that is already public on Sepolia. There is no
 * endpoint that returns a balance, a mode, a weight or a reward, because none of those are
 * stored — see `schema.ts`.
 */

const env = loadEnv();
const sql = postgres(env.DATABASE_URL, { max: 5 });
const db = drizzle(sql);
const indexer = new SableIndexer(db, env);

const once = process.argv.includes("--once");

const app = new Hono();

app.get("/health", async (context) => {
  const [health, count] = await Promise.all([indexer.health(), indexer.roundCount()]);
  const openUnwraps = (await indexer.wrapper?.allOpenUnwraps())?.length ?? 0;
  return context.json({ ...health, rounds: count, openUnwraps });
});

app.get("/rounds", async (context) => {
  const rows = await db.select().from(rounds).orderBy(desc(rounds.id));
  return context.json(rows.map(serialize));
});

app.get("/rounds/:id", async (context) => {
  const id = Number.parseInt(context.req.param("id"), 10);
  if (!Number.isFinite(id)) return context.json({ error: "Invalid round id" }, 400);

  const [round] = await db.select().from(rounds).where(eq(rounds.id, id));
  if (!round) return context.json({ error: "Round not found" }, 404);

  const transactions = await db
    .select()
    .from(roundTransactions)
    .where(eq(roundTransactions.roundId, id))
    .orderBy(roundTransactions.blockNumber);

  return context.json({ ...serialize(round), transactions: transactions.map(serialize) });
});

/**
 * Wrap and unwrap history for one address.
 *
 * Amounts here are public by construction — a wrap consumed a visible ERC-20 transfer, and a
 * finalized unwrap required a public decryption before anything was released. Nothing in
 * this response reveals a Sable position.
 */
app.get("/accounts/:address/wrapper", async (context) => {
  const address = context.req.param("address").toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(address)) {
    return context.json({ error: "Invalid address" }, 400);
  }

  const rows = await db
    .select()
    .from(wrapperEvents)
    .where(eq(wrapperEvents.account, address))
    .orderBy(desc(wrapperEvents.blockNumber));

  return context.json(rows.map(serialize));
});

/**
 * Unwraps that were burned but never finalized.
 *
 * The value is recoverable — the request can still be finalized — but nothing on-chain
 * advertises that it is waiting. This endpoint is what lets a client say so.
 */
app.get("/accounts/:address/pending-unwraps", async (context) => {
  const address = context.req.param("address").toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(address)) {
    return context.json({ error: "Invalid address" }, 400);
  }

  const open = await indexer.wrapper?.openUnwrapsFor(address);
  return context.json((open ?? []).map(serialize));
});

/**
 * Activity for one address.
 *
 * Returns only what the chain already publishes: that an address acted, and when. The
 * `kind` is the event name — never the mode's value, and never an amount.
 */
app.get("/accounts/:address/events", async (context) => {
  const address = context.req.param("address").toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(address)) {
    return context.json({ error: "Invalid address" }, 400);
  }

  const rows = await db
    .select()
    .from(accountEvents)
    .where(eq(accountEvents.account, address))
    .orderBy(desc(accountEvents.blockNumber));

  return context.json(rows.map(serialize));
});

/** `bigint` is not JSON-serialisable; render as a decimal string. */
function serialize<T extends Record<string, unknown>>(row: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = typeof value === "bigint" ? value.toString() : value;
  }
  return out;
}

async function loop(): Promise<void> {
  for (;;) {
    try {
      const block = await indexer.sync();
      console.log(`[indexer] synced to block ${block}`);
    } catch (error) {
      console.error("[indexer] sync failed:", error instanceof Error ? error.message : error);
      await indexer.recordFailure(error);
    }

    await new Promise((resolve) => setTimeout(resolve, env.POLL_INTERVAL * 1000));
  }
}

async function main(): Promise<void> {
  if (once) {
    const block = await indexer.sync();
    console.log(`[indexer] synced to block ${block}`);
    await sql.end();
    return;
  }

  serve({ fetch: app.fetch, port: env.PORT });
  console.log(`[indexer] API listening on :${env.PORT}`);

  await loop();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
