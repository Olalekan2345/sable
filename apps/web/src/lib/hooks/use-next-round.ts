"use client";

import { RoundState } from "@sable/config";
import { useMemo } from "react";
import { useReadContracts } from "wagmi";

import { useNow } from "./use-rounds";
import { useProtocolState, useSableContract } from "./use-sable";

/**
 * The next round anybody is allowed to open.
 *
 * Opening a round is permissionless — `openRound` checks no role — so this is not an admin
 * affordance. It exists because a round only starts when *something* calls for it, and the
 * scheduled keeper runs late: GitHub honours a fifteen-minute cron roughly every three hours
 * in practice. Between rounds the app would otherwise show "no round is open" with nothing a
 * visitor could do but wait for a job they cannot see.
 *
 * ## Why this is not `useAllRounds`
 *
 * That hook reads three structs per round on a thirty-second interval — seventy-two calls
 * against a two-dozen-round calendar, on the most-visited page in the app. Public endpoints
 * have rate-limited this deployment repeatedly, and paying that continuously to render a
 * button that is usually not needed is the wrong trade.
 *
 * So: two calls per round instead of three, and only while `activeRoundId` is zero. Once a
 * round is open the query is disabled entirely and costs nothing.
 */
export function useNextOpenableRound() {
  const sable = useSableContract();
  const { activeRoundId, roundCount } = useProtocolState();

  // The shared second-clock, not `Date.now()`: reading the wall clock during render is
  // impure, and two components asking a moment apart would disagree about whether a round's
  // window had arrived.
  const now = useNow();

  const idle = Number(activeRoundId) === 0;
  const total = Number(roundCount);

  // Ascending, because the earliest scheduled round is the one whose turn it is. `useAllRounds`
  // walks the other way for display, where newest-first is what a reader wants.
  const ids = useMemo(
    () => (idle ? Array.from({ length: total }, (_, index) => index + 1) : []),
    [idle, total],
  );

  const enabled = Boolean(sable.address) && ids.length > 0;

  const { data, isLoading, refetch } = useReadContracts({
    contracts: enabled
      ? ids.flatMap((id) => [
          { ...sable, functionName: "roundState", args: [BigInt(id)] },
          { ...sable, functionName: "roundConfig", args: [BigInt(id)] },
        ])
      : [],
    query: { enabled },
  });

  /*
   * Derived directly rather than through `useMemo`: the compiler memoizes this on its own,
   * and a hand-written memo here is one it reports it cannot preserve.
   */
  const round = (() => {
    if (!enabled || !data) return null;

    for (let index = 0; index < ids.length; index += 1) {
      const state = data[index * 2]?.result as { state: number } | undefined;
      const config = data[index * 2 + 1]?.result as { opensAt: bigint; closesAt: bigint } | undefined;
      if (!state || !config) continue;
      if (Number(state.state) !== RoundState.Scheduled) continue;

      /*
       * A round cannot be opened before its window. Returning it anyway, with `openable`
       * false, lets the interface say *when* rather than simply offering nothing — the
       * difference between "not yet, at 14:17" and an empty card.
       */
      return {
        id: ids[index] as number,
        opensAt: Number(config.opensAt),
        closesAt: Number(config.closesAt),
        openable: now >= Number(config.opensAt),
      };
    }

    return null;
  })();

  return { round, isLoading, refetch };
}
