"use client";

import {
  SABLE_CHAIN_ID,
  addresses,
  confidentialAssetAbi,
  isConfigured,
  sableAbi,
  yieldAdapterAbi,
} from "@sable/config";
import { useCallback } from "react";
import { useAccount, useConfig, useReadContract, useReadContracts, useSwitchChain } from "wagmi";
import { getAccount } from "wagmi/actions";

/**
 * Contract handles and the network guard.
 *
 * Every read in the app goes through these so there is exactly one place that knows which
 * address, ABI and chain are in play.
 */

export function useSableContract() {
  return {
    address: addresses.sable ?? undefined,
    abi: sableAbi,
    chainId: SABLE_CHAIN_ID,
  } as const;
}

export function useAssetContract() {
  return {
    address: addresses.asset ?? undefined,
    abi: confidentialAssetAbi,
    chainId: SABLE_CHAIN_ID,
  } as const;
}

export function useAdapterContract() {
  return {
    address: addresses.yieldAdapter ?? undefined,
    abi: yieldAdapterAbi,
    chainId: SABLE_CHAIN_ID,
  } as const;
}

export function useIsDeployed(): boolean {
  return isConfigured();
}

/**
 * Network guard.
 *
 * A confidential app pointed at the wrong chain fails in ways that look like application
 * bugs — the coprocessor simply is not there — so this is surfaced as a blocking, explicit
 * state rather than left to a mysterious revert.
 */
export function useNetworkGuard() {
  /*
   * The chain read here is the *connection's*, not the config's.
   *
   * `useChainId()` returns wagmi's active chain, which is always one of the chains wagmi was
   * configured with — and Sable configures exactly one. A wallet that moved to a chain not in
   * that list therefore kept reporting Sepolia, `wrongNetwork` stayed false, and the banner
   * never appeared. The guard only looked like it worked because Reown AppKit was raising its
   * own prompt first; on a build with no WalletConnect project id, nothing surfaced the wrong
   * network at all.
   *
   * `useAccount().chainId` is the chain the connector is actually on, configured or not, which
   * is the question being asked.
   */
  const { isConnected, chainId } = useAccount();
  const { switchChain, isPending, error } = useSwitchChain();

  // `chainId` is briefly undefined while a connection settles; that is not a wrong network,
  // and treating it as one flashes the banner on every page load.
  const wrongNetwork = isConnected && chainId !== undefined && chainId !== SABLE_CHAIN_ID;

  return {
    wrongNetwork,
    currentChainId: chainId,
    expectedChainId: SABLE_CHAIN_ID,
    switching: isPending,
    error,
    switchToSable: () => switchChain({ chainId: SABLE_CHAIN_ID }),
  };
}

/**
 * Puts the wallet on Sable's chain, asking it to switch if it is not already there.
 *
 * Every write path calls this before it does anything else. Telling a saver to go and change
 * networks themselves — after they have filled in an amount and pressed the button — is a
 * dead end dressed up as an error message: the app knows which chain it needs and the wallet
 * has an API for exactly this.
 *
 * Returns whether the wallet ended up on the right chain. A `false` is not an exception —
 * declining the switch is a legitimate choice — so the caller surfaces the manual instruction
 * instead of a stack trace.
 *
 * The chain is read live through `getAccount` rather than from `useChainId`, because the
 * value captured when the callback was created is stale the moment the switch succeeds. The
 * poll afterwards exists because wallets resolve `wallet_switchEthereumChain` before the
 * connector has finished propagating the change, and a write sent into that gap fails with
 * the same chain mismatch we just resolved.
 */
