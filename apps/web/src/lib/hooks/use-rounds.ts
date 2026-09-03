"use client";

import {
  RoundState,
  SABLE_CHAIN_ID,
  addresses,
  sableAbi,
  type RoundAggregates,
  type RoundConfig,
  type RoundLifecycle,
} from "@sable/config";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useSyncExternalStore } from "react";
import { useReadContract, useReadContracts } from "wagmi";

import { publicDecrypt } from "@/lib/fhevm/instance";
import { useSableContract, useProtocolState } from "./use-sable";

/**
 * Public round data.
 *
 * Everything here is genuinely public: round mechanics, timings, cursors and the
 * aggregate prize figures the contract marked publicly decryptable. None of it requires a
 * wallet, which is what lets `/draws` work for an anonymous visitor.
 */

interface RawConfig {
  opensAt: bigint;
  closesAt: bigint;
  ticketBits: number;
  maxParticipants: number;
  weightPerTicket: bigint;
  jackpotWinnerCount: number;
  midWinnerCount: number;
  smallWinnerCount: number;
  jackpotShareBps: number;
  midShareBps: number;
  smallShareBps: number;
}

interface RawState {
  state: number;
  openedAt: bigint;
  closedAt: bigint;
  completedAt: bigint;
  participantCount: number;
  drawPointCount: number;
  eligibilityCursor: number;
  ticketCursor: number;
  drawCursor: number;
  settleCursor: bigint;
  jackpotResolved: boolean;
}

export interface RoundSummary {
  id: number;
  config: RoundConfig;
  lifecycle: RoundLifecycle;
  handles: {
    prizePool?: `0x${string}`;
    jackpotPrize?: `0x${string}`;
    midPrize?: `0x${string}`;
    smallPrize?: `0x${string}`;
    rollover?: `0x${string}`;
    jackpotHit?: `0x${string}`;
  };
}

function normalize(id: number, config: RawConfig, state: RawState): RoundSummary {
  return {
    id,
    config: {
      opensAt: config.opensAt,
      closesAt: config.closesAt,
      ticketBits: Number(config.ticketBits),
      maxParticipants: Number(config.maxParticipants),
      weightPerTicket: config.weightPerTicket,
      jackpotWinnerCount: Number(config.jackpotWinnerCount),
      midWinnerCount: Number(config.midWinnerCount),
      smallWinnerCount: Number(config.smallWinnerCount),
      jackpotShareBps: Number(config.jackpotShareBps),
      midShareBps: Number(config.midShareBps),
      smallShareBps: Number(config.smallShareBps),
    },
    lifecycle: {
      state: Number(state.state) as RoundState,
      openedAt: state.openedAt,
      closedAt: state.closedAt,
      completedAt: state.completedAt,
      participantCount: Number(state.participantCount),
      drawPointCount: Number(state.drawPointCount),
      eligibilityCursor: Number(state.eligibilityCursor),
      ticketCursor: Number(state.ticketCursor),
      drawCursor: Number(state.drawCursor),
      settleCursor: state.settleCursor,
      jackpotResolved: state.jackpotResolved,
    },
    handles: {},
  };
}

/** Loads one round's public configuration, lifecycle and aggregate handles. */
export function useRound(roundId: number | null) {
  const sable = useSableContract();
  const enabled = Boolean(sable.address && roundId && roundId > 0);

  const { data, isLoading, error, refetch } = useReadContracts({
    contracts: enabled
      ? [
          { ...sable, functionName: "roundConfig", args: [BigInt(roundId!)] },
          { ...sable, functionName: "roundState", args: [BigInt(roundId!)] },
          { ...sable, functionName: "roundAggregates", args: [BigInt(roundId!)] },
          { ...sable, functionName: "roundJackpotHit", args: [BigInt(roundId!)] },
        ]
      : [],
    query: { enabled, refetchInterval: 20_000 },
  });

  const round = useMemo<RoundSummary | null>(() => {
    const rawConfig = data?.[0]?.result as RawConfig | undefined;
    const rawState = data?.[1]?.result as RawState | undefined;
    if (!rawConfig || !rawState || !roundId) return null;

    const aggregates = data?.[2]?.result as readonly `0x${string}`[] | undefined;
    const jackpotHit = data?.[3]?.result as `0x${string}` | undefined;

    const summary = normalize(roundId, rawConfig, rawState);
    summary.handles = {
      prizePool: aggregates?.[0],
      jackpotPrize: aggregates?.[1],
      midPrize: aggregates?.[2],
      smallPrize: aggregates?.[3],
      rollover: aggregates?.[4],
      jackpotHit,
    };
    return summary;
  }, [data, roundId]);

  return { round, isLoading, error, refetch };
}

