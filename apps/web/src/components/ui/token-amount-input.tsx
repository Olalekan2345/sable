"use client";

import { useId } from "react";
import { formatUnits, parseUnits } from "viem";

import { cn } from "@/lib/cn";

/**
 * Amount entry for a **public** ERC-20.
 *
 * Deliberately separate from `CurrencyInput`, which is fixed to the confidential asset's six
 * decimals and its dollar framing. The tokens on the public side of the wrapper are neither:
 * Zama publishes eighteen-decimal underlyings (WETH, ZAMA, tGBP) alongside the six-decimal
 * stablecoins, so decimals and symbol are parameters rather than assumptions. Formatting an
 * eighteen-decimal balance through the confidential formatter would overstate it by a factor
 * of a trillion.
 *
 * The value is ordinary public information — unlike a confidential amount it is already
 * visible on-chain — so there is no secrecy obligation here beyond not being careless with it.
 */
export function TokenAmountInput({
  value,
  onChange,
  decimals,
  symbol,
  max,
  label,
  hint,
  error,
  disabled,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  decimals: number;
  symbol: string;
  /** Wallet balance, used for the Max affordance. */
  max?: bigint | null;
  label: string;
  hint?: string;
  error?: string | null;
  disabled?: boolean;
  className?: string;
}) {
  const id = useId();
  const describedBy = `${id}-hint`;

  const handleChange = (next: string) => {
    // Permit only a well-formed decimal while typing, bounded by the token's own precision,
    // so the field can never hold a value the parser would go on to reject.
    if (next === "" || new RegExp(`^\\d*\\.?\\d{0,${decimals}}$`).test(next)) onChange(next);
  };

  return (
    <div className={className}>
      <div className="mb-2.5 flex items-baseline justify-between gap-4">
        <label htmlFor={id} className="text-eyebrow">
          {label}
        </label>

        {max !== null && max !== undefined ? (
          <button
            type="button"
            onClick={() => onChange(formatUnits(max, decimals))}
            disabled={disabled}
            className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-accent)] transition-opacity hover:opacity-75 disabled:opacity-40"
          >
            Max {formatTokenAmount(max, decimals)}
          </button>
        ) : null}
      </div>

      <div
        className={cn(
          "relative flex items-center rounded-[var(--radius-md)] border bg-[var(--color-inset)] transition-colors",
          error
            ? "border-[rgba(255,107,107,0.4)]"
            : "border-[var(--color-hairline-strong)] focus-within:border-[var(--color-hairline-accent)]",
        )}
      >
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(event) => handleChange(event.target.value)}
          disabled={disabled}
          placeholder="0.00"
          aria-describedby={hint || error ? describedBy : undefined}
          aria-invalid={error ? true : undefined}
          className={cn(
            "text-numeric w-full bg-transparent py-5 pl-5 pr-3 text-[22px] font-medium",
            "text-[var(--color-primary)] placeholder:text-[var(--color-quaternary)]",
            "outline-none disabled:opacity-50",
          )}
        />

        <span
          aria-hidden="true"
          className="shrink-0 pr-5 font-mono text-[12px] uppercase tracking-[0.1em] text-[var(--color-tertiary)]"
        >
          {symbol}
        </span>
      </div>

      {error ? (
        <p id={describedBy} role="alert" className="mt-2.5 text-[12px] text-[var(--color-danger)]">
          {error}
        </p>
      ) : hint ? (
        <p id={describedBy} className="mt-2.5 text-[12px] text-[var(--color-tertiary)]">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Formats a raw token amount for display, trimming trailing zeros.
 *
 * An eighteen-decimal token rendered in full is unreadable, and padding a six-decimal one to
 * `0.500000` reads as false precision. Significant digits are never dropped — only zeros that
 * carry no information.
 */
export function formatTokenAmount(raw: bigint, decimals: number, maxFractionDigits = 6): string {
  const text = formatUnits(raw, decimals);
  const [whole = "0", fraction = ""] = text.split(".");

  const trimmed = fraction.slice(0, maxFractionDigits).replace(/0+$/, "");
  const grouped = BigInt(whole).toLocaleString("en-US");

  return trimmed ? `${grouped}.${trimmed}` : grouped;
}

/**
 * Validates a typed public-token amount.
 *
 * Mirrors `validateAmount` for the confidential side, with the same principle: the check is
 * advisory. The contract is authoritative, and the point of validating here is only to stop
 * someone spending gas on a transaction that cannot succeed.
 */
export function validateTokenAmount(
  input: string,
  options: { decimals: number; max?: bigint | null; maxMessage?: string },
): { amount: bigint | null; error: string | null } {
  const trimmed = input.trim();
  if (trimmed === "") return { amount: null, error: null };

  let amount: bigint;
  try {
    amount = parseUnits(trimmed, options.decimals);
  } catch {
    return { amount: null, error: "Enter a valid amount." };
  }

  if (amount === 0n) return { amount: null, error: "Enter an amount greater than zero." };

  if (options.max !== null && options.max !== undefined && amount > options.max) {
    return {
      amount,
      error:
        options.maxMessage ??
        `That is more than the ${formatTokenAmount(options.max, options.decimals)} in your wallet.`,
    };
  }

  return { amount, error: null };
}
