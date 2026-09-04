"use client";

import { addresses, sableAbi } from "@sable/config";
import { useQuery } from "@tanstack/react-query";
import { useAccount, useReadContract } from "wagmi";

import { publicDecrypt } from "@/lib/fhevm/instance";
import { useReveal } from "./use-reveal";
import { useRoundAggregates, type RoundSummary } from "./use-rounds";
import { useSableContract } from "./use-sable";

/**
 * What a specific round paid *this* wallet, recomputed rather than stored.
 *
 * The contract keeps one cumulative `reward` handle, so there is no per-round payout to read.
 * There does not need to be: settlement is a pure function of values that are all obtainable,
 * and the same arithmetic runs here.
 *
 * ```
 * reward = Σ over draw points p:  (ticketStart ≤ p < ticketEnd) ? tierPrize(p) : 0
 * ```
 *
 * | Input | Where it comes from |
 * | --- | --- |
 * | draw points | `drawPoints(roundId)`, made publicly decryptable at `completeRound` |
 * | which tier each point is | the public round config — the ladder is built in order |
 * | each tier's prize | `roundAggregates`, published at finalization |
 * | this wallet's ticket range | `confidentialTicketRange`, decryptable only by its owner |
 *
 * Only the last is private, and only its owner can supply it — so the figure appears for the
 * person it belongs to and for nobody else, which is the same guarantee the contract makes.
 * Nothing here weakens it: the reconstruction happens in the browser, after a signature, from
 * a value the chain will not hand to anyone else.
 *
 * ## Why this is not a second source of truth
 *
 * It is the same expression, over the same inputs, as `_settleAccount`. If it disagreed with
 * the cumulative total the contract holds, the reconstruction is wrong — which is why the
 * rewards page still shows that total as the authority and treats these as a breakdown of it.
 */
export function useRoundPayout(round: RoundSummary | null) {
  const { address } = useAccount();
  const sable = useSableContract();
  const aggregates = useRoundAggregates(round);

  const complete = round !== null && round.lifecycle.state === 7;

  // The wallet's own ticket range for this round. Revealing it is what unlocks the figure.
  const { data: range } = useReadContract({
    ...sable,
    functionName: "confidentialTicketRange",
    args: address && round ? [BigInt(round.id), address] : undefined,
    query: { enabled: Boolean(sable.address && address && complete) },
  });

  const [startHandle, endHandle] = (range as [`0x${string}`, `0x${string}`] | undefined) ?? [];

  /*
   * The wallet's stake in this round, revealed alongside the range.
   *
   * Weight and payout answer different questions — what you held, and what chance did with it
   * — and the pair is what shows the draw is random rather than a proportional distribution.
   * Bundled into the one reveal because a saver asking "how did I do in round four" wants both
   * and should not press twice; the EIP-712 authorisation is cached per session, so the extra
   * handle costs a decryption rather than another signature.
   */
  const { data: weightHandle } = useReadContract({
    ...sable,
    functionName: "confidentialWeightOf",
    args: address && round ? [BigInt(round.id), address] : undefined,
    query: { enabled: Boolean(sable.address && address && complete) },
  });

  const startReveal = useReveal(startHandle, { contractAddress: addresses.sable ?? undefined });
  const endReveal = useReveal(endHandle, { contractAddress: addresses.sable ?? undefined });
  const weightReveal = useReveal(weightHandle as `0x${string}` | undefined, {
    contractAddress: addresses.sable ?? undefined,
  });

  const start = typeof startReveal.value === "bigint" ? startReveal.value : null;
  const end = typeof endReveal.value === "bigint" ? endReveal.value : null;
  const ranged = start !== null && end !== null;

  const { data: points } = useReadContract({
    ...sable,
    abi: sableAbi,
    functionName: "drawPoints",
    args: round ? [BigInt(round.id)] : undefined,
    query: { enabled: Boolean(sable.address && complete && ranged) },
  });

  const handles = (points as `0x${string}`[] | undefined) ?? [];

  const payout = useQuery({
    queryKey: ["round-payout", round?.id, address, String(start), String(end), handles.length],
    enabled: complete && ranged && handles.length > 0 && Boolean(aggregates.aggregates),
    staleTime: Infinity,
    retry: 1,
    queryFn: async () => {
      const values = await publicDecrypt(handles);
      const drawn = handles
        .map((handle) => values[handle])
        .filter((value): value is bigint => typeof value === "bigint");

      const config = round!.config;
      const prizes = aggregates.aggregates!;

      /*
       * The ladder is built jackpot-first, then mid, then small, in that order — so a point's
       * index is its tier. Reading the order off the config rather than storing a parallel
       * array is exactly what the contract does.
       */
      const tierPrizeAt = (index: number): bigint => {
        if (index < config.jackpotWinnerCount) return prizes.jackpotPrize ?? 0n;
        if (index < config.jackpotWinnerCount + config.midWinnerCount) return prizes.midPrize ?? 0n;
        return prizes.smallPrize ?? 0n;
      };

      let total = 0n;
      const wins: { tier: "Jackpot" | "Mid" | "Small"; amount: bigint }[] = [];

      drawn.forEach((point, index) => {
        if (point < start! || point >= end!) return;
        const amount = tierPrizeAt(index);
        if (amount === 0n) return;

        total += amount;
        wins.push({
          tier:
            index < config.jackpotWinnerCount
              ? "Jackpot"
              : index < config.jackpotWinnerCount + config.midWinnerCount
                ? "Mid"
                : "Small",
          amount,
        });
      });

      return { total, wins, pointsChecked: drawn.length };
    },
  });

  return {
    /** Reveals the ticket range, which is the only private input. */
    reveal: async () => {
      await Promise.all([startReveal.reveal(), endReveal.reveal(), weightReveal.reveal()]);
    },
    hide: () => {
      startReveal.hide();
      endReveal.hide();
      weightReveal.hide();
    },
    weight: typeof weightReveal.value === "bigint" ? weightReveal.value : null,
    state: startReveal.state,
    error: startReveal.error ?? endReveal.error,
    ranged,
    result: payout.data ?? null,
    isComputing: payout.isLoading,
  };
}
