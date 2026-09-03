"use client";

import { cn } from "@/lib/cn";

/**
 * The clock on the round.
 *
 * A saver's first question after depositing is *when do I find out*, and the answer was a
 * phrase — "closes in 4h 12m" — that looked identical for four minutes at a time. Minute
 * granularity is fine in a sentence and useless as a clock: it gives no sense of a round
 * running down, and near the end it collapses to "under a minute" and then stops moving
 * entirely while the most interesting sixty seconds of the round go by.
 *
 * So this renders the remaining time as digits that visibly tick, over a bar showing how much
 * of the window has gone. The seconds come free — {useRoundCountdown} already recomputes every
 * second against a shared clock; only the formatting was throwing them away.
 *
 * ## Accessibility
 *
 * The digits are `aria-hidden` and the accessible name is a single phrase at minute
 * granularity. A per-second `aria-live` region would announce sixty times a minute and make
 * the page unusable with a screen reader, which is a worse outcome than coarser wording. There
 * is deliberately no `aria-live` at all: `role="timer"` exposes the value to anyone who goes
 * looking without interrupting anyone who has not.
 */
export function DrawCountdown({
  secondsRemaining,
  opensAt,
  closesAt,
  className,
}: {
  secondsRemaining: number;
  opensAt: bigint;
  closesAt: bigint;
  className?: string;
}) {
  const total = Math.max(Number(closesAt) - Number(opensAt), 1);
  const elapsed = Math.min(Math.max(total - secondsRemaining, 0), total);
  const fraction = elapsed / total;

  const days = Math.floor(secondsRemaining / 86400);
  const hours = Math.floor((secondsRemaining % 86400) / 3600);
  const minutes = Math.floor((secondsRemaining % 3600) / 60);
  const seconds = secondsRemaining % 60;

  // Days only when there are any. A leading "00" on a six-hour round is noise pretending to
  // be information.
  const segments = [
    ...(days > 0 ? [{ label: "days", value: days }] : []),
    { label: "hrs", value: hours },
    { label: "min", value: minutes },
    { label: "sec", value: seconds },
  ];

  const spoken =
    secondsRemaining <= 0
      ? "Round is closing"
      : `Round closes in ${days > 0 ? `${days} days ` : ""}${hours} hours ${minutes} minutes`;

  return (
    <div className={cn("mt-5", className)} role="timer" aria-label={spoken}>
      <div className="flex items-end gap-1.5" aria-hidden="true">
        {segments.map((segment, index) => (
          <div key={segment.label} className="flex items-end gap-1.5">
            <div className="flex flex-col items-center">
              <span
                className={cn(
                  "text-numeric tabular-nums leading-none",
                  "rounded-[var(--radius-xs)] bg-[var(--color-inset)] px-2.5 py-2",
                  "text-[26px] font-semibold text-[var(--color-primary)] sm:text-[30px]",
                )}
              >
                {String(segment.value).padStart(2, "0")}
              </span>
              <span className="mt-1.5 text-[10px] uppercase tracking-[0.14em] text-[var(--color-quaternary)]">
                {segment.label}
              </span>
            </div>
            {index < segments.length - 1 ? (
              <span className="pb-[26px] text-[20px] leading-none text-[var(--color-quaternary)]">
                :
              </span>
            ) : null}
          </div>
        ))}
      </div>

      <div className="mt-4 h-1 overflow-hidden rounded-full bg-[var(--color-inset)]">
        <div
          className="h-full rounded-full bg-[var(--color-accent)] transition-[width] duration-1000 ease-linear"
          style={{ width: `${(fraction * 100).toFixed(2)}%` }}
        />
      </div>
    </div>
  );
}
