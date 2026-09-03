"use client";

import { assetSymbol, formatAmount, parseAmount } from "@sable/config";
import { useId } from "react";

import { cn } from "@/lib/cn";

/**
 * Amount entry for a confidential asset.
 *
 * Two rules shape this component:
 *
 * 1. **The value never leaves the browser as plaintext.** It is not logged, not put in a
 *    query string, not persisted. It exists in React state until it is encrypted.
 * 2. **Validation is advisory, not authoritative.** The contract clamps deposits to the
 *    balance ceiling and withdrawals to the available balance, so nothing here can put a
 *    position at risk. What it can do is stop a saver from spending gas on a transfer that
 *    will silently move nothing — ERC-7984 transfers are all-or-nothing, so a deposit
 *    larger than the wallet balance is a no-op rather than a partial fill.
 */
export function CurrencyInput({
  value,
  onChange,
  max,
  maxLabel = "Max",
  label,
  hint,
  error,
  disabled,
  autoFocus,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Known upper bound, when the saver has revealed it. `null` means unknown. */
  max?: bigint | null;
  maxLabel?: string;
  label: string;
  hint?: string;
  error?: string | null;
  disabled?: boolean;
  autoFocus?: boolean;
  className?: string;
}) {
  const id = useId();
  const describedBy = `${id}-hint`;

  const handleChange = (next: string) => {
    // Permit only a well-formed decimal while typing, so the field cannot enter a state
    // the parser would later reject.
    if (next === "" || /^\d*\.?\d{0,6}$/.test(next)) onChange(next);
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
            onClick={() => onChange(formatAmount(max, { decimals: 6, currency: false }).replace(/,/g, ""))}
            disabled={disabled}
            className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-accent)] transition-opacity hover:opacity-75 disabled:opacity-40"
          >
            {maxLabel} {formatAmount(max)}
          </button>
        ) : null}
      </div>

      <div
        className={cn(
          "relative flex items-center rounded-[var(--radius-md)] border bg-[var(--color-inset)] transition-colors",
          error
            ? "border-[rgba(255,107,107,0.4)]"
            : "border-[var(--color-hairline-strong)] focus-within:border-[var(--color-accent)]",
          /*
           * Focus is shown on the whole field, because the whole field is what is being
           * typed into — the input marks itself `data-focus-ring="inset"` to opt out of
           * the global outline, which would otherwise cut across the currency sign and
           * the token symbol either side of it.
           *
           * A translucent glow rather than a solid ring with an offset: an offset ring
           * needs its gap painted in whatever sits behind the field, and these appear on
           * more than one card colour. Alpha composites over any of them.
           */
          "focus-within:shadow-[0_0_0_3px_rgba(255,206,26,0.22)]",
        )}
      >
        <span
          aria-hidden="true"
          className="pl-5 text-[22px] font-medium text-[var(--color-tertiary)]"
        >
          $
        </span>

        <input
          id={id}
          data-focus-ring="inset"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          // Keeps password managers and browser autofill away from a financial amount.
          data-1p-ignore
          data-lpignore="true"
          autoFocus={autoFocus}
          disabled={disabled}
          value={value}
          onChange={(event) => handleChange(event.target.value)}
          placeholder="0.00"
          aria-describedby={hint || error ? describedBy : undefined}
          aria-invalid={error ? true : undefined}
          className={cn(
            "text-numeric w-full bg-transparent px-3 py-5 text-[22px] font-medium",
            "text-[var(--color-primary)] placeholder:text-[var(--color-quaternary)]",
            "outline-none disabled:opacity-50",
          )}
        />

        <span className="pr-5 font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--color-quaternary)]">
          {assetSymbol()}
        </span>
      </div>

      {error ? (
        <p id={describedBy} role="alert" className="mt-2.5 text-[12px] text-[var(--color-danger)]">
          {error}
        </p>
      ) : hint ? (
        <p id={describedBy} className="mt-2.5 text-[12px] leading-relaxed text-[var(--color-tertiary)]">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Shared validation for amount fields. Returns an error string, or null when valid. */
export function validateAmount(
  input: string,
  options: { max?: bigint | null; maxMessage?: string } = {},
): { amount: bigint | null; error: string | null } {
  if (input.trim() === "") return { amount: null, error: null };

  const amount = parseAmount(input);
  if (amount === null) return { amount: null, error: "Enter a valid amount." };
  if (amount === 0n) return { amount: null, error: "Enter an amount greater than zero." };

  if (options.max !== null && options.max !== undefined && amount > options.max) {
    return {
      amount,
      error: options.maxMessage ?? `That is more than your available ${formatAmount(options.max)}.`,
    };
  }

  return { amount, error: null };
}
