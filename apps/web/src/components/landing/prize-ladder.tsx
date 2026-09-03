"use client";

import { RoundState, formatAmount } from "@sable/config";

import { Badge } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { useActiveRound, useAllRounds, useRoundAggregates } from "@/lib/hooks/use-rounds";
import { useIsDeployed } from "@/lib/hooks/use-sable";
import { Reveal, Section } from "./section";

/**
 * The prize ladder.
 *
 * Tier *shape* (one jackpot, three mid, ten small) comes from the live round's on-chain
 * configuration. Tier *amounts* come from publicly decrypting the round's aggregate
 * handles — real protocol state, resolved through the relayer with no wallet required.
 *
 * When no funded round exists, this shows the structure and says so. It never invents a
 * headline number: a `$50,000` placed here for visual impact would be the single most
 * dishonest thing on the page, and every real figure below it would inherit the doubt.
 */
export function PrizeLadder() {
  const deployed = useIsDeployed();
  const { round: activeRound } = useActiveRound();
  const { rounds } = useAllRounds();

  // Prefer the open round; otherwise fall back to the most recent round that published
  // figures, so the ladder is populated between rounds rather than blank.
  const published = rounds.find((r) => r.lifecycle.state >= RoundState.Finalized) ?? null;
  const source = activeRound?.lifecycle.state === RoundState.Open ? activeRound : published;

  const { aggregates } = useRoundAggregates(source);

  const config = source?.config;
  const tiers = [
    {
      key: "jackpot" as const,
      name: "Jackpot",
      count: config?.jackpotWinnerCount ?? 1,
      amount: aggregates?.jackpotPrize ?? null,
      accent: true,
    },
    {
      key: "mid" as const,
      name: "Mid",
      count: config?.midWinnerCount ?? 3,
      amount: aggregates?.midPrize ?? null,
      accent: false,
    },
    {
      key: "small" as const,
      name: "Small",
      count: config?.smallWinnerCount ?? 10,
      amount: aggregates?.smallPrize ?? null,
      accent: false,
    },
  ];

  const hasAmounts = tiers.some((tier) => tier.amount !== null && tier.amount > 0n);

  return (
    <Section>
      <div className="mb-14 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-[46ch]">
          <Reveal>
            <p className="text-eyebrow mb-5">Prize structure</p>
          </Reveal>
          <Reveal delay={0.06}>
            <h2 className="text-display text-[clamp(2rem,4.6vw,3.4rem)] text-[var(--color-primary)]">
              Fourteen chances,
              <br />
              every round.
            </h2>
          </Reveal>
        </div>

        <Reveal delay={0.12}>
          {source ? (
            <Badge tone={source.lifecycle.state === RoundState.Open ? "accent" : "neutral"} dot>
              Round #{source.id}
            </Badge>
          ) : null}
        </Reveal>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {tiers.map((tier, index) => (
          <Reveal key={tier.key} delay={index * 0.08}>
            <div
              className={cn(
                "surface-card grain relative h-full overflow-hidden p-7",
                tier.accent && "border-[var(--color-hairline-accent)]",
              )}
            >
              {tier.accent ? (
                <div
                  aria-hidden="true"
                  className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--color-accent)] to-transparent opacity-70"
                />
              ) : null}

              <div className="flex items-baseline justify-between">
                <h3
                  className={cn(
                    "font-mono text-[11px] uppercase tracking-[0.18em]",
                    tier.accent ? "text-[var(--color-accent)]" : "text-[var(--color-secondary)]",
                  )}
                >
                  {tier.name}
                </h3>
                <span className="font-mono text-[10px] text-[var(--color-quaternary)]">
                  {tier.count} {tier.count === 1 ? "winner" : "winners"}
                </span>
              </div>

              <div className="mt-8 min-h-[52px]">
                {tier.amount !== null && tier.amount > 0n ? (
                  <>
                    <p
                      className={cn(
                        "text-numeric text-[30px] font-semibold sm:text-[34px]",
                        tier.accent ? "text-[var(--color-accent)]" : "text-[var(--color-primary)]",
                      )}
                    >
                      {formatAmount(tier.amount, { currency: true })}
                    </p>
                    <p className="mt-1.5 text-[11px] text-[var(--color-tertiary)]">per winner</p>
                  </>
                ) : (
                  <p className="text-[13px] leading-relaxed text-[var(--color-tertiary)]">
                    {deployed
                      ? "Appears when a funded round is finalized."
                      : "Appears once the protocol is deployed."}
                  </p>
                )}
              </div>
            </div>
          </Reveal>
        ))}
      </div>

      <Reveal delay={0.2}>
        <p className="mt-10 max-w-[62ch] text-[13px] leading-relaxed text-[var(--color-tertiary)]">
          {hasAmounts
            ? "Prize amounts are read from the round's on-chain aggregate, decrypted publicly. Individual positions stay confidential."
            : "Prize values are derived from the yield Lucky savers contribute during a round. They appear here — from real contract state — as soon as a funded round is finalized."}
        </p>
      </Reveal>
    </Section>
  );
}