export function useEnsureChain(): () => Promise<boolean> {
  const config = useConfig();
  const { switchChainAsync } = useSwitchChain();

  return useCallback(async () => {
    const currentChain = () => getAccount(config).chainId;
    if (currentChain() === SABLE_CHAIN_ID) return true;

    try {
      await switchChainAsync({ chainId: SABLE_CHAIN_ID });
    } catch {
      // Declined, or the wallet cannot add the chain. Either way the caller explains.
      return false;
    }

    for (let attempt = 0; attempt < 25; attempt += 1) {
      if (currentChain() === SABLE_CHAIN_ID) return true;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return currentChain() === SABLE_CHAIN_ID;
  }, [config, switchChainAsync]);
}

/**
 * The connected saver's confidential position, as ciphertext handles.
 *
 * These reads return *handles*, not values. Anyone can call them; only the owning wallet
 * can turn a handle into a number, so fetching them eagerly leaks nothing and lets the UI
 * render its masked state immediately rather than after a round trip.
 */
export function usePositionHandles() {
  const { address } = useAccount();
  const sable = useSableContract();

  const enabled = Boolean(sable.address && address);

  const { data, isLoading, refetch, error } = useReadContracts({
    contracts: enabled
      ? [
          { ...sable, functionName: "confidentialBalanceOf", args: [address!] },
          { ...sable, functionName: "confidentialRewardOf", args: [address!] },
          { ...sable, functionName: "confidentialModeOf", args: [address!] },
          { ...sable, functionName: "isParticipant", args: [address!] },
        ]
      : [],
    query: { enabled },
  });

  return {
    balanceHandle: data?.[0]?.result as `0x${string}` | undefined,
    rewardHandle: data?.[1]?.result as `0x${string}` | undefined,
    modeHandle: data?.[2]?.result as `0x${string}` | undefined,
    isParticipant: (data?.[3]?.result as boolean | undefined) ?? false,
    isLoading,
    error,
    refetch,
  };
}

/** The saver's confidential wallet balance handle, from the asset contract. */
export function useWalletBalanceHandle() {
  const { address } = useAccount();
  const asset = useAssetContract();

  const enabled = Boolean(asset.address && address);

  const { data, isLoading, refetch } = useReadContract({
    ...asset,
    functionName: "confidentialBalanceOf",
    args: address ? [address] : undefined,
    query: { enabled },
  });

  return { handle: data as `0x${string}` | undefined, isLoading, refetch };
}

/** Whether the vault is authorised to move the saver's tokens, and until when. */
export function useOperatorStatus() {
  const { address } = useAccount();
  const asset = useAssetContract();
  const sable = useSableContract();

  const enabled = Boolean(asset.address && sable.address && address);

  const { data, isLoading, refetch } = useReadContract({
    ...asset,
    functionName: "isOperator",
    args: address && sable.address ? [address, sable.address] : undefined,
    query: { enabled },
  });

  return { isOperator: (data as boolean | undefined) ?? false, isLoading, refetch };
}

/** Protocol-level public state: round count, active round, participant cap, yield index. */
export function useProtocolState() {
  const sable = useSableContract();
  const adapter = useAdapterContract();
  const enabled = Boolean(sable.address);

  const { data, isLoading, refetch } = useReadContracts({
    contracts: enabled
      ? [
          { ...sable, functionName: "roundCount" },
          { ...sable, functionName: "activeRoundId" },
          { ...sable, functionName: "participantCount" },
          { ...sable, functionName: "participantCap" },
          { ...sable, functionName: "paused" },
          { ...adapter, functionName: "ratePerYearBps" },
        ]
      : [],
    query: { enabled, refetchInterval: 30_000 },
  });

  return {
    roundCount: (data?.[0]?.result as bigint | undefined) ?? 0n,
    activeRoundId: (data?.[1]?.result as bigint | undefined) ?? 0n,
    participantCount: (data?.[2]?.result as bigint | undefined) ?? 0n,
    participantCap: (data?.[3]?.result as number | undefined) ?? 0,
    paused: (data?.[4]?.result as boolean | undefined) ?? false,
    ratePerYearBps: (data?.[5]?.result as bigint | undefined) ?? null,
    isLoading,
    refetch,
  };
}
