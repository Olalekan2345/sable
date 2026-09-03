"use client";

import type { TxStage } from "@sable/config";
import { AnimatePresence, motion } from "motion/react";

import { ExplorerLink } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { STAGE_COPY } from "@/lib/hooks/use-confidential-tx";

/**
 * The transaction state machine, rendered.
 *
 * Shows the actual stage rather than a spinner, because the stages genuinely differ in
 * kind and duration: encrypting is local CPU work, awaiting-wallet is blocked on a human,
 * and confirming is blocked on a block. A saver who knows which of those is happening will
 * wait; one watching an anonymous spinner will refresh and try again.
 *
 * Nothing ever renders as complete before the receipt says so.
 */
// `switching-network` is deliberately absent: it only happens when the wallet is on the wrong
// chain, so showing it as a permanent step would imply every transaction has one.
const ORDER: TxStage[] = ["preparing", "encrypting", "awaiting-wallet", "submitting", "confirming"];

export function TransactionStatus({
  stage,
  error,
  detail,
  txHash,
  className,
}: {
  stage: TxStage;
  error?: string | null;
  /** Raw failure, shown behind a disclosure. */
  detail?: string | null;
  txHash?: `0x${string}` | null;
  className?: string;
}) {
  if (stage === "idle") return null;

  if (stage === "error") {
    return (
      <div
        role="alert"
        className={cn(
          "rounded-[var(--radius-md)] border border-[rgba(255,107,107,0.28)] bg-[rgba(255,107,107,0.05)] p-4",
          className,
        )}
      >
        <p className="text-[13px] font-medium text-[var(--color-danger)]">
          {error ?? "Something went wrong."}
        </p>

        {detail ? (
          <details className="group mt-2.5">
            <summary className="cursor-pointer list-none font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-tertiary)] transition-colors hover:text-[var(--color-secondary)]">
              Technical details
            </summary>
            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-[var(--radius-xs)] bg-[var(--color-inset)] p-3 font-mono text-[10px] leading-relaxed text-[var(--color-quaternary)]">
              {detail}
            </pre>
          </details>
        ) : null}
        {txHash ? (
          <ExplorerLink hash={txHash} label="View the failed transaction" className="mt-2.5" />
        ) : (
          <p className="mt-1.5 text-[12px] text-[var(--color-tertiary)]">
            Nothing was submitted, and your position is unchanged.
          </p>
        )}
      </div>
    );
  }

  if (stage === "complete") {
    return (
      <div
        role="status"
        className={cn(
          "rounded-[var(--radius-md)] border border-[rgba(94,224,138,0.26)] bg-[rgba(94,224,138,0.05)] p-4",
          className,
        )}
      >
        <div className="flex items-center gap-2.5">
          <motion.svg
            viewBox="0 0 16 16"
            className="h-4 w-4 text-[var(--color-verified)]"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            aria-hidden="true"
          >
            <motion.path
              d="M3.5 8.5l3 3 6-6.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            />
          </motion.svg>
          <p className="text-[13px] font-medium text-[var(--color-verified)]">Confirmed on-chain</p>
        </div>
        {txHash ? <ExplorerLink hash={txHash} label="View on explorer" className="mt-2.5" /> : null}
      </div>
    );
  }

  const activeIndex = ORDER.indexOf(stage);
  const copy = STAGE_COPY[stage];

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn("surface-inset p-4", className)}
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="relative flex h-2 w-2 shrink-0 items-center justify-center"
        >
          <span className="pulse-ring absolute inset-0" />
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]" />
        </span>

        <AnimatePresence mode="wait">
          <motion.p
            key={stage}
            initial={{ opacity: 0, y: 3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -3 }}
            transition={{ duration: 0.2 }}
            className="text-[13px] font-medium text-[var(--color-primary)]"
          >
            {copy.label}
          </motion.p>
        </AnimatePresence>
      </div>

      {copy.detail ? (
        <p className="mt-2 pl-5 text-[12px] leading-relaxed text-[var(--color-tertiary)]">
          {copy.detail}
        </p>
      ) : null}

      {/* Progress rail — five discrete stages, not a fake percentage. */}
      <div className="mt-4 flex gap-1.5 pl-5">
        {ORDER.map((step, index) => (
          <span
            key={step}
            className={cn(
              "h-[2px] flex-1 rounded-full transition-colors duration-500",
              index <= activeIndex ? "bg-[var(--color-accent)]" : "bg-[var(--color-elevated)]",
            )}
          />
        ))}
      </div>

      {txHash ? <ExplorerLink hash={txHash} label="View on explorer" className="mt-3 pl-5" /> : null}
    </div>
  );
}
