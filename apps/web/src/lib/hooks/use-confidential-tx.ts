"use client";

import { SABLE_CHAIN_ID, addresses, sableAbi, type TxStage } from "@sable/config";
import { useCallback, useState } from "react";
import { useAccount, useConfig } from "wagmi";
import { waitForTransactionReceipt, writeContract } from "wagmi/actions";

import { encryptAmount, encryptMode } from "@/lib/fhevm/instance";
import { useEnsureChain } from "./use-sable";
import { toReadableError } from "./use-reveal";

/**
 * Human-readable copy for each stage of a confidential transaction.
 *
 * The `encrypting` stage is called out by name because it is genuinely slow — the browser
 * is building a zero-knowledge proof over the amount — and an unexplained pause there
 * reads as a hang. Telling the saver what is happening turns a suspicious wait into a
 * reassuring one, which is the entire difference.
 */
/** Shown only when an automatic switch was offered and declined. */
export const WRONG_NETWORK_MESSAGE =
  "Sable runs on Ethereum Sepolia. Approve the network switch in your wallet, or change it manually and try again.";

export const STAGE_COPY: Record<TxStage, { label: string; detail?: string }> = {
  idle: { label: "Ready" },
  "switching-network": {
    label: "Switching network",
    detail: "Confirm the change to Ethereum Sepolia in your wallet.",
  },
  preparing: { label: "Preparing", detail: "Loading the encryption keys." },
  encrypting: {
    label: "Encrypting",
    detail: "Encrypting your amount locally, before it leaves your device.",
  },
  "awaiting-wallet": { label: "Awaiting wallet", detail: "Confirm the transaction in your wallet." },
  submitting: { label: "Submitting", detail: "Broadcasting to Ethereum Sepolia." },
  confirming: { label: "Confirming", detail: "Waiting for the transaction to be included." },
  complete: { label: "Complete" },
  error: { label: "Failed" },
};

export interface ConfidentialTxState {
  stage: TxStage;
  txHash: `0x${string}` | null;
  error: string | null;
  /** The raw failure, kept alongside the friendly message for the detail disclosure. */
  detail: string | null;
  isBusy: boolean;
}

const INITIAL: ConfidentialTxState = {
  stage: "idle",
  txHash: null,
  error: null,
  detail: null,
  isBusy: false,
};

/**
 * Runs a confidential write end to end and reports the real stage throughout.
 *
 * Nothing is reported as complete until the receipt confirms it. There is no optimistic
 * success anywhere in this flow — a savings product that shows a tick before the chain
 * agrees is lying to the person who trusted it.
 */
/**
 * Moves the wallet onto Sable's chain, or explains why nothing happened.
 *
 * Shared by every write path so the behaviour is identical everywhere: try to switch, and if
 * the saver declines, leave the same instruction they would have got before rather than a
 * half-finished transaction.
 */
async function ensureChainOrExplain(
  ensureChain: () => Promise<boolean>,
  setStage: (stage: TxStage) => void,
  setState: (updater: (current: ConfidentialTxState) => ConfidentialTxState) => void,
): Promise<boolean> {
  setStage("switching-network");
  if (await ensureChain()) return true;

  setState((current) => ({
    ...current,
    stage: "error",
    isBusy: false,
    error: WRONG_NETWORK_MESSAGE,
  }));
  return false;
}

export function useConfidentialTx() {
  const config = useConfig();
  const { address } = useAccount();
  const ensureChain = useEnsureChain();
  const [state, setState] = useState<ConfidentialTxState>(INITIAL);

  const reset = useCallback(() => setState(INITIAL), []);

  const run = useCallback(
    async (
      build: (setStage: (stage: TxStage) => void) => Promise<{
        functionName: string;
        args: readonly unknown[];
      }>,
    ): Promise<`0x${string}` | null> => {
      if (!addresses.sable || !address) {
        setState({
          ...INITIAL,
          stage: "error",
          error: "Connect a wallet to continue.",
        });
        return null;
      }

      const setStage = (stage: TxStage) =>
        setState((current) => ({ ...current, stage, isBusy: true, error: null }));

      try {
        // Before anything else, and before the slow part: encrypting an amount takes seconds
        // of local proof work, and discovering the wrong network *after* that would waste it.
        if (!(await ensureChainOrExplain(ensureChain, setStage, setState))) return null;

        setStage("preparing");
        const { functionName, args } = await build(setStage);

        setStage("awaiting-wallet");
        const hash = await writeContract(config, {
          address: addresses.sable,
          abi: sableAbi,
          functionName,
          args,
          chainId: SABLE_CHAIN_ID,
        } as never);

        setState((current) => ({ ...current, stage: "submitting", txHash: hash, isBusy: true }));

        setState((current) => ({ ...current, stage: "confirming" }));
        const receipt = await waitForTransactionReceipt(config, { hash, chainId: SABLE_CHAIN_ID });

        if (receipt.status !== "success") {
          throw new Error("The transaction was included but reverted.");
        }

        setState({ stage: "complete", txHash: hash, error: null, detail: null, isBusy: false });
        return hash;
      } catch (caught) {
        setState((current) => ({
          stage: "error",
          txHash: current.txHash,
          error: toTxError(caught),
          // The friendly message is a best guess. Keeping the raw one is what makes a
          // mis-mapped error diagnosable instead of misleading.
          detail: toErrorDetail(caught),
          isBusy: false,
        }));
        return null;
      }
    },
    [config, address, ensureChain],
  );

  /** Encrypts an amount, then calls a `(handle, proof)` function. */
  const sendAmount = useCallback(
    (functionName: "deposit" | "withdraw", amount: bigint) =>
      run(async (setStage) => {
        setStage("encrypting");
        const { handle, proof } = await encryptAmount(addresses.sable!, address!, amount);
        return { functionName, args: [handle, proof] };
      }),
    [run, address],
  );

  /** Encrypts the yield mode, then calls `setMode`. */
  const sendMode = useCallback(
    (lucky: boolean) =>
      run(async (setStage) => {
        setStage("encrypting");
        const { handle, proof } = await encryptMode(addresses.sable!, address!, lucky);
        return { functionName: "setMode", args: [handle, proof] };
      }),
    [run, address],
  );

  /** Calls a function that needs no encrypted input. */
  const sendPlain = useCallback(
    (functionName: string, args: readonly unknown[] = []) =>
      run(async () => ({ functionName, args })),
    [run],
  );

  return { ...state, run, sendAmount, sendMode, sendPlain, reset };
}

