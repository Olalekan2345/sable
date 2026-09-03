"use client";

import {
  ROUND_STATE_DESCRIPTIONS,
  ROUND_STATE_LABELS,
  RoundState,
  addresses,
  formatAmount,
  formatBps,
  formatTimestamp,
} from "@sable/config";
import Link from "next/link";
import { use } from "react";

import {
  Badge,
  Card,
  CardHeader,
  DataRow,
  EmptyState,
  ExplorerLink,
  PageHeader,
  Skeleton,
} from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { useRound, useRoundAggregates, useRoundDrawPoints } from "@/lib/hooks/use-rounds";

/**
 * Round verification.
 *
 * Everything a sceptic needs to check that a round ran correctly, and nothing that would
 * compromise a participant. The privacy panel near the bottom is not decoration: it names,
 * explicitly, each field that exists on-chain but is not readable.
 */
export default function RoundPage({ params }: { params: Promise<{ roundId: string }> }) {
  const { roundId } = use(params);
  const id = Number.parseInt(roundId, 10);

  const { round, isLoading } = useRound(Number.isFinite(id) ? id : null);
  const { aggregates, notPublished } = useRoundAggregates(round);
  const { points } = useRoundDrawPoints(round);

  if (!Number.isFinite(id) || id <= 0) {
    return (
      <div className="mx-auto max-w-[880px] px-5 sm:px-8">
        <Card>
          <EmptyState title="Unknown round" description="That round id is not valid." />
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="mx-auto max-w-[880px] px-5 sm:px-8">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="mt-6 h-64 w-full" />
      </div>
    );
  }

  if (!round || round.lifecycle.state === RoundState.None) {
    return (
      <div className="mx-auto max-w-[880px] px-5 sm:px-8">
        <Card>
          <EmptyState
            title="Round not found"
            description="This round has not been configured on the deployed contract."
            action={
              <Link
                href="/draws"
                className="text-[13px] text-[var(--color-accent)] underline underline-offset-[3px]"
              >
                Back to the ledger
              </Link>
            }
          />
        </Card>
      </div>
    );
  }

  const { config, lifecycle } = round;

  // Verification inputs for the published draw points, derived from the same public round
  // configuration a third party would use. `1n << bits` rather than `2 ** bits` because the
  // domain exceeds Number's exact-integer range once ticketBits passes 53.
  const expectedPointCount =
    config.jackpotWinnerCount + config.midWinnerCount + config.smallWinnerCount;
  const ticketDomain = 1n << BigInt(config.ticketBits);
  const pointsInDomain = (points ?? []).every((point) => point >= 0n && point < ticketDomain);
  const pointCountMatches = (points ?? []).length === expectedPointCount;
  const complete = lifecycle.state === RoundState.Complete;

  return (
    <div className="mx-auto max-w-[880px] px-5 sm:px-8">
      <Link
        href="/draws"
        className="mb-8 inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--color-tertiary)] transition-colors hover:text-[var(--color-primary)]"
      >
        <span aria-hidden="true">←</span> Draw ledger
      </Link>

      <PageHeader
        eyebrow={`Round #${round.id}`}
        title={ROUND_STATE_LABELS[lifecycle.state]}
        description={ROUND_STATE_DESCRIPTIONS[lifecycle.state]}
        action={
          <Badge tone={complete ? "verified" : lifecycle.state === RoundState.Open ? "accent" : "neutral"} dot>
            {ROUND_STATE_LABELS[lifecycle.state]}
          </Badge>
        }
      />

      <div className="flex flex-col gap-4">
        {/* ------------------------------------------------------- Summary */}
        <Card className="p-7 sm:p-8">
          <CardHeader eyebrow="Draw summary" title="Timing and participation" />
          <dl className="mt-6">
            <DataRow label="Opened">
              {lifecycle.openedAt > 0n ? formatTimestamp(lifecycle.openedAt) : "Not yet opened"}
            </DataRow>
            <DataRow label="Scheduled close">{formatTimestamp(config.closesAt)}</DataRow>
            <DataRow label="Closed">
              {lifecycle.closedAt > 0n ? formatTimestamp(lifecycle.closedAt) : "—"}
            </DataRow>
            <DataRow label="Completed">
              {lifecycle.completedAt > 0n ? formatTimestamp(lifecycle.completedAt) : "—"}
            </DataRow>
            <DataRow label="Participants scored" hint="count only">
              <span className="text-numeric">{lifecycle.participantCount}</span>
            </DataRow>
            <DataRow label="Draw points">
              <span className="text-numeric">{lifecycle.drawPointCount}</span>
            </DataRow>
          </dl>
        </Card>

        {/* ------------------------------------------------- Prize structure */}
        <Card className="p-7 sm:p-8">
          <CardHeader
            eyebrow="Prize structure"
            title="Pool and tiers"
            action={
              notPublished ? (
                <Badge tone="neutral">Not yet published</Badge>
              ) : (
                <Badge tone="accent">Publicly decrypted</Badge>
              )
            }
          />

          {notPublished ? (
            <p className="mt-6 text-[13px] leading-relaxed text-[var(--color-tertiary)]">
              Prize figures are published when the round is finalized. Until then there is nothing
              to show — and Sable will not estimate.
            </p>
          ) : (
            <>
              <div className="mt-7">
                <p className="text-eyebrow mb-2">Total prize pool</p>
                <p className="text-numeric text-[34px] font-semibold text-[var(--color-accent)]">
                  {aggregates?.prizePool !== null && aggregates?.prizePool !== undefined
                    ? formatAmount(aggregates.prizePool, { currency: true })
                    : "—"}
                </p>
                <p className="mt-2 text-[12px] text-[var(--color-tertiary)]">
                  Funded entirely by yield contributed by savers in Lucky mode.
                </p>
              </div>

              <div className="mt-8 grid gap-3 sm:grid-cols-3">
                {[
                  {
                    name: "Jackpot",
                    count: config.jackpotWinnerCount,
                    bps: config.jackpotShareBps,
                    amount: aggregates?.jackpotPrize,
                    accent: true,
                  },
                  {
                    name: "Mid",
                    count: config.midWinnerCount,
                    bps: config.midShareBps,
                    amount: aggregates?.midPrize,
                    accent: false,
                  },
                  {
                    name: "Small",
                    count: config.smallWinnerCount,
                    bps: config.smallShareBps,
                    amount: aggregates?.smallPrize,
                    accent: false,
                  },
                ].map((tier) => (
                  <div
                    key={tier.name}
                    className={cn(
                      "surface-inset p-5",
                      tier.accent && "ring-1 ring-[var(--color-hairline-accent)]",
                    )}
                  >
                    <div className="flex items-baseline justify-between">
                      <span
                        className={cn(
                          "font-mono text-[10px] uppercase tracking-[0.16em]",
                          tier.accent ? "text-[var(--color-accent)]" : "text-[var(--color-secondary)]",
                        )}
                      >
                        {tier.name}
                      </span>
                      <span className="font-mono text-[10px] text-[var(--color-quaternary)]">
                        {formatBps(tier.bps)}
                      </span>
                    </div>

                    <p className="text-numeric mt-4 text-[19px] font-semibold text-[var(--color-primary)]">
                      {tier.amount !== null && tier.amount !== undefined
                        ? formatAmount(tier.amount, { currency: true })
                        : "—"}
                    </p>
                    <p className="mt-1 text-[11px] text-[var(--color-tertiary)]">
                      × {tier.count} {tier.count === 1 ? "winner" : "winners"}
                    </p>
                  </div>
                ))}
              </div>

              {/* Rollover outcome — a one-bit disclosure about aggregate allocation. */}
              {complete ? (
                <div
                  className={cn(
                    "mt-7 rounded-[var(--radius-md)] border p-5",
                    aggregates?.jackpotHit === false
                      ? "border-[var(--color-hairline-accent)] bg-[rgba(255,206,26,0.05)]"
                      : "border-[var(--color-hairline)]",
                  )}
                >
                  {aggregates?.jackpotHit === false ? (
                    <>
                      <p className="text-[15px] font-semibold text-[var(--color-accent)]">
                        Jackpot rolled forward
                      </p>
                      <p className="mt-2 text-[13px] leading-relaxed text-[var(--color-secondary)]">
                        No eligible ticket matched this draw, so{" "}
                        {aggregates?.rollover !== null && aggregates?.rollover !== undefined
                          ? formatAmount(aggregates.rollover, { currency: true })
                          : "the jackpot"}{" "}
                        carries into the next round&rsquo;s pool.
                      </p>
                    </>
                  ) : aggregates?.jackpotHit === true ? (
                    <>
                      <p className="text-[15px] font-semibold text-[var(--color-verified)]">
                        Jackpot awarded
                      </p>
                      <p className="mt-2 text-[13px] leading-relaxed text-[var(--color-secondary)]">
                        A ticket matched. The winner was credited privately and only they can
                        decrypt the result.
                      </p>
                    </>
                  ) : (
                    <p className="text-[13px] text-[var(--color-tertiary)]">
                      Jackpot outcome not resolvable yet.
                    </p>
                  )}
                </div>
              ) : null}
            </>
          )}
        </Card>

        {/* -------------------------------------------------- Verification */}
        <Card className="p-7 sm:p-8">
          <CardHeader eyebrow="Verification" title="What executed on-chain" />

          <ol className="mt-6 flex flex-col gap-0">
            {[
              {
                label: "Eligibility evaluated",
                detail: "Every registered saver checkpointed to the close time.",
                done: lifecycle.eligibilityCursor >= lifecycle.participantCount && lifecycle.closedAt > 0n,
                progress: `${lifecycle.eligibilityCursor}/${lifecycle.participantCount}`,
              },
              {
                label: "Ticket ranges assigned",
                detail: `Confidential ranges inside a fixed 2^${config.ticketBits} domain.`,
                done: lifecycle.ticketCursor >= lifecycle.participantCount && lifecycle.state > RoundState.Finalized,
                progress: `${lifecycle.ticketCursor}/${lifecycle.participantCount}`,
              },
              {
                label: "Encrypted randomness generated",
                detail: "Bounded random points drawn on-chain, readable by nobody.",
                done: lifecycle.drawCursor >= lifecycle.drawPointCount && lifecycle.drawPointCount > 0,
                progress: `${lifecycle.drawCursor}/${lifecycle.drawPointCount}`,
              },
              {
                label: "Winner conditions computed",
                detail: "Each saver compared against each point over ciphertext.",
                done: Number(lifecycle.settleCursor) >= lifecycle.participantCount && lifecycle.participantCount > 0,
                progress: `${lifecycle.settleCursor}/${lifecycle.participantCount}`,
              },
              {
                label: "Rewards allocated",
                detail: "Encrypted amounts credited — zero for non-winners.",
                done: complete,
                progress: complete ? "done" : "pending",
              },
            ].map((step) => (
              <li
                key={step.label}
                className="flex items-start gap-4 border-b border-[var(--color-hairline)] py-4 last:border-0"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                    step.done
                      ? "border-[var(--color-verified)] bg-[rgba(94,224,138,0.12)]"
                      : "border-[var(--color-hairline-strong)]",
                  )}
                >
                  {step.done ? (
                    <svg aria-hidden="true" viewBox="0 0 10 10" className="h-2 w-2 text-[var(--color-verified)]" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <path d="M2 5.2l2 2 4-4.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : null}
                </span>

                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-[var(--color-primary)]">{step.label}</p>
                  <p className="mt-1 text-[12px] leading-relaxed text-[var(--color-tertiary)]">
                    {step.detail}
                  </p>
                </div>

                <span className="shrink-0 font-mono text-[11px] text-[var(--color-quaternary)]">
                  {step.progress}
                </span>
              </li>
            ))}
          </ol>

          {/*
            The numbers themselves. Until the round completed these were ciphertexts nobody
            could read — including whoever sent the transaction that drew them — and they are
            released only once settlement is finished and no outcome can still be influenced.
          */}
          {points && points.length > 0 ? (
            <div className="mt-7 border-t border-[var(--color-hairline)] pt-6">
              <div className="flex items-baseline justify-between gap-4">
                <p className="text-eyebrow">The numbers drawn</p>
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-verified)]">
                  Publicly decrypted
                </span>
              </div>

              <ul className="mt-4 flex flex-wrap gap-2">
                {points.map((point, index) => (
                  <li
                    key={`${index}-${point}`}
                    className="text-numeric rounded-[var(--radius-xs)] border border-[var(--color-hairline-strong)] bg-[var(--color-inset)] px-2.5 py-1.5 text-[12px] text-[var(--color-primary)]"
                  >
                    {point.toString()}
                  </li>
                ))}
              </ul>

              {/*
                Checked, not claimed. The page could simply assert that the points are
                well-formed, but a reader has no reason to take that on trust from the same
                interface that is reporting the outcome — and an assertion that silently stops
                being true is worse than none. Both properties are recomputed here from the
                published values and the public round configuration, and the wording follows
                what the arithmetic actually says.
              */}
              <p className="mt-4 max-w-[62ch] text-[12px] leading-relaxed text-[var(--color-tertiary)]">
                {pointsInDomain && pointCountMatches ? (
                  <>
                    Checked: all {points.length} points fall inside the 2^{config.ticketBits} ticket
                    domain, and there are exactly as many as this round was configured to draw.
                  </>
                ) : (
                  <>
                    These points do not match this round&rsquo;s configuration
                    {pointCountMatches ? "" : ` — ${points.length} published, ${expectedPointCount} configured`}
                    {pointsInDomain ? "" : " — at least one falls outside the ticket domain"}. Treat
                    the round as unverified and inspect the transactions directly.
                  </>
                )}{" "}
                Ticket ranges stay encrypted, so these show where the draw landed — never whose
                holding it landed in.
              </p>
            </div>
          ) : null}

          {addresses.sable ? (
            <div className="mt-6">
              <ExplorerLink address={addresses.sable} label="Inspect all round transactions ↗" />
            </div>
          ) : null}
        </Card>

        {/* ------------------------------------------------------- Privacy */}
        <Card className="p-7 sm:p-8">
          <CardHeader eyebrow="Privacy" title="What this page will never show" />

          <div className="mt-6 space-y-2.5">
            {["Participant", "Balance", "Mode", "Ticket range", "Prize result"].map((label) => (
              <div key={label} className="flex items-center gap-4">
                <span className="w-[104px] shrink-0 text-[12px] text-[var(--color-tertiary)]">
                  {label}
                </span>
                <span
                  aria-label="Redacted"
                  role="img"
                  className="h-3 flex-1 rounded-[2px] bg-[repeating-linear-gradient(90deg,var(--color-elevated)_0_7px,transparent_7px_11px)]"
                />
              </div>
            ))}
          </div>

          <p className="mt-6 text-[13px] leading-relaxed text-[var(--color-tertiary)]">
            Verifiable execution does not require public financial positions. Each of these exists
            on-chain as ciphertext, and only the account it belongs to can decrypt it.
          </p>
        </Card>

        {/* ------------------------------------------------- Configuration */}
        <Card className="p-7 sm:p-8">
          <CardHeader eyebrow="Configuration" title="Round parameters" />
          <dl className="mt-6">
            <DataRow label="Ticket domain">
              <span className="font-mono">2^{config.ticketBits}</span>
            </DataRow>
            <DataRow label="Max participants">
              <span className="text-numeric">{config.maxParticipants}</span>
            </DataRow>
            <DataRow label="Weight per ticket">
              <span className="text-numeric font-mono text-[12px]">
                {config.weightPerTicket.toString()}
              </span>
            </DataRow>
            <DataRow label="Tier shares">
              <span className="font-mono text-[12px]">
                {formatBps(config.jackpotShareBps)} / {formatBps(config.midShareBps)} /{" "}
                {formatBps(config.smallShareBps)}
              </span>
            </DataRow>
          </dl>
        </Card>
      </div>
    </div>
  );
}
