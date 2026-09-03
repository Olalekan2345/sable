"use client";

import { RoundState, addresses, formatCountdown } from "@sable/config";
import Link from "next/link";

import { ButtonLink } from "@/components/ui/button";
import { ConfidentialValue, RevealButton } from "@/components/ui/confidential-value";
import { Badge, Card, PrivacyNote } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { useReveal } from "@/lib/hooks/use-reveal";
import { useActiveRound, useRoundCountdown } from "@/lib/hooks/use-rounds";
import { usePositionHandles } from "@/lib/hooks/use-sable";

/**
 * The yield-mode card.
 *
 * The mode is a ciphertext like any balance, so the dashboard cannot know it until the
 * saver reveals it. Guessing from local state after a reload would be worse than useless —
 * it would show a confident answer that might be wrong about the thing Sable promises to
 * keep secret. So the card reads authoritative on-chain state, and until it is decrypted
 * it says nothing.
 */
export function ModeCard({ className }: { className?: string }) {
  const { modeHandle } = usePositionHandles();
  const { state, value, error, reveal, hide } = useReveal(modeHandle, {
    contractAddress: addresses.sable ?? undefined,
    kind: "bool",
  });

  const isLucky = state === "revealed" ? value === true : null;

  return (
    <Card className={cn("p-7 sm:p-8", className)}>
      <div className="flex items-start justify-between gap-4">
        <p className="text-eyebrow">Your yield mode</p>
        {isLucky !== null ? (
          <Badge tone={isLucky ? "accent" : "neutral"} dot>
            {isLucky ? "Lucky" : "Steady"}
          </Badge>
        ) : null}
      </div>

      <div className="mt-4">
        <ConfidentialValue
          state={state}
          display={isLucky === null ? undefined : isLucky ? "Lucky" : "Steady"}
          error={error}
          size="md"
          currency={false}
          maskLength={6}
        />
      </div>

      <div className="mt-5">
        <RevealButton
          state={state}
          onReveal={reveal}
          onHide={hide}
          labelReveal="Reveal mode"
          labelHide="Hide mode"
        />
      </div>

      {isLucky !== null ? (
        <p className="mt-5 text-[13px] leading-relaxed text-[var(--color-secondary)]">
          {isLucky
            ? "Your yield goes to the shared prize pool, and your savings earn time-weighted entry into each confidential draw."
            : "Your yield compounds privately into your own savings position."}
        </p>
      ) : (
        <PrivacyNote className="mt-5">
          Your choice is encrypted on-chain — reveal it to see which mode you are in.
        </PrivacyNote>
      )}

      <div className="rule-fade my-6" />

      <ButtonLink href="/app/mode" size="sm" variant="secondary">
        {isLucky === null ? "Manage yield mode" : "Change mode privately"}
      </ButtonLink>
    </Card>
  );
}

/**
 * The next-draw panel.
 *
 * Shown to everyone, not only to savers who revealed Lucky. Someone in Steady mode should
 * be able to see what a round looks like without being nudged or made to feel excluded —
 * and hiding it would leak, by omission, which savers had revealed which mode.
 */
export function NextDrawCard({ className }: { className?: string }) {
  const { round } = useActiveRound();
  const countdown = useRoundCountdown(round);

  if (!round) {
    return (
      <Card className={cn("p-7 sm:p-8", className)}>
        <p className="text-eyebrow">Next draw</p>
        <p className="mt-4 text-[15px] text-[var(--color-secondary)]">No round is open.</p>
        <p className="mt-2.5 text-[13px] leading-relaxed text-[var(--color-tertiary)]">
          Your savings keep earning. A new round appears here as soon as one opens.
        </p>
        <div className="rule-fade my-6" />
        <Link
          href="/draws"
          className="text-[13px] text-[var(--color-tertiary)] underline decoration-[var(--color-quaternary)] underline-offset-[3px] transition-colors hover:text-[var(--color-accent)]"
        >
          View past rounds
        </Link>
      </Card>
    );
  }

  const isOpen = round.lifecycle.state === RoundState.Open;

  return (
    <Card className={cn("p-7 sm:p-8", className)}>
      <div className="flex items-start justify-between gap-4">
        <p className="text-eyebrow">Next draw</p>
        <Badge tone={isOpen ? "accent" : "neutral"} dot>
          Round #{round.id}
        </Badge>
      </div>

      <p className="mt-5 text-[15px] text-[var(--color-primary)]">
        {isOpen && countdown !== null ? (
          <>
            Closes in{" "}
            <span className="text-numeric font-semibold text-[var(--color-accent)]">
              {formatCountdown(countdown)}
            </span>
          </>
        ) : (
          "Round is being settled."
        )}
      </p>

      <dl className="mt-6 space-y-0">
        {[
          { label: "Jackpot", value: `${round.config.jackpotWinnerCount} winner` },
          { label: "Mid", value: `${round.config.midWinnerCount} winners` },
          { label: "Small", value: `${round.config.smallWinnerCount} winners` },
        ].map((row) => (
          <div
            key={row.label}
            className="flex items-baseline justify-between border-b border-[var(--color-hairline)] py-3 last:border-0"
          >
            <dt className="text-[13px] text-[var(--color-tertiary)]">{row.label}</dt>
            <dd className="font-mono text-[12px] text-[var(--color-secondary)]">{row.value}</dd>
          </div>
        ))}
      </dl>

      <div className="rule-fade my-6" />

      <Link
        href={`/draws/${round.id}`}
        className="text-[13px] text-[var(--color-tertiary)] underline decoration-[var(--color-quaternary)] underline-offset-[3px] transition-colors hover:text-[var(--color-accent)]"
      >
        View round details
      </Link>
    </Card>
  );
}