/**
 * Translates chain and wallet failures into plain language.
 *
 * `execution reverted` tells a saver nothing about what to do next; the contracts raise
 * specific custom errors, so the messages here can be specific too. Nothing private ever
 * appears in these strings — every confidential quantity is a ciphertext, so there is no
 * amount or mode available to leak even accidentally.
 *
 * ## Ordering matters, and getting it wrong is worse than not mapping at all
 *
 * viem puts the **function name** into every contract error message. An earlier version of
 * this function tested `message.includes("operator")`, which matched every possible failure
 * of `setOperator` — including a wrong-network error — and rewrote it as "Sable is not
 * authorised to move your tokens yet. Approve the vault and retry."
 *
 * That told the saver to do the exact thing they had just tried, and buried the real cause.
 * A wrong-but-confident error message is worse than a generic one, so:
 *
 * 1. Client-side preconditions (rejection, wrong network, gas) are checked **first** — they
 *    are the common cases and they are unambiguous.
 * 2. Contract errors are matched on their **exact custom-error names**, never on a substring
 *    that could appear in a function name.
 */
export function toTxError(caught: unknown): string {
  const message = caught instanceof Error ? caught.message : String(caught);
  const lower = message.toLowerCase();

  // --- client-side preconditions, checked first -----------------------------
  if (lower.includes("user rejected") || lower.includes("user denied") || lower.includes("rejected the request")) {
    return "You declined the transaction. Nothing was submitted.";
  }
  if (lower.includes("chainmismatch") || (lower.includes("does not match the target chain"))) {
    return WRONG_NETWORK_MESSAGE;
  }
  if (lower.includes("connectornotfound") || lower.includes("no connector")) {
    return "No wallet is connected. Connect one and try again.";
  }
  if (lower.includes("insufficient funds")) {
    return "Not enough Sepolia ETH to cover gas. Top up and try again.";
  }

  // --- contract custom errors, matched exactly ------------------------------
  if (lower.includes("erc7984unauthorizedspender")) {
    return "Sable is not authorised to move your tokens yet. Approve the vault and retry.";
  }
  if (lower.includes("erc7984unauthorizeduseofencryptedamount")) {
    return "This wallet is not authorised to use that encrypted amount.";
  }
  if (lower.includes("participantcapreached")) {
    return "This round is full. No new savers can join until the next one opens.";
  }
  if (lower.includes("notaparticipant")) {
    return "This wallet has no Sable position yet. Make a deposit first.";
  }
  if (lower.includes("invalidroundstate")) {
    return "The round has moved on since this page loaded. Refresh and try again.";
  }
  if (lower.includes("wrapperblockedaddress") || lower.includes("underlyingdenylistedaddress")) {
    return "This address is denied by the confidential token and cannot move funds.";
  }
  if (lower.includes("hcutransactionlimitexceeded")) {
    return "That batch was too large for one transaction. Try a smaller batch.";
  }
  // Checked late: `Paused` is a short word that appears inside other messages.
  if (lower.includes("custom error 'paused") || lower.includes("enforcedpause")) {
    return "Sable is paused for maintenance. Withdrawals remain available.";
  }

  if (lower.includes("reverted")) {
    return "The network rejected the transaction. Nothing was changed.";
  }

  return toReadableError(caught);
}

/**
 * The raw failure, for the expandable technical detail beneath an error message.
 *
 * Shown only on request. Confidential values are ciphertexts, so a raw chain error cannot
 * contain an amount or a mode — but it can contain an address and a function name, which is
 * exactly what makes it useful for diagnosis.
 */
export function toErrorDetail(caught: unknown): string {
  if (caught instanceof Error) {
    const parts = [caught.message];
    const cause = (caught as { cause?: unknown }).cause;
    if (cause instanceof Error && cause.message !== caught.message) parts.push(cause.message);
    return parts.join("\n\n").slice(0, 1200);
  }
  return String(caught).slice(0, 1200);
}
