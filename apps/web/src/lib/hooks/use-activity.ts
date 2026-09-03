"use client";

import { SABLE_CHAIN, addresses, deployment } from "@sable/config";
import { useQuery } from "@tanstack/react-query";
import { createPublicClient, decodeAbiParameters, http, pad, toEventSelector } from "viem";
import { useAccount } from "wagmi";

/**
 * The saver's complete history with Sable, reconstructed from public event logs.
 *
 * Queried straight from the chain and scoped to the connected address, so no server ever
 * learns which wallet is being inspected.
 *
 * ## Three contracts, because a history does not live in one place
 *
 * The **underlying ERC-20** carries obtaining tokens, approvals and ordinary transfers; the
 * **confidential asset** carries shielding, unwrapping, vault authorisation and confidential
 * transfers; the **vault** carries deposits, withdrawals, mode changes and claims. Reading
 * only the vault showed a fraction of what someone had done and made the rest look like it
 * never happened.
 *
 * ## Public and private, marked rather than mixed
 *
 * Every entry carries a `visibility`. Some of these actions genuinely publish an amount —
 * wrapping takes a cleartext figure, an unwrap must declare what it releases, an ERC-20
 * transfer is a public ledger entry. The rest carry ciphertext and always will. Marking each
 * row is more useful than hiding the public ones, and more honest than implying everything
 * here is encrypted.
 *
 * ## Why the querying looks over-careful
 *
 * Every decision below was forced by an endpoint that fails in three ways, two of them silent:
 *
 * 1. It **rejects** ranges wider than a thousand blocks — noisy, and easy to handle.
 * 2. It **accepts** a wider range and answers with part of it, no error. Half a history
 *    vanished this way while every failure signal stayed quiet.
 * 3. It answers **concurrent** requests with empty results, also without erroring, and
 *    rate-limits sustained parallelism into outright failure.
 *
 * A short answer here is indistinguishable from a quiet period on chain, so the scan is built
 * never to provoke one: bounded windows, one request at a time, and a transport that does not
 * batch. What makes that affordable is the shape of the queries — the account sits in a known
 * topic position, so one request can ask about every contract and every event at once.
 */

export type ActivityKind =
  | "tokensReceived"
  | "tokensSent"
  | "approved"
  | "shield"
  | "unshieldRequested"
  | "unshielded"
  | "confidentialIn"
  | "confidentialOut"
  | "authorised"
  | "joined"
  | "deposit"
  | "withdrawal"
  | "mode"
  | "claim";

export type Visibility = "public" | "private";

export interface ActivityEntry {
  kind: ActivityKind;
  visibility: Visibility;
  blockNumber: bigint;
  timestamp: number | null;
  txHash: `0x${string}`;
  logIndex: number;
  /** Cleartext figure, present only where the event genuinely carries one. */
  amount?: bigint;
  /** Decimals the amount is denominated in — the underlying's, or the confidential token's. */
  decimals?: number;
}

export const ACTIVITY_LABELS: Record<ActivityKind, { title: string; detail: string }> = {
  tokensReceived: { title: "Tokens received", detail: "Public ERC-20 transfer in" },
  tokensSent: { title: "Tokens sent", detail: "Public ERC-20 transfer out" },
  approved: { title: "Wrapper approved", detail: "Spending allowance granted" },
  shield: { title: "Shielded", detail: "Converted into the confidential token" },
  unshieldRequested: { title: "Unwrap requested", detail: "Confidential amount burned" },
  unshielded: { title: "Unwrapped", detail: "Released back to the public token" },
  confidentialIn: { title: "Confidential transfer in", detail: "Amount encrypted" },
  confidentialOut: { title: "Confidential transfer out", detail: "Amount encrypted" },
  authorised: { title: "Vault authorised", detail: "Operator permission granted" },
  joined: { title: "Position opened", detail: "Account registered with the vault" },
  deposit: { title: "Deposit", detail: "Amount encrypted" },
  withdrawal: { title: "Withdrawal", detail: "Amount encrypted" },
  mode: { title: "Yield mode updated", detail: "Selection encrypted" },
  claim: { title: "Rewards moved to savings", detail: "Amount encrypted" },
};

/**
 * Where the account sits among an event's indexed parameters.
 *
 * `1` is the first indexed argument, `2` the second. A transfer appears under both, because
 * the saver may be either side of it.
 */
