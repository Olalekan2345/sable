"use client";

import { formatAmount } from "@sable/config";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useState } from "react";

import { cn } from "@/lib/cn";
import { LockIcon } from "./primitives";

export type RevealState = "hidden" | "authorizing" | "decrypting" | "revealed" | "error";

const STAGE_COPY: Record<Exclude<RevealState, "hidden" | "revealed">, string> = {
  authorizing: "Authorizing wallet…",
  decrypting: "Decrypting securely…",
  error: "Could not decrypt",
};

export interface ConfidentialValueProps {
  state: RevealState;
  /** Raw on-chain amount, present only once revealed. */
  value?: bigint | null;
  /** Rendered instead of a formatted amount, for non-monetary values such as the mode. */
  display?: string;
  error?: string | null;
  size?: "sm" | "md" | "lg" | "xl";
  currency?: boolean;
  className?: string;
  /** Digits in the masked placeholder. Kept constant so the layout never jumps. */
  maskLength?: number;
  /**
   * Whether the progress phrase is shown beside the mask.
   *
   * On by default, because "Authorizing wallet…" and "Decrypting securely…" distinguish two
   * stages that feel identical otherwise — one is waiting on the wallet, the other on the
   * relayer. Turn it off where the value sits in a fixed-width cell: the phrase is far wider
   * than the mask it replaces, and a row that fits when hidden will overflow when revealing.
   *
   * It is never dropped, only moved out of sight — screen readers still receive it.
   */
  showStatus?: boolean;
}

const SIZES = {
  sm: "text-[15px]",
  md: "text-[22px]",
  lg: "text-[34px] sm:text-[40px]",
  xl: "text-[44px] sm:text-[60px]",
} as const;

/**
 * The confidential value display.
 *
 * Five states, and the distinction between them is the whole point. A masked value is not
 * a loading state: it means "this exists and is private", which is a different thing from
 * "we are still fetching". Rendering `0.00`, `—` or `undefined` while a real balance sits
 * encrypted on-chain would be actively misleading, so this component never does.
 *
 * The reveal transition resolves cipher glyphs into digits rather than cross-fading. It is
 * a small thing, but it is the moment the product's central idea becomes visible: the
 * number was always there, and the saver just proved they were allowed to see it.
 */
export function ConfidentialValue({
  state,
  value,
  display,
  error,
  size = "md",
  currency = true,
  className,
  maskLength = 6,
  showStatus = true,
}: ConfidentialValueProps) {
  const reduceMotion = useReducedMotion();

  const revealed = useMemo(() => {
    if (display !== undefined) return display;
    if (value === null || value === undefined) return null;
    return formatAmount(value, { currency });
  }, [display, value, currency]);

  const mask = currency && display === undefined ? `$ ${"•".repeat(maskLength)}` : "•".repeat(maskLength);

  return (
    <div className={cn("min-h-[1.2em]", className)}>
      <AnimatePresence mode="wait" initial={false}>
        {state === "revealed" && revealed !== null ? (
          <motion.div
            key="revealed"
            initial={reduceMotion ? undefined : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0, y: -4 }}
            transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
            className={cn("text-numeric font-semibold text-[var(--color-primary)]", SIZES[size])}
          >
            {display !== undefined ? revealed : <ScrambleIn text={revealed} disabled={!!reduceMotion} />}
          </motion.div>
        ) : state === "error" ? (
          <motion.div
            key="error"
            initial={reduceMotion ? undefined : { opacity: 0 }}
            animate={{ opacity: 1 }}
            className={cn("font-medium text-[var(--color-danger)]", SIZES[size])}
          >
            <span className="text-[15px]">{error ?? STAGE_COPY.error}</span>
          </motion.div>
        ) : state === "authorizing" || state === "decrypting" ? (
          <motion.div
            key={state}
            initial={reduceMotion ? undefined : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={reduceMotion ? undefined : { opacity: 0 }}
            className="flex items-center gap-3"
            role="status"
            aria-live="polite"
          >
            <span className={cn("masked-value scan", SIZES[size])}>{mask}</span>
            <span
              className={
                showStatus ? "text-[12px] text-[var(--color-tertiary)]" : "sr-only"
              }
            >
              {STAGE_COPY[state]}
            </span>
          </motion.div>
        ) : (
          <motion.div
            key="hidden"
            initial={reduceMotion ? undefined : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={reduceMotion ? undefined : { opacity: 0 }}
            className={cn("masked-value", SIZES[size])}
          >
            {mask}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const GLYPHS = "0123456789ABCDEF";

/**
 * Resolves random hex glyphs into the final characters, left to right.
 *
 * Deliberately brief (about a third of a second) and skipped entirely under reduced
 * motion, where the value simply appears.
 */
function ScrambleIn({ text, disabled }: { text: string; disabled: boolean }) {
  const [scrambled, setScrambled] = useState("");

  // With the animation off there is nothing to resolve, so the final text is derived rather
  // than written into state — no frame of empty string before it appears.
  const output = disabled ? text : scrambled;

  useEffect(() => {
    if (disabled) return;

    let frame = 0;
    const total = 10;

    const id = window.setInterval(() => {
      frame += 1;
      const settled = Math.floor((frame / total) * text.length);

      setScrambled(
        text
          .split("")
          .map((char, index) => {
            if (index < settled || char === "." || char === "," || char === "$" || char === " ") {
              return char;
            }
            return GLYPHS[Math.floor(Math.random() * GLYPHS.length)] ?? char;
          })
          .join(""),
      );

      if (frame >= total) {
        setScrambled(text);
        window.clearInterval(id);
      }
    }, 32);

    return () => window.clearInterval(id);
  }, [text, disabled]);

  return <span>{output || text}</span>;
}

/**
 * The reveal / hide control that sits beneath a confidential value.
 */
export function RevealButton({
  state,
  onReveal,
  onHide,
  labelReveal = "Reveal balance",
  labelHide = "Hide balance",
  className,
  disabled,
}: {
  state: RevealState;
  onReveal: () => void;
  onHide: () => void;
  labelReveal?: string;
  labelHide?: string;
  className?: string;
  disabled?: boolean;
}) {
  const busy = state === "authorizing" || state === "decrypting";
  const isRevealed = state === "revealed";

  return (
    <button
      type="button"
      onClick={isRevealed ? onHide : onReveal}
      disabled={disabled || busy}
      className={cn(
        "group inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5",
        "border-[var(--color-hairline-strong)] bg-[var(--color-raised)]",
        "font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-secondary)]",
        "transition-colors duration-200",
        "hover:border-[var(--color-hairline-accent)] hover:text-[var(--color-primary)]",
        "disabled:opacity-50",
        className,
      )}
    >
      {isRevealed ? (
        <EyeOffIcon className="h-3 w-3" />
      ) : (
        <LockIcon className="h-3 w-3 text-[var(--color-accent)]" />
      )}
      {busy ? "Working…" : isRevealed ? labelHide : labelReveal}
    </button>
  );
}

function EyeOffIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.1"
      strokeLinecap="round"
      className={className}
    >
      <path d="M2 6s1.6-2.8 4-2.8S10 6 10 6s-1.6 2.8-4 2.8S2 6 2 6z" />
      <circle cx="6" cy="6" r="1.1" />
      <path d="M2.2 9.8L9.8 2.2" />
    </svg>
  );
}
