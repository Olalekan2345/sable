"use client";

import { cn } from "@/lib/cn";

/**
 * An error, with the raw failure available on request.
 *
 * Sable maps chain failures to plain language, which is right for the common cases and
 * actively harmful when the mapping is wrong: a confident, incorrect message sends someone
 * to fix the wrong thing. That happened — a wrong-network error was being reported as "Sable
 * is not authorised to move your tokens", which told the saver to retry the exact step that
 * had just failed.
 *
 * So the friendly message is always accompanied by the real one, one click away. It costs
 * nothing when the mapping is right and saves the situation when it is not.
 *
 * Nothing confidential can appear in the detail: every private quantity in Sable is a
 * ciphertext, so a raw chain error can carry an address and a function name but never an
 * amount or a mode.
 */
export function ErrorNotice({
  message,
  detail,
  className,
}: {
  message: string;
  detail?: string | null;
  className?: string;
}) {
  if (!message) return null;

  return (
    <div
      role="alert"
      className={cn(
        "rounded-[var(--radius-md)] border border-[rgba(255,107,107,0.28)] bg-[rgba(255,107,107,0.05)] p-4",
        className,
      )}
    >
      <p className="text-[13px] font-medium text-[var(--color-danger)]">{message}</p>

      {detail ? (
        <details className="group mt-2.5">
          <summary
            className={cn(
              "cursor-pointer list-none font-mono text-[10px] uppercase tracking-[0.14em]",
              "text-[var(--color-tertiary)] transition-colors hover:text-[var(--color-secondary)]",
              "focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]",
            )}
          >
            Technical details
            <span aria-hidden="true" className="ml-1.5 inline-block group-open:hidden">
              +
            </span>
            <span aria-hidden="true" className="ml-1.5 hidden group-open:inline-block">
              −
            </span>
          </summary>

          <pre className="mt-2.5 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-[var(--radius-xs)] bg-[var(--color-inset)] p-3 font-mono text-[10px] leading-relaxed text-[var(--color-quaternary)]">
            {detail}
          </pre>
        </details>
      ) : null}
    </div>
  );
}
