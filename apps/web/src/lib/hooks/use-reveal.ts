"use client";

import { addresses } from "@sable/config";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAccount, useSignTypedData } from "wagmi";

import type { RevealState } from "@/components/ui/confidential-value";
import {
  authorizeDecryption,
  clearDecryptionAuthorization,
  hasDecryptionAuthorization,
  isUninitializedHandle,
  userDecrypt,
} from "@/lib/fhevm/instance";

/**
 * How long a revealed value stays on screen before it re-masks itself.
 *
 * Ninety seconds is long enough to read a balance and act on it, short enough that a
 * screen left unattended does not keep someone's savings on display. The timer resets on
 * every fresh reveal, never on mere mouse movement — an idle-activity reset would defeat
 * the point in exactly the situation it exists for.
 */
const AUTO_HIDE_MS = 90_000;

export interface RevealResult<T> {
  state: RevealState;
  value: T | null;
  error: string | null;
  reveal: () => Promise<void>;
  hide: () => void;
  /** True once an authorisation exists, so the UI can promise a one-step reveal. */
  authorized: boolean;
}

/**
 * Reveals one confidential handle through the Zama user-decryption flow.
 *
 * The sequence a saver sees is deliberate: *authorizing* (an EIP-712 signature proving
 * they own the wallet) then *decrypting* (the KMS re-encrypting the result to a key only
 * this browser session holds). Both stages are named in the UI because an unexplained
 * multi-second wait on a savings balance reads as breakage.
 *
 * A signature is requested at most once per session per contract set, so revealing a
 * second value is a single step.
 */
export function useReveal(
  handle: `0x${string}` | undefined,
  options: {
    contractAddress?: string;
    kind?: "amount" | "bool";
    /**
     * Contracts the EIP-712 authorisation should cover, when that is wider than the one
     * being decrypted.
     *
     * A view listing several confidential tokens needs this. The cached authorisation holds
     * a single contract set, so authorising one token at a time would re-prompt the wallet
     * on every token — and again on the first one as soon as a second had replaced it.
     * Naming the whole set once makes the reveals after the first free.
     *
     * It widens only what this browser session may decrypt with its own ephemeral key. No
     * other party gains anything, and the signature still expires on its own.
     */
    authorizeFor?: string[];
  } = {},
): RevealResult<bigint | boolean> {
  const { address } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();

  const [state, setState] = useState<RevealState>("hidden");
  const [value, setValue] = useState<bigint | boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  const timerRef = useRef<number | null>(null);
  const contractAddress = options.contractAddress ?? addresses.sable ?? undefined;

  // Callers pass a fresh array literal on every render, which would make `reveal` a new
  // function each time and defeat its memoisation. Collapsing it to a string first gives a
  // dependency that changes only when the contract set genuinely does.
  const authorizeKey = options.authorizeFor?.join(",") ?? "";
  const authorizeFor = useMemo(
    () => (authorizeKey ? authorizeKey.split(",") : null),
    [authorizeKey],
  );

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const hide = useCallback(() => {
    clearTimer();
    setState("hidden");
    setValue(null);
    setError(null);
  }, [clearTimer]);

  /**
   * Re-mask whenever the ciphertext or the account changes underneath a revealed value.
   *
   * After a deposit the old plaintext no longer describes the new ciphertext, and a revealed
   * balance must never survive an account switch.
   *
   * This resets **during render**, not in an effect, and the distinction is the point: an
   * effect runs after the browser has already painted, so the previous account's balance
   * would be shown once — briefly, but genuinely — before being cleared. Adjusting state
   * during render makes React discard this render and immediately re-render masked, so the
   * stale figure never reaches the screen.
   */
  const identity = `${address ?? ""}:${handle ?? ""}`;
  const [maskedFor, setMaskedFor] = useState(identity);

  if (identity !== maskedFor) {
    setMaskedFor(identity);
    setState("hidden");
    setValue(null);
    setError(null);
  }

  // The auto-hide timer is a ref, which render must not touch, so it is cancelled here
  // instead. Nothing depends on the ordering: the value is already masked by the time this
  // runs, and a timer that did fire first would only re-hide something already hidden.
  useEffect(() => clearTimer(), [identity, clearTimer]);

  // Dropping the cached signature is an external side effect, so it stays in an effect. It
  // only needs to happen on an account change; the masking above has already taken care of
  // what is on screen.
  useEffect(() => {
    clearDecryptionAuthorization();
  }, [address]);

  useEffect(() => clearTimer, [clearTimer]);

  const reveal = useCallback(async () => {
    if (!handle || !contractAddress || !address) return;

    setError(null);

    // An unwritten handle is a genuine confidential zero, not an error and not something
    // to trouble the relayer with.
    if (isUninitializedHandle(handle)) {
      setValue(options.kind === "bool" ? false : 0n);
      setState("revealed");
      clearTimer();
      timerRef.current = window.setTimeout(hide, AUTO_HIDE_MS);
      return;
    }

    try {
      const alreadyAuthorized = hasDecryptionAuthorization(address);
      setState(alreadyAuthorized ? "decrypting" : "authorizing");

      const auth = await authorizeDecryption(
        address,
        authorizeFor ?? [contractAddress],
        (args) => signTypedDataAsync(args as never),
      );

      setState("decrypting");

      const results = await userDecrypt([{ handle, contractAddress }], auth);
      const decrypted = results[handle];

      if (decrypted === undefined) {
        throw new Error("The relayer returned no value for this handle.");
      }

      setValue(decrypted);
      setState("revealed");

      clearTimer();
      timerRef.current = window.setTimeout(hide, AUTO_HIDE_MS);
    } catch (caught) {
      setState("error");
      setError(toReadableError(caught));
    }
  }, [handle, contractAddress, address, options.kind, authorizeFor, signTypedDataAsync, hide, clearTimer]);

  return {
    state,
    value,
    error,
    reveal,
    hide,
    authorized: address ? hasDecryptionAuthorization(address) : false,
  };
}

