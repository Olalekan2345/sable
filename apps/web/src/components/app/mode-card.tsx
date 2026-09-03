"use client";

import { RoundState, addresses } from "@sable/config";
import Link from "next/link";

import { DrawCountdown } from "@/components/app/draw-countdown";
import { ButtonLink } from "@/components/ui/button";
import { ConfidentialValue, RevealButton } from "@/components/ui/confidential-value";
import { Badge, Card, PrivacyNote } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { useReveal } from "@/lib/hooks/use-reveal";
import { useActiveRound, useRoundCountdown, type RoundSummary } from "@/lib/hooks/use-rounds";
import { useProtocolState, usePositionHandles } from "@/lib/hooks/use-sable";

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
/**
 * Where a closed round has got to, in words and as a fraction.
 *
 * Each phase advances a public cursor, so this reports the mechanism's real position rather
 * than a spinner standing in for one. Nothing here is derived from a ciphertext: the counts
 * are how many accounts have been processed, never which, and never what they hold.
 *
 * `participantCount` is the snapshot taken at close, which is exactly the denominator every
 * phase measures itself against on chain.
 */
function settlementProgress(round: RoundSummary): {
  headline: string;
  detail: string | null;
  fraction: number;
} {
  const { state, participantCount, eligibilityCursor, ticketCursor, drawCursor, drawPointCount } =
    round.lifecycle;
  const settled = Number(round.lifecycle.settleCursor);

  // Guard the denominators: a round that closed with nobody in it completes without ever
  // moving a cursor, and 0/0 would render as NaN%.
  const share = (done: number, total: number) => (total > 0 ? Math.min(done / total, 1) : 1);

  switch (state) {
    case RoundState.Closing:
      return {
        headline: "Round closed. Working out who is eligible.",
        detail: `Eligibility — ${eligibilityCursor} of ${participantCount} savers`,
        fraction: share(eligibilityCursor, participantCount),
      };
    case RoundState.Finalized:
      return {
        headline: "Prize pool fixed. Assigning tickets.",
        detail: `Tickets — ${ticketCursor} of ${participantCount} savers`,
        fraction: share(ticketCursor, participantCount),
      };
    case RoundState.Drawing:
      return {
        headline: "Drawing the winning numbers.",
        detail: `Draw — ${drawCursor} of ${drawPointCount} points`,
        fraction: share(drawCursor, drawPointCount),
      };
    case RoundState.Settling:
      return {
        headline: "Allocating prizes.",
        detail: `Settlement — ${settled} of ${participantCount} savers`,
        fraction: share(settled, participantCount),
      };
    case RoundState.Complete:
      return {
        headline: "Results are in. Only you can see whether you won.",
        detail: null,
        fraction: 1,
      };
    default:
      return { headline: "Round is being settled.", detail: null, fraction: 0 };
  }
}

