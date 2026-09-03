"use client";

import {
  SABLE_CHAIN_ID,
  SEPOLIA_ASSETS,
  addresses,
  confidentialAssetAbi,
  type ConfidentialAsset,
} from "@sable/config";
import { erc20Abi } from "viem";
import { useAccount, useReadContracts } from "wagmi";

/**
 * The saver's holdings across every confidential asset Zama publishes.
 *
 * Two balances per asset, and the difference between them is the product in miniature:
 *
 * - the **public** ERC-20 balance, a plain `uint256` anyone can read, and
 * - the **shielded** balance, which comes back as a ciphertext handle and stays unreadable
 *   until its owner authorises a decryption.
 *
 * Only the handle is fetched here. Turning it into a number requires an EIP-712 signature
 * from the wallet that owns it, which is deliberately not something a list view does on
 * anyone's behalf — see `useReveal`.
 */

export interface AssetHolding {
  asset: ConfidentialAsset;
  /** Balance of the public ERC-20 beneath the wrapper. */
  publicBalance: bigint;
  /** Ciphertext handle for the confidential balance, or undefined if never written. */
  shieldedHandle?: `0x${string}`;
  /** True when this is the asset the deployed vault custodies. */
  isVaultAsset: boolean;
}

export interface Portfolio {
  holdings: AssetHolding[];
  isLoading: boolean;
  refetch: () => void;
  /** True when at least one asset shows a public balance worth shielding. */
  hasPublicBalance: boolean;
}

export function usePortfolio(): Portfolio {
  const { address } = useAccount();
  const enabled = Boolean(address);

  // One `useReadContracts` rather than a hook per asset: wagmi folds these into a single
  // Multicall3 call, so sixteen reads cost one RPC round trip instead of sixteen.
  const { data, isLoading, refetch } = useReadContracts({
    contracts: enabled
      ? SEPOLIA_ASSETS.flatMap((asset) => [
          {
            address: asset.underlying,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [address!],
            chainId: SABLE_CHAIN_ID,
          } as const,
          {
            address: asset.address,
            abi: confidentialAssetAbi,
            functionName: "confidentialBalanceOf",
            args: [address!],
            chainId: SABLE_CHAIN_ID,
          } as const,
        ])
      : [],
    query: { enabled },
  });

  const vaultAsset = addresses.asset?.toLowerCase();

  const holdings = SEPOLIA_ASSETS.map((asset, index) => {
    const publicResult = data?.[index * 2];
    const shieldedResult = data?.[index * 2 + 1];

    // A failed read is reported as zero rather than propagated. One unreachable token should
    // not blank a portfolio, and the balance shown is never authoritative anyway — the chain
    // is.
    const publicBalance =
      publicResult?.status === "success" ? (publicResult.result as bigint) : 0n;

    const shieldedHandle =
      shieldedResult?.status === "success"
        ? (shieldedResult.result as `0x${string}`)
        : undefined;

    return {
      asset,
      publicBalance,
      shieldedHandle,
      isVaultAsset: asset.address.toLowerCase() === vaultAsset,
    };
  });

  return {
    holdings,
    isLoading,
    refetch,
    hasPublicBalance: holdings.some((holding) => holding.publicBalance > 0n),
  };
}

/**
 * Every confidential contract a saver might decrypt from this view.
 *
 * Passed as the authorisation scope so that revealing balances costs **one** signature
 * rather than one per token. The alternative is worse in both directions: the cached
 * authorisation holds a single contract set, so authorising per token would make each reveal
 * a fresh wallet prompt, and re-revealing the first token after looking at a second would
 * prompt again.
 */
export function portfolioContracts(): string[] {
  return SEPOLIA_ASSETS.map((asset) => asset.address);
}
