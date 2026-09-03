"use client";

import {
  SABLE_CHAIN_ID,
  addresses,
  confidentialWrapperAbi,
  floorToRate,
  isWrappedAsset,
} from "@sable/config";
import { useCallback, useState } from "react";
import { erc20Abi, toEventSelector } from "viem";
import { useAccount, useConfig, useReadContract, useReadContracts } from "wagmi";
import { waitForTransactionReceipt, writeContract } from "wagmi/actions";

import { encryptAmount, publicDecryptWithProof } from "@/lib/fhevm/instance";
import { WRONG_NETWORK_MESSAGE, toTxError } from "./use-confidential-tx";
import { useEnsureChain } from "./use-sable";

/**
 * Wrapping and unwrapping against Zama's Confidential Wrapper.
 *
 * These are the two boundaries between the public token economy and the confidential one.
 * Sable does not issue tokens, so this is the only way value enters or leaves the
 * confidential side — which makes getting both directions right more important than the
 * convenience faucet it replaced.
 */

/* ==========================================================================
   Shared metadata and preflight
   ========================================================================== */

export interface WrapperInfo {
  underlying?: `0x${string}`;
  rate: bigint;
  paused: boolean;
  /** True when this account may not wrap, unwrap or transfer. */
  blocked: boolean;
  /** Distinguishes the two denylist sources, so the message can say which. */
  blockedOnWrapper: boolean;
  blockedOnUnderlying: boolean;
  isLoading: boolean;
}

/**
 * Reads the wrapper's guards and conversion metadata.
 *
 * The denylist and pause checks exist so a saver is told *why* an action is unavailable
 * before spending gas. Zama's wrapper enforces both on every path that moves tokens — wrap,
 * the ERC-1363 callback, confidential transfers, unwrap and finalizeUnwrap — and a blocked
 * address otherwise just gets an opaque revert.
 *
 * `isBlocked` can itself revert when the underlying's deny-list selector is misconfigured;
 * a failed read is treated as "not blocked" rather than blocking the UI, because the
 * transaction would surface the real error anyway.
 */
export function useWrapperInfo(wrapper?: `0x${string}`): WrapperInfo {
  const { address } = useAccount();

  // Defaults to the asset this deployment's vault custodies. An explicit wrapper lets the
  // shield flow work against any of Zama's published assets, not only the one Sable accepts —
  // a saver may want to hold several confidentially even though only one of them earns here.
  const asset = wrapper ?? addresses.asset ?? undefined;
  const enabled = Boolean(asset) && (Boolean(wrapper) || isWrappedAsset());

  const { data, isLoading } = useReadContracts({
    contracts:
      enabled && address
        ? [
            { address: asset, abi: confidentialWrapperAbi, functionName: "underlying", chainId: SABLE_CHAIN_ID },
            { address: asset, abi: confidentialWrapperAbi, functionName: "rate", chainId: SABLE_CHAIN_ID },
            { address: asset, abi: confidentialWrapperAbi, functionName: "paused", chainId: SABLE_CHAIN_ID },
            {
              address: asset,
              abi: confidentialWrapperAbi,
              functionName: "isBlockedOnWrapper",
              args: [address],
              chainId: SABLE_CHAIN_ID,
            },
            {
              address: asset,
              abi: confidentialWrapperAbi,
              functionName: "isBlockedOnUnderlying",
              args: [address],
              chainId: SABLE_CHAIN_ID,
            },
          ]
        : [],
    query: { enabled: enabled && Boolean(address) },
  });

  const blockedOnWrapper = (data?.[3]?.result as boolean | undefined) ?? false;
  const blockedOnUnderlying = (data?.[4]?.result as boolean | undefined) ?? false;

  return {
    underlying: data?.[0]?.result as `0x${string}` | undefined,
    rate: (data?.[1]?.result as bigint | undefined) ?? 1n,
    paused: (data?.[2]?.result as boolean | undefined) ?? false,
    blocked: blockedOnWrapper || blockedOnUnderlying,
    blockedOnWrapper,
    blockedOnUnderlying,
    isLoading,
  };
}

/** Returns a human explanation when the wrapper will refuse to act, or null when it will not. */
export function wrapperBlockReason(info: WrapperInfo): string | null {
  if (info.paused) {
    return "The confidential wrapper is paused. Wrapping and unwrapping are unavailable until it resumes.";
  }
  if (info.blockedOnWrapper) {
    return "This address is on the wrapper's denylist and cannot wrap, unwrap or transfer.";
  }
  if (info.blockedOnUnderlying) {
    return "This address is denied by the underlying token, so the wrapper will not move funds for it.";
  }
  return null;
}

/* ==========================================================================
   Wrap
   ========================================================================== */

export type WrapStage = "idle" | "approving" | "wrapping";