export function NextDrawCard({ className }: { className?: string }) {
  const { round } = useActiveRound();
  const countdown = useRoundCountdown(round);

  /*
   * Whether this wallet is in the round — answered without decrypting anything.
   *
   * `isParticipant` is a public boolean: registration is visible, positions are not. So the
   * card can state plainly that you are in the draw, which is the question a saver actually
   * has after depositing, and which nothing here answered before. The mode stays a ciphertext
   * and still needs a signature to read, so the wording below promises registration and not a
   * mode the app cannot see.
   */
  const { isParticipant } = usePositionHandles();

  /*
   * How many savers are in the pool — public, and safe to say.
   *
   * Registration is visible on-chain and positions are not, so a count reveals nothing a
   * reader could not already gather from the participant registry. It answers "is anyone else
   * here", which is the question that makes a prize pool feel like a pool.
   *
   * `participantCount` is the whole registry rather than a per-round figure. Everyone
   * registered accrues weight in every round, so for an open round the two are the same thing
   * — up to the slot ceiling below.
   */
  const { participantCount } = useProtocolState();
  const savers = Number(participantCount);

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
  const progress = settlementProgress(round);

  return (
    <Card className={cn("p-7 sm:p-8", className)}>
      <div className="flex items-start justify-between gap-4">
        <p className="text-eyebrow">Next draw</p>
        <Badge tone={isOpen ? "accent" : "neutral"} dot>
          Round #{round.id}
        </Badge>
      </div>

      {isOpen && countdown !== null ? (
        <DrawCountdown
          secondsRemaining={countdown}
          opensAt={round.config.opensAt}
          closesAt={round.config.closesAt}
        />
      ) : (
        <p className="mt-5 text-[15px] text-[var(--color-primary)]">{progress.headline}</p>
      )}

      {isOpen ? (
        <div className="mt-4 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[13px]">
          <span className="text-[var(--color-secondary)]">
            <span className="text-numeric font-semibold text-[var(--color-primary)]">{savers}</span>{" "}
            {savers === 1 ? "saver" : "savers"} in the pool
          </span>
          <span className="text-[var(--color-quaternary)]">·</span>
          <span className="text-[var(--color-tertiary)]">
            {round.config.maxParticipants} scored per round
          </span>
        </div>
      ) : null}

      {/*
        The ceiling is worth naming out loud, because exceeding it is silent on-chain.
        `closeRound` snapshots only the first `maxParticipants` of the registry, and savers
        past that keep their principal and keep accruing weight while being unable to win —
        with nothing anywhere to tell them. A count beside the limit is the cheapest possible
        warning, and it costs a reader nothing when the round is not full.
      */}
      {isOpen && savers > round.config.maxParticipants ? (
        <p className="mt-2 text-[12px] leading-relaxed text-[var(--color-caution)]">
          More savers than slots: only the first {round.config.maxParticipants} registered are
          scored this round. The rest keep their principal and keep earning, but cannot win it.
        </p>
      ) : null}

      {isOpen ? (
        <p className="mt-2.5 text-[13px] leading-relaxed text-[var(--color-tertiary)]">
          {isParticipant ? (
            <>
              <span className="text-[var(--color-accent)]">You are in this round.</span> Your
              yield funds the prize pool unless you have opted out to Steady — check{" "}
              <Link
                href="/app/mode"
                className="underline decoration-[var(--color-quaternary)] underline-offset-[3px] transition-colors hover:text-[var(--color-accent)]"
              >
                Yield mode
              </Link>{" "}
              to see which you are on. Results appear under{" "}
              <Link
                href="/app/rewards"
                className="underline decoration-[var(--color-quaternary)] underline-offset-[3px] transition-colors hover:text-[var(--color-accent)]"
              >
                Rewards
              </Link>{" "}
              once the round settles.
            </>
          ) : (
            <>
              You are not in this round yet. Depositing enters you immediately — weight is
              balance multiplied by time held, so entering earlier earns more of the draw.
            </>
          )}
        </p>
      ) : null}

      {/*
        What is happening right now, while it happens.
        
        The card used to say "Round is being settled." for the whole tail of the lifecycle —
        closing, eligibility, ticketing, the draw and settlement — which can be several minutes
        and a dozen transactions. A saver refreshing during it had no way to tell progress from
        a stall, and the honest answer was already on chain: every phase publishes a cursor.
        
        These counts are public by design. They say how far the mechanism has got, never who is
        in it or what anyone holds.
      */}
      {!isOpen && progress.detail ? (
        <div className="mt-4">
          <p className="text-[13px] text-[var(--color-tertiary)]">{progress.detail}</p>
          <div className="mt-3 h-1 overflow-hidden rounded-full bg-[var(--color-inset)]">
            <div
              className="h-full rounded-full bg-[var(--color-accent)] transition-[width] duration-500"
              style={{ width: `${Math.round(progress.fraction * 100)}%` }}
            />
          </div>
        </div>
      ) : null}

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
