"use client";

import { ROUND_STATE_LABELS, RoundState, formatDate } from "@sable/config";
import Link from "next/link";

import { Badge, EmptyState } from "@/components/ui/primitives";
import { ButtonLink } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { useAllRounds } from "@/lib/hooks/use-rounds";
import { useIsDeployed } from "@/lib/hooks/use-sable";
import { Reveal, Section } from "./section";

/**
 * "Private does not mean opaque."
 *
 * A live extract of the public draw ledger. Every row is read from deployed contract state
 * — there is no sample data behind this component, which is why it renders an empty state
 * before the first round rather than a convincing-looking table of nothing.
 */
export function Verifiable() {
  const deployed = useIsDeployed();
  const { rounds, isLoading } = useAllRounds();
  const recent = rounds.slice(0, 4);

  return (
    <Section>
      <div className="mb-14 grid gap-8 lg:grid-cols-[1fr_auto] lg:items-end">
        <div className="max-w-[48ch]">
          <Reveal>
            <p className="text-eyebrow mb-5">Verifiability</p>
          </Reveal>
          <Reveal delay={0.06}>
            <h2 className="text-display text-[clamp(2rem,4.6vw,3.4rem)] text-[var(--color-primary)]">
              Private does
              <br />
              not mean opaque.
            </h2>
          </Reveal>
          <Reveal delay={0.12}>
            <p className="mt-6 text-[15px] leading-relaxed text-[var(--color-secondary)]">
              Draw execution, round configuration and prize accounting are public and checkable by
              anyone. Individual financial positions remain confidential.
            </p>
          </Reveal>
        </div>

        <Reveal delay={0.16}>
          <ButtonLink href="/draws" variant="outline" size="md">
            Open the draw ledger
          </ButtonLink>
        </Reveal>
      </div>

      <Reveal delay={0.1}>
        <div className="surface-card overflow-hidden">
          {!deployed ? (
            <EmptyState
              title="Not deployed yet"
              description="Round records appear here once the Sable contracts are deployed to Sepolia."
            />
          ) : isLoading ? (
            <div className="p-8">
              <div className="shimmer h-4 w-1/3 rounded bg-[var(--color-elevated)]" />
              <div className="shimmer mt-4 h-4 w-2/3 rounded bg-[var(--color-elevated)]" />
            </div>
          ) : recent.length === 0 ? (
            <EmptyState
              title="No completed draws"
              description="Verified rounds will appear here after the first on-chain draw."
            />
          ) : (
            <>
              {/* Column headers, hidden on mobile where the layout becomes stacked. */}
              <div className="hidden grid-cols-[auto_1fr_1fr_auto] gap-6 border-b border-[var(--color-hairline)] px-7 py-4 sm:grid">
                {["Round", "Opened", "Status", "Rollover"].map((label) => (
                  <span key={label} className="text-eyebrow">
                    {label}
                  </span>
                ))}
              </div>

              <ul>
                {recent.map((round) => (
                  <li key={round.id}>
                    <Link
                      href={`/draws/${round.id}`}
                      className={cn(
                        "grid gap-2 px-7 py-5 transition-colors sm:grid-cols-[auto_1fr_1fr_auto] sm:items-center sm:gap-6",
                        "border-b border-[var(--color-hairline)] last:border-0",
                        "hover:bg-[var(--color-raised)]",
                      )}
                    >
                      <span className="font-mono text-[13px] text-[var(--color-primary)]">
                        #{round.id}
                      </span>

                      <span className="font-mono text-[12px] text-[var(--color-tertiary)]">
                        {round.lifecycle.openedAt > 0n
                          ? formatDate(round.lifecycle.openedAt)
                          : "Not opened"}
                      </span>

                      <span>
                        <Badge
                          tone={
                            round.lifecycle.state === RoundState.Complete
                              ? "verified"
                              : round.lifecycle.state === RoundState.Open
                                ? "accent"
                                : "neutral"
                          }
                          dot
                        >
                          {ROUND_STATE_LABELS[round.lifecycle.state]}
                        </Badge>
                      </span>

                      <span className="font-mono text-[12px] text-[var(--color-tertiary)]">
                        {round.lifecycle.jackpotResolved ? "Resolved" : "—"}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </Reveal>

      <Reveal delay={0.18}>
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <div className="surface-inset p-5">
            <p className="text-eyebrow mb-3">Public</p>
            <p className="text-[13px] leading-relaxed text-[var(--color-secondary)]">
              Round timing, tier configuration, prize totals, draw transactions, rollover outcome.
            </p>
          </div>
          <div className="surface-inset p-5">
            <p className="text-eyebrow mb-3">Private</p>
            <p className="text-[13px] leading-relaxed text-[var(--color-secondary)]">
              Balances, modes, draw weights, ticket ranges, individual results. Never published, at
              any stage.
            </p>
          </div>
        </div>
      </Reveal>
    </Section>
  );
}
