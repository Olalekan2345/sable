"use client";

import {
  ROUND_STATE_LABELS,
  RoundState,
  addresses,
  formatDate,
  formatAmount,
} from "@sable/config";
import Link from "next/link";

import {
  Badge,
  Card,
  EmptyState,
  ExplorerLink,
  PageHeader,
  Skeleton,
} from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { useAllRounds, useRoundAggregates, type RoundSummary } from "@/lib/hooks/use-rounds";
import { useIsDeployed } from "@/lib/hooks/use-sable";

/**
 * The public draw ledger.
 *
 * Deliberately the most conventional-looking page in the product: a table of rounds with
 * real figures, readable without a wallet. Its job is to be boring and checkable.
 *
 * Prize totals come from publicly decrypting each round's aggregate handle through the
 * relayer. Nothing here is cached from a server or precomputed — and no column exists for
 * participants, balances, modes, weights or winners.
 */
export default function DrawsPage() {
  const deployed = useIsDeployed();
  const { rounds, isLoading } = useAllRounds();

  return (
    <div className="mx-auto max-w-[1080px] px-5 sm:px-8">
      <PageHeader
        eyebrow="Public ledger"
        title="Every round, verifiable"
        description="Round configuration, prize totals and draw execution are public. Individual financial positions never are."
      />

      <Card className="overflow-hidden">
        {!deployed ? (
          <EmptyState
            title="Not deployed yet"
            description="Round records appear here once the Sable contracts are live on Sepolia."
          />
        ) : isLoading ? (
          <div className="flex flex-col gap-5 p-7">
            {[0, 1, 2].map((row) => (
              <div key={row} className="flex items-center justify-between gap-6">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-4 w-20" />
              </div>
            ))}
          </div>
        ) : rounds.length === 0 ? (
          <EmptyState
            title="No completed draws"
            description="Verified rounds will appear here after the first on-chain draw."
          />
        ) : (
          <>
            <div className="hidden grid-cols-[64px_1.1fr_1fr_1fr_auto] gap-5 border-b border-[var(--color-hairline)] px-7 py-4 lg:grid">
              {["Round", "Opened", "Prize pool", "Status", "Rollover"].map((label) => (
                <span key={label} className="text-eyebrow">
                  {label}
                </span>
              ))}
            </div>

            <ul>
              {rounds.map((round) => (
                <LedgerRow key={round.id} round={round} />
              ))}
            </ul>
          </>
        )}
      </Card>

      {/* Contract provenance — real addresses only, or nothing. */}
      {addresses.sable ? (
        <div className="mt-6 flex flex-wrap gap-x-8 gap-y-3">
          <ExplorerLink address={addresses.sable} label="Sable vault contract ↗" />
          {addresses.asset ? (
            <ExplorerLink address={addresses.asset} label="Confidential asset ↗" />
          ) : null}
          {addresses.yieldAdapter ? (
            <ExplorerLink address={addresses.yieldAdapter} label="Yield adapter ↗" />
          ) : null}
        </div>
      ) : null}

      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        <div className="surface-inset p-6">
          <p className="text-eyebrow mb-3">Published here</p>
          <p className="text-[13px] leading-relaxed text-[var(--color-secondary)]">
            Round timing, tier configuration, prize pool and per-tier amounts, draw transactions,
            and whether the jackpot rolled forward.
          </p>
        </div>
        <div className="surface-inset p-6">
          <p className="text-eyebrow mb-3">Never published</p>
          <p className="text-[13px] leading-relaxed text-[var(--color-secondary)]">
            Participant balances, yield modes, draw weights, ticket ranges, individual results and
            winner identities — at any stage of the round.
          </p>
        </div>
      </div>
    </div>
  );
}

function LedgerRow({ round }: { round: RoundSummary }) {
  const { aggregates, notPublished } = useRoundAggregates(round);

  const tone =
    round.lifecycle.state === RoundState.Complete
      ? "verified"
      : round.lifecycle.state === RoundState.Open
        ? "accent"
        : "neutral";

  return (
    <li>
      <Link
        href={`/draws/${round.id}`}
        className={cn(
          "grid gap-3 border-b border-[var(--color-hairline)] px-7 py-5 last:border-0",
          "transition-colors hover:bg-[var(--color-raised)]",
          "lg:grid-cols-[64px_1.1fr_1fr_1fr_auto] lg:items-center lg:gap-5",
        )}
      >
        <span className="font-mono text-[14px] text-[var(--color-primary)]">#{round.id}</span>

        <span className="font-mono text-[12px] text-[var(--color-tertiary)]">
          {round.lifecycle.openedAt > 0n ? formatDate(round.lifecycle.openedAt) : "Not opened"}
        </span>

        <span className="text-numeric text-[14px] text-[var(--color-primary)]">
          {notPublished ? (
            <span className="text-[12px] text-[var(--color-quaternary)]">Not yet published</span>
          ) : aggregates?.prizePool !== null && aggregates?.prizePool !== undefined ? (
            formatAmount(aggregates.prizePool, { currency: true })
          ) : (
            <span className="text-[12px] text-[var(--color-quaternary)]">—</span>
          )}
        </span>

        <span>
          <Badge tone={tone} dot>
            {ROUND_STATE_LABELS[round.lifecycle.state]}
          </Badge>
        </span>

        <span className="font-mono text-[12px] text-[var(--color-tertiary)]">
          {aggregates?.jackpotHit === false
            ? "Rolled forward"
            : aggregates?.jackpotHit === true
              ? "Awarded"
              : "—"}
        </span>
      </Link>
    </li>
  );
}
