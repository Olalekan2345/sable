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

  // Ascending, so ties resolve to the earliest. `useAllRounds` walks the other way for
  // display, where newest-first is what a reader wants.
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

    type Candidate = { id: number; opensAt: number; closesAt: number; openable: boolean };
    let live: Candidate | null = null;
    let stale: Candidate | null = null;
    let upcoming: Candidate | null = null;

    for (let index = 0; index < ids.length; index += 1) {
      const state = data[index * 2]?.result as { state: number } | undefined;
      const config = data[index * 2 + 1]?.result as { opensAt: bigint; closesAt: bigint } | undefined;
      if (!state || !config) continue;
      if (Number(state.state) !== RoundState.Scheduled) continue;

      const opensAt = Number(config.opensAt);
      const closesAt = Number(config.closesAt);
      const candidate: Candidate = { id: ids[index] as number, opensAt, closesAt, openable: now >= opensAt };

      /*
       * A round whose window is *current* beats one whose window has already elapsed.
       *
       * `openRound` imposes no ordering — any scheduled round past its `opensAt` can be
       * opened — so picking the lowest id was a choice, not a constraint, and a poor one once
       * the calendar fell behind. It offered rounds whose windows had expired, which open and
       * are instantly closable: no countdown, no time to deposit, and a draw over a window
       * nobody was told about.
       *
       * Preferring a live window gives the round the interface promises: a clock ticking down
       * to a draw. Elapsed rounds remain the fallback, since running the backlog is better
       * than stalling on it.
       */
      if (now >= opensAt && now < closesAt) {
        if (!live) live = candidate;
      } else if (now >= closesAt) {
        if (!stale) stale = candidate;
      } else if (!upcoming) {
        upcoming = candidate;
      }
    }

    // Nothing openable yet: name the soonest, so the card can say when rather than nothing.
    return live ?? stale ?? upcoming;
  })();

  return { round, isLoading, refetch };
}