export function useWrap(wrapper?: `0x${string}`) {
  const { address } = useAccount();
  const config = useConfig();
  const ensureChain = useEnsureChain();
  const [stage, setStage] = useState<WrapStage>("idle");
  const [error, setError] = useState<string | null>(null);

  /** The wrapper being converted into — the vault's asset unless one is named. */
  const target = wrapper ?? addresses.asset ?? undefined;

  const reset = useCallback(() => {
    setStage("idle");
    setError(null);
  }, []);

  /**
   * Wraps `underlyingAmount` of the public ERC-20 into the confidential token.
   *
   * Two transactions. Zama recommends the single-transaction `transferAndCall` path where
   * the underlying implements ERC-1363 — but the default asset's underlying does not (no
   * such selector in its bytecode, no ERC-165), so this is the only route available.
   *
   * The amount is floored to a whole multiple of `rate` first. The wrapper would refund the
   * remainder anyway, but a refund arriving as unexplained dust is worse than a slightly
   * smaller, exact headline figure.
   */
  const wrap = useCallback(
    async (underlying: `0x${string}`, underlyingAmount: bigint, rate: bigint): Promise<`0x${string}` | null> => {
      if (!target || !address) return null;

      const amount = floorToRate(underlyingAmount, rate);
      if (amount === 0n) {
        setError("That amount is smaller than the wrapper's smallest unit.");
        setStage("idle");
        return null;
      }

      setError(null);

      // Two transactions follow. Discovering the wrong chain between them would leave an
      // approval granted and nothing wrapped.
      if (!(await ensureChain())) {
        setError(WRONG_NETWORK_MESSAGE);
        return null;
      }

      try {
        setStage("approving");
        const approveHash = await writeContract(config, {
          address: underlying,
          abi: erc20Abi,
          functionName: "approve",
          args: [target, amount],
          chainId: SABLE_CHAIN_ID,
        });
        await waitForTransactionReceipt(config, { hash: approveHash, chainId: SABLE_CHAIN_ID });

        setStage("wrapping");
        const wrapHash = await writeContract(config, {
          address: target,
          abi: confidentialWrapperAbi,
          functionName: "wrap",
          args: [address, amount],
          chainId: SABLE_CHAIN_ID,
        });
        await waitForTransactionReceipt(config, { hash: wrapHash, chainId: SABLE_CHAIN_ID });

        return wrapHash;
      } catch (caught) {
        setError(toWrapperError(caught));
        return null;
      } finally {
        setStage("idle");
      }
    },
    [address, config, target, ensureChain],
  );

  return { wrap, stage, error, reset, isBusy: stage !== "idle" };
}

/* ==========================================================================
   Unwrap
   ========================================================================== */

export type UnwrapStage =
  | "idle"
  | "encrypting"
  | "requesting"
  | "decrypting"
  | "finalizing";

export const UNWRAP_STAGE_COPY: Record<Exclude<UnwrapStage, "idle">, string> = {
  encrypting: "Encrypting the amount locally…",
  requesting: "Burning the confidential amount…",
  decrypting: "Publicly decrypting the released amount…",
  finalizing: "Releasing your public tokens…",
};

/**
 * Unwrapping: confidential token back to the public ERC-20.
 *
 * Deliberately a three-stage flow, because the protocol's is:
 *
 * 1. **Request.** `unwrap(from, to, encryptedAmount, inputProof)` burns the confidential
 *    amount and marks the resulting handle publicly decryptable. No underlying moves yet.
 * 2. **Decrypt.** The released amount has to become a cleartext with a KMS proof. This is a
 *    genuine use of *public* decryption — the amount leaving the confidential system must be
 *    publicly known, since it is about to appear as a public ERC-20 transfer.
 * 3. **Finalize.** `finalizeUnwrap(id, cleartext, proof)` re-verifies the signatures with
 *    `FHE.checkSignatures` and only then releases the underlying.
 *
 * A neat detail of the contract: the request id **is** the ciphertext handle, so step 2
 * needs nothing from the event logs — the value returned by step 1 is exactly what has to be
 * decrypted.
 *
 * The two on-chain steps are separate transactions and the middle one is off-chain, so an
 * interruption between them is expected rather than exceptional. A request already burned
 * but not finalized can be completed later via {finalizeUnwrap}; the tokens are not lost.
 */