/**
 * Reveals several handles from one contract with a single authorisation.
 *
 * Used by the dashboard and the statement builder, where asking a saver to sign once per
 * figure would be absurd.
 */
export function useRevealMany(
  handles: Record<string, `0x${string}` | undefined>,
  contractAddress?: string,
) {
  const { address } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();

  const [state, setState] = useState<RevealState>("hidden");
  const [values, setValues] = useState<Record<string, bigint | boolean> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);

  const target = contractAddress ?? addresses.sable ?? undefined;

  const hide = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    setState("hidden");
    setValues(null);
    setError(null);
  }, []);

  // Same reasoning as `useReveal`: mask during render so a previous account's revealed
  // values cannot be painted even once, and keep the external side effect in an effect.
  const [maskedFor, setMaskedFor] = useState(address);

  if (address !== maskedFor) {
    setMaskedFor(address);
    setState("hidden");
    setValues(null);
    setError(null);
  }

  useEffect(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }, [address]);

  useEffect(() => {
    clearDecryptionAuthorization();
  }, [address]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  const reveal = useCallback(async () => {
    if (!target || !address) return;

    const entries = Object.entries(handles).filter(([, handle]) => handle !== undefined) as [
      string,
      `0x${string}`,
    ][];
    if (entries.length === 0) return;

    setError(null);

    try {
      setState(hasDecryptionAuthorization(address) ? "decrypting" : "authorizing");

      const auth = await authorizeDecryption(address, [target], (args) =>
        signTypedDataAsync(args as never),
      );

      setState("decrypting");

      const decrypted = await userDecrypt(
        entries.map(([, handle]) => ({ handle, contractAddress: target })),
        auth,
      );

      const byKey: Record<string, bigint | boolean> = {};
      for (const [key, handle] of entries) {
        const result = decrypted[handle];
        if (result !== undefined) byKey[key] = result;
      }

      setValues(byKey);
      setState("revealed");

      timerRef.current = window.setTimeout(hide, AUTO_HIDE_MS);
    } catch (caught) {
      setState("error");
      setError(toReadableError(caught));
    }
  }, [handles, target, address, signTypedDataAsync, hide]);

  return { state, values, error, reveal, hide };
}

/**
 * Turns SDK and wallet failures into something a saver can act on.
 *
 * Raw messages here are unhelpful at best — "user rejected the request" surfaced verbatim
 * reads as an error rather than as the deliberate choice it was.
 */
export function toReadableError(caught: unknown): string {
  const message = caught instanceof Error ? caught.message : String(caught);
  const lower = message.toLowerCase();

  if (lower.includes("user rejected") || lower.includes("user denied")) {
    return "Signature declined. Your balance stays hidden.";
  }
  if (lower.includes("no wallet provider")) {
    return "Connect a wallet to reveal private values.";
  }
  if (lower.includes("network") || lower.includes("fetch") || lower.includes("failed to fetch")) {
    return "Could not reach the Zama relayer. Check your connection and try again.";
  }
  if (lower.includes("not allowed") || lower.includes("unauthorized") || lower.includes("acl")) {
    return "This wallet is not authorised to decrypt that value.";
  }
  if (lower.includes("timeout")) {
    return "The relayer took too long to respond. Try again in a moment.";
  }

  return "Decryption failed. Try again, or reconnect your wallet.";
}