/**
 * Publicly decrypts a round's aggregate figures.
 *
 * Only attempted once the round has been finalized, because that is the transaction which
 * marks the handles publicly decryptable. Asking earlier would fail, and showing a failure
 * for a round that simply has not got there yet would be misleading — so the hook stays
 * idle and the UI renders "not published yet" instead.
 */
export function useRoundAggregates(round: RoundSummary | null) {
  const finalized = round !== null && round.lifecycle.state >= RoundState.Finalized;

  const handles = useMemo(() => {
    if (!round) return [];
    return [
      round.handles.prizePool,
      round.handles.jackpotPrize,
      round.handles.midPrize,
      round.handles.smallPrize,
      round.handles.rollover,
    ].filter((h): h is `0x${string}` => Boolean(h));
  }, [round]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["round-aggregates", round?.id, handles.join(",")],
    enabled: finalized && handles.length > 0,
    staleTime: Infinity,
    retry: 1,
    queryFn: async (): Promise<RoundAggregates> => {
      const values = await publicDecrypt(handles);

      const read = (handle?: `0x${string}`): bigint | null => {
        if (!handle) return null;
        const value = values[handle];
        return typeof value === "bigint" ? value : null;
      };

      let jackpotHit: boolean | null = null;
      if (round?.handles.jackpotHit && round.lifecycle.state === RoundState.Complete) {
        try {
          const bit = await publicDecrypt([round.handles.jackpotHit]);
          const value = bit[round.handles.jackpotHit];
          jackpotHit = typeof value === "boolean" ? value : null;
        } catch {
          // The round completed but the bit is not resolvable yet. Leave it unknown rather
          // than guessing — an incorrectly rendered "rolled over" would be worse than none.
          jackpotHit = null;
        }
      }

      return {
        prizePool: read(round?.handles.prizePool),
        jackpotPrize: read(round?.handles.jackpotPrize),
        midPrize: read(round?.handles.midPrize),
        smallPrize: read(round?.handles.smallPrize),
        rollover: read(round?.handles.rollover),
        jackpotHit,
      };
    },
  });

  return {
    aggregates: data ?? null,
    isLoading,
    error,
    /** True when the round has not reached the point where figures are published. */
    notPublished: !finalized,
  };
}

/** Loads every round, newest first. */
export function useAllRounds() {
  const sable = useSableContract();
  const { roundCount } = useProtocolState();

  const ids = useMemo(() => {
    const total = Number(roundCount);
    return Array.from({ length: total }, (_, index) => total - index);
  }, [roundCount]);

  const enabled = Boolean(sable.address) && ids.length > 0;

  const { data, isLoading, error, refetch } = useReadContracts({
    contracts: enabled
      ? ids.flatMap((id) => [
          { ...sable, functionName: "roundConfig", args: [BigInt(id)] },
          { ...sable, functionName: "roundState", args: [BigInt(id)] },
          { ...sable, functionName: "roundAggregates", args: [BigInt(id)] },
        ])
      : [],
    query: { enabled, refetchInterval: 30_000 },
  });

  const rounds = useMemo<RoundSummary[]>(() => {
    if (!data) return [];

    return ids.flatMap((id, index) => {
      const rawConfig = data[index * 3]?.result as RawConfig | undefined;
      const rawState = data[index * 3 + 1]?.result as RawState | undefined;
      const aggregates = data[index * 3 + 2]?.result as readonly `0x${string}`[] | undefined;
      if (!rawConfig || !rawState) return [];

      const summary = normalize(id, rawConfig, rawState);
      summary.handles = {
        prizePool: aggregates?.[0],
        jackpotPrize: aggregates?.[1],
        midPrize: aggregates?.[2],
        smallPrize: aggregates?.[3],
        rollover: aggregates?.[4],
      };
      return [summary];
    });
  }, [data, ids]);

  return { rounds, isLoading, error, refetch, total: Number(roundCount) };
}