export function useUnwrap() {
  const { address } = useAccount();
  const config = useConfig();
  const ensureChain = useEnsureChain();

  const [stage, setStage] = useState<UnwrapStage>("idle");
  const [error, setError] = useState<string | null>(null);
  /** Set once step 1 lands, so an interrupted flow can be resumed rather than restarted. */
  const [pendingRequestId, setPendingRequestId] = useState<`0x${string}` | null>(null);

  const reset = useCallback(() => {
    setStage("idle");
    setError(null);
    setPendingRequestId(null);
  }, []);

  /** Completes a request that was already burned on-chain. */
  const finalize = useCallback(
    async (requestId: `0x${string}`): Promise<`0x${string}` | null> => {
      if (!addresses.asset) return null;

      if (!(await ensureChain())) {
        setError(WRONG_NETWORK_MESSAGE);
        return null;
      }

      try {
        setStage("decrypting");
        const proven = await publicDecryptWithProof([requestId]);

        const cleartext = proven.values[requestId];
        if (typeof cleartext !== "bigint") {
          throw new Error("The relayer did not return a numeric amount for this unwrap.");
        }

        setStage("finalizing");
        const hash = await writeContract(config, {
          address: addresses.asset,
          abi: confidentialWrapperAbi,
          functionName: "finalizeUnwrap",
          args: [requestId, cleartext, proven.decryptionProof],
          chainId: SABLE_CHAIN_ID,
        });
        await waitForTransactionReceipt(config, { hash, chainId: SABLE_CHAIN_ID });

        setPendingRequestId(null);
        return hash;
      } catch (caught) {
        // Keep the request id: the amount is already burned, and abandoning it here would
        // strand the saver's tokens in a half-finished unwrap.
        setPendingRequestId(requestId);
        setError(toWrapperError(caught));
        return null;
      } finally {
        setStage("idle");
      }
    },
    [config, ensureChain],
  );

  /** Runs the whole flow: encrypt, request, decrypt, finalize. */
  const unwrap = useCallback(
    async (confidentialAmount: bigint): Promise<`0x${string}` | null> => {
      if (!addresses.asset || !address) return null;

      setError(null);

      if (!(await ensureChain())) {
        setError(WRONG_NETWORK_MESSAGE);
        return null;
      }

      try {
        setStage("encrypting");
        const { handle, proof } = await encryptAmount(addresses.asset, address, confidentialAmount);

        setStage("requesting");
        const requestHash = await writeContract(config, {
          address: addresses.asset,
          abi: confidentialWrapperAbi,
          functionName: "unwrap",
          args: [address, address, handle, proof],
          chainId: SABLE_CHAIN_ID,
        });
        const receipt = await waitForTransactionReceipt(config, {
          hash: requestHash,
          chainId: SABLE_CHAIN_ID,
        });

        // The request id is the burned amount's ciphertext handle, emitted as the second
        // indexed topic of `UnwrapRequested`.
        const requestId = extractUnwrapRequestId(receipt.logs, addresses.asset);
        if (!requestId) {
          throw new Error("The unwrap request did not emit an identifier.");
        }

        setPendingRequestId(requestId);
        return finalize(requestId);
      } catch (caught) {
        setError(toWrapperError(caught));
        setStage("idle");
        return null;
      }
    },
    [address, config, finalize, ensureChain],
  );

  return {
    unwrap,
    finalize,
    stage,
    error,
    pendingRequestId,
    reset,
    isBusy: stage !== "idle",
  };
}

/**
 * Pulls the unwrap request id out of the receipt.
 *
 * `UnwrapRequested(address indexed receiver, bytes32 indexed unwrapRequestId, euint64 amount)`
 * — the id is the second indexed parameter, so `topics[2]`. The signature hash is derived
 * from the ABI rather than hardcoded, so a change to the event shape surfaces as no match
 * instead of a silently wrong topic.
 */
function extractUnwrapRequestId(
  logs: readonly { address: string; topics: readonly `0x${string}`[] }[],
  wrapper: string,
): `0x${string}` | null {
  const signature = toEventSelector(
    "UnwrapRequested(address,bytes32,bytes32)",
  );

  for (const log of logs) {
    if (log.address.toLowerCase() !== wrapper.toLowerCase()) continue;
    if (log.topics[0]?.toLowerCase() !== signature.toLowerCase()) continue;
    if (log.topics[2]) return log.topics[2];
  }
  return null;
}

/** Wrapper-specific failures, in language a saver can act on. */
export function toWrapperError(caught: unknown): string {
  const message = caught instanceof Error ? caught.message : String(caught);
  const lower = message.toLowerCase();

  if (lower.includes("wrapperblockedaddress")) {
    return "This address is on the wrapper's denylist and cannot wrap or unwrap.";
  }
  if (lower.includes("underlyingdenylistedaddress")) {
    return "The underlying token has denied this address, so the wrapper will not move funds for it.";
  }
  if (lower.includes("enforcedpause") || lower.includes("paused")) {
    return "The confidential wrapper is paused. Try again once it resumes.";
  }
  if (lower.includes("invalidunwraprequest")) {
    return "That unwrap request no longer exists — it may already have been finalized.";
  }
  if (lower.includes("erc7984totalsupplyoverflow")) {
    return "Wrapping would exceed the confidential token's maximum supply.";
  }
  if (lower.includes("erc7984unauthorizedspender")) {
    return "The wrapper is not authorised to move these tokens on your behalf.";
  }
  if (lower.includes("erc7984unauthorizeduseofencryptedamount")) {
    return "This wallet is not authorised to use that encrypted amount.";
  }
  if (lower.includes("insufficient allowance") || lower.includes("erc20insufficientallowance")) {
    return "The wrapper's allowance is too low. Approve again and retry.";
  }

  return toTxError(caught);
}

/** Reads a saver's public balance of the underlying token. */
export function useUnderlyingBalance(underlying?: `0x${string}`) {
  const { address } = useAccount();

  const { data, refetch, isLoading } = useReadContract({
    address: underlying,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: SABLE_CHAIN_ID,
    query: { enabled: Boolean(underlying && address) },
  });

  return { balance: (data as bigint | undefined) ?? 0n, refetch, isLoading };
}