type Position = 1 | 2;

interface EventDef {
  contract: "underlying" | "asset" | "vault";
  signature: string;
  position: Position;
  kind: ActivityKind;
  visibility: Visibility;
}

const EVENTS: EventDef[] = [
  // The public token.
  { contract: "underlying", signature: "Transfer(address,address,uint256)", position: 1, kind: "tokensSent", visibility: "public" },
  { contract: "underlying", signature: "Transfer(address,address,uint256)", position: 2, kind: "tokensReceived", visibility: "public" },
  { contract: "underlying", signature: "Approval(address,address,uint256)", position: 1, kind: "approved", visibility: "public" },

  // The confidential asset and its wrapper.
  { contract: "asset", signature: "Wrap(address,uint256,bytes32)", position: 1, kind: "shield", visibility: "public" },
  { contract: "asset", signature: "UnwrapRequested(address,bytes32,bytes32)", position: 1, kind: "unshieldRequested", visibility: "private" },
  { contract: "asset", signature: "UnwrapFinalized(address,bytes32,bytes32,uint64)", position: 1, kind: "unshielded", visibility: "public" },
  { contract: "asset", signature: "OperatorSet(address,address,uint48)", position: 1, kind: "authorised", visibility: "public" },
  { contract: "asset", signature: "ConfidentialTransfer(address,address,bytes32)", position: 1, kind: "confidentialOut", visibility: "private" },
  { contract: "asset", signature: "ConfidentialTransfer(address,address,bytes32)", position: 2, kind: "confidentialIn", visibility: "private" },

  // The vault.
  { contract: "vault", signature: "PrivateDeposit(address)", position: 1, kind: "deposit", visibility: "private" },
  { contract: "vault", signature: "PrivateWithdrawal(address)", position: 1, kind: "withdrawal", visibility: "private" },
  { contract: "vault", signature: "PrivateModeUpdated(address)", position: 1, kind: "mode", visibility: "private" },
  { contract: "vault", signature: "PrivateRewardsClaimed(address)", position: 1, kind: "claim", visibility: "private" },
  { contract: "vault", signature: "ParticipantRegistered(address,uint32)", position: 1, kind: "joined", visibility: "public" },
];

/**
 * A client of this view's own, with JSON-RPC batching switched off.
 *
 * The shared wagmi transport batches calls made in the same tick, which is right for contract
 * reads — Multicall plus batching turns dozens of them into a couple of round trips. It is
 * wrong here, and provably so: scanning a range through the batched transport returned two
 * logs from a source where a sequential scan of the identical windows returned five. No error,
 * no rejected request; results came back attached to the wrong calls.
 */
const logClient = createPublicClient({
  chain: SABLE_CHAIN,
  transport: http(process.env.NEXT_PUBLIC_RPC_URL || undefined),
});

/** Public RPCs reject `eth_getLogs` beyond 1000 blocks; stay comfortably inside that. */
const CHUNK = 900n;

/** Roughly a month of Sepolia blocks. Beyond this the history is reported as truncated. */
const MAX_WINDOWS = 240;

/**
 * Default lookback, in blocks — roughly three days of Sepolia.
 *
 * Not anchored to the vault's deployment: two of the three contracts are Zama's and existed
 * long before Sable, so a saver's dealings with them are their history regardless of when this
 * vault went up. Anchoring it there also meant a redeploy silently erased everything anyone had
 * done, which is how the problem was found — a wallet with twenty-one events showed one.
 */
const DEFAULT_LOOKBACK_BLOCKS = 20_000;

/** Enough rejections to conclude the endpoint is not going to answer. */
const FAILURE_LIMIT = 3;

interface RawLog {
  address: `0x${string}`;
  blockNumber: `0x${string}`;
  transactionHash: `0x${string}`;
  logIndex: `0x${string}`;
  topics: `0x${string}`[];
  data: `0x${string}`;
  /**
   * Returned by most modern nodes alongside the log itself.
   *
   * Where present there is no reason to ask for the block — the timestamp arrived with the
   * data. An earlier version fetched a block per row, which is the first thing a public
   * endpoint throttles, and it failed quietly: rows rendered with a dash where the date belonged.
   */
  blockTimestamp?: `0x${string}`;
}