/** The round currently accepting savings, if any. */
export function useActiveRound() {
  const { activeRoundId } = useProtocolState();
  const id = Number(activeRoundId);
  return useRound(id > 0 ? id : null);
}

/**
 * The numbers a completed round actually drew.
 *
 * Published by `completeRound`, so this returns nothing until then — while a round is
 * settling the points exist as handles nobody holds the permission to read, including the
 * operator who generated them.
 *
 * This is what turns the draw from *trustworthy* into *checkable*. Anyone can now confirm
 * that the points sit inside the ticket domain and that there are as many as the round was
 * configured for, without learning whose ticket range any of them fell in.
 */
export function useRoundDrawPoints(round: RoundSummary | null) {
  const complete = round !== null && round.lifecycle.state === RoundState.Complete;

  const { data: handles } = useReadContract({
    address: addresses.sable ?? undefined,
    abi: sableAbi,
    functionName: "drawPoints",
    args: round ? [BigInt(round.id)] : undefined,
    chainId: SABLE_CHAIN_ID,
    query: { enabled: complete && Boolean(addresses.sable) },
  });

  const list = useMemo(() => (handles as `0x${string}`[] | undefined) ?? [], [handles]);

  const { data, isLoading } = useQuery({
    queryKey: ["draw-points", round?.id, list.length],
    enabled: complete && list.length > 0,
    staleTime: Infinity,
    retry: 1,
    queryFn: async (): Promise<bigint[]> => {
      const values = await publicDecrypt(list);
      return list
        .map((handle) => values[handle])
        .filter((value): value is bigint => typeof value === "bigint");
    },
  });

  return { points: data ?? null, isLoading };
}

/**
 * A shared one-second clock, exposed as an external store.
 *
 * One interval serves every countdown on the page, and the value is cached so that
 * `getSnapshot` returns a stable result within a render pass — reading `Date.now()` during
 * render is not allowed, because a component that re-renders for an unrelated reason would
 * silently produce a different answer.
 */
const clock = {
  now: Math.floor(Date.now() / 1000),
  listeners: new Set<() => void>(),
  timer: null as ReturnType<typeof setInterval> | null,

  subscribe(listener: () => void) {
    clock.listeners.add(listener);
    clock.timer ??= setInterval(() => {
      const next = Math.floor(Date.now() / 1000);
      if (next === clock.now) return;
      clock.now = next;
      for (const notify of clock.listeners) notify();
    }, 1000);

    return () => {
      clock.listeners.delete(listener);
      if (clock.listeners.size === 0 && clock.timer !== null) {
        clearInterval(clock.timer);
        clock.timer = null;
      }
    };
  },

  getSnapshot: () => clock.now,
};

/**
 * Seconds until a round closes, or null when it already has.
 *
 * This subscribes to a ticking clock rather than reading the time once. An earlier version
 * memoised on the round object, which meant the number only changed when the round was
 * refetched — a deposit deadline that sat frozen while the user watched it.
 */
export function useRoundCountdown(round: RoundSummary | null): number | null {
  const now = useSyncExternalStore(clock.subscribe, clock.getSnapshot, clock.getSnapshot);

  if (!round || round.lifecycle.state !== RoundState.Open) return null;
  const remaining = Number(round.config.closesAt) - now;
  return remaining > 0 ? remaining : 0;
}