export function useActivity() {
  const { address } = useAccount();

  return useQuery({
    queryKey: ["activity", address, addresses.sable, addresses.asset, addresses.underlying],
    enabled: Boolean(address && addresses.sable),
    staleTime: 30_000,
    /*
     * No retry at this level. The scan reports a refusing endpoint in its own result — that is
     * what the "history may be incomplete" notice is built on — so a retry here does not
     * recover anything, it repeats a scan that already concluded and delays the saver being
     * told. Against a fully unavailable endpoint it turned forty-six requests into a hundred
     * and ninety-two, and pushed the notice out to forty-five seconds.
     */
    retry: false,
    queryFn: async () => {
      const empty = { entries: [] as ActivityEntry[], truncated: false, partial: false };
      if (!address) return empty;

      const contracts: Record<EventDef["contract"], `0x${string}` | null> = {
        underlying: addresses.underlying,
        asset: addresses.asset,
        vault: addresses.sable,
      };

      const available = EVENTS.filter((event) => contracts[event.contract]);
      if (available.length === 0) return empty;

      const toBlock = await logClient.getBlockNumber();
      const lookback = BigInt(
        process.env.NEXT_PUBLIC_ACTIVITY_LOOKBACK_BLOCKS || DEFAULT_LOOKBACK_BLOCKS,
      );
      const windowStart = toBlock > lookback ? toBlock - lookback : 0n;
      const deployedAt = deployment?.contracts.Sable.blockNumber
        ? BigInt(deployment.contracts.Sable.blockNumber)
        : windowStart;
      const fromBlock = deployedAt < windowStart ? deployedAt : windowStart;

      const account = pad(address, { size: 32 }).toLowerCase() as `0x${string}`;

      /*
       * One request per topic position, not one per contract-and-event pair.
       *
       * `eth_getLogs` takes a list of addresses and a list of signatures, so a single query can
       * ask about every contract and every event that indexes the account in the same slot.
       * Results are attributed afterwards by their own `address` and `topics[0]`. That is what
       * makes a strictly sequential scan affordable: two requests per window instead of five,
       * which more than halved a scan that had been taking the better part of a minute.
       */
      const groups = ([1, 2] as Position[])
        .map((position) => {
          const defs = available.filter((event) => event.position === position);
          return {
            position,
            addresses: [...new Set(defs.map((d) => contracts[d.contract]!))],
            selectors: [...new Set(defs.map((d) => toEventSelector(d.signature)))],
            byKey: new Map(
              defs.map((d) => [
                `${contracts[d.contract]!.toLowerCase()}:${toEventSelector(d.signature)}`,
                d,
              ]),
            ),
          };
        })
        .filter((group) => group.selectors.length > 0);

      const windows: [bigint, bigint][] = [];
      for (let from = fromBlock; from <= toBlock; from += CHUNK) {
        const to = from + CHUNK - 1n > toBlock ? toBlock : from + CHUNK - 1n;
        windows.push([from, to]);
      }

      // Oldest-first would drop the *recent* history when a range is too long to walk, and the
      // newest windows are the ones a saver came to look at.
      const truncated = windows.length > MAX_WINDOWS;
      const scanned = truncated ? windows.slice(-MAX_WINDOWS) : windows;

      const topicOf = (a: string) => pad(a as `0x${string}`, { size: 32 }).toLowerCase();
      const ZERO = topicOf("0x0000000000000000000000000000000000000000");

      /*
       * Counterparties that make a transfer the mechanical half of another row.
       *
       * Each emits a transfer *and* a richer event in the same transaction, so listing both
       * reports one action twice under two names. The two sets differ and the distinction
       * matters: a public transfer to the wrapper is the payment leg of a wrap, but one from
       * the zero address is a mint — the saver obtaining tokens, which is real history.
       */
      const mechanicalPublic = new Set([addresses.asset].filter(Boolean).map((a) => topicOf(a!)));
      const mechanicalConfidential = new Set(
        [addresses.sable].filter(Boolean).map((a) => topicOf(a!)).concat(ZERO),
      );

      const underlyingDecimals = deployment?.asset.underlyingDecimals ?? 6;
      const assetDecimals = deployment?.asset.decimals ?? 6;

      let partial = false;
      let rejections = 0;
      const entries: ActivityEntry[] = [];
      const seen = new Set<string>();

      type Group = (typeof groups)[number];

      const fetchWindow = async (group: Group, from: bigint, to: bigint) => {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            return (await logClient.request({
              method: "eth_getLogs",
              params: [
                {
                  address: group.addresses,
                  topics:
                    group.position === 1
                      ? [group.selectors, account]
                      : [group.selectors, null, account],
                  fromBlock: `0x${from.toString(16)}`,
                  toBlock: `0x${to.toString(16)}`,
                },
              ],
            } as never)) as RawLog[];
          } catch {
            rejections += 1;
            // Once the endpoint has refused this many times, further retries only delay a
            // conclusion the first few failures already established.
            if (rejections >= FAILURE_LIMIT) break;
            await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
          }
        }
        return null;
      };

      /*
       * Windows strictly in sequence; the two topic positions within a window together.
       *
       * Two in flight is the most this endpoint answers reliably — at four it began returning
       * empty results with no error, and at twenty it rate-limited into outright failure. Both
       * were verified against a sequential scan of the same range, which is the only reading
       * that can be trusted here.
       */
      for (const [from, to] of scanned) {
        const answers = await Promise.all(groups.map((group) => fetchWindow(group, from, to)));

        for (const [index, logs] of answers.entries()) {
          const group = groups[index]!;

          if (logs === null) {
            partial = true;
            continue;
          }

          for (const log of logs) {
            const def = group.byKey.get(`${log.address.toLowerCase()}:${log.topics[0]}`);
            if (!def) continue;

            const counterparties = [
              log.topics[1]?.toLowerCase() ?? "",
              log.topics[2]?.toLowerCase() ?? "",
            ];
            const isPublicTransfer = def.kind === "tokensSent" || def.kind === "tokensReceived";
            const isConfidentialTransfer =
              def.kind === "confidentialIn" || def.kind === "confidentialOut";

            if (isPublicTransfer && counterparties.some((c) => mechanicalPublic.has(c))) continue;
            if (
              isConfidentialTransfer &&
              counterparties.some((c) => mechanicalConfidential.has(c))
            ) {
              continue;
            }

            // A self-transfer matches on both topic positions.
            const key = `${log.transactionHash}-${log.logIndex}`;
            if (seen.has(key)) continue;
            seen.add(key);

            entries.push({
              kind: def.kind,
              visibility: def.visibility,
              blockNumber: BigInt(log.blockNumber),
              timestamp: log.blockTimestamp ? Number(BigInt(log.blockTimestamp)) : null,
              txHash: log.transactionHash,
              logIndex: Number(BigInt(log.logIndex)),
              amount: readAmount(def.kind, log.data),
              decimals:
                def.contract === "underlying" || def.kind === "shield"
                  ? underlyingDecimals
                  : assetDecimals,
            });
          }
        }
      }

      entries.sort((a, b) =>
        a.blockNumber === b.blockNumber
          ? b.logIndex - a.logIndex
          : a.blockNumber > b.blockNumber
            ? -1
            : 1,
      );

      // Fill in any timestamp the node did not send with the log itself. Almost always none.
      const missing = [
        ...new Set(entries.filter((e) => e.timestamp === null).map((e) => e.blockNumber)),
      ].slice(0, 40);

      for (const blockNumber of missing) {
        try {
          const block = await logClient.getBlock({ blockNumber });
          for (const entry of entries) {
            if (entry.blockNumber === blockNumber) entry.timestamp = Number(block.timestamp);
          }
        } catch {
          // A missing timestamp renders as a dash rather than failing the whole list.
        }
      }

      return { entries, truncated, partial };
    },
  });
}

/** Pulls the cleartext figure out of the events that carry one. */
function readAmount(kind: ActivityKind, data: `0x${string}`): bigint | undefined {
  try {
    switch (kind) {
      case "tokensSent":
      case "tokensReceived":
      case "approved":
        return decodeAbiParameters([{ type: "uint256" }], data)[0];
      case "shield":
        // Wrap(address indexed to, uint256 roundedAmount, bytes32 encryptedWrappedAmount)
        return decodeAbiParameters([{ type: "uint256" }, { type: "bytes32" }], data)[0];
      case "unshielded":
        // UnwrapFinalized(receiver, id, bytes32 encryptedAmount, uint64 cleartextAmount)
        return decodeAbiParameters([{ type: "bytes32" }, { type: "uint64" }], data)[1];
      default:
        return undefined;
    }
  } catch {
    // A shape change should cost the amount, not the row.
    return undefined;
  }
}
