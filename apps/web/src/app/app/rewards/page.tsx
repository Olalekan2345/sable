"use client";

import { RoundState, assetSymbol, formatAmount, formatTimestamp } from "@sable/config";
import Link from "next/link";
import { useAccount } from "wagmi";

import { ConnectPrompt } from "@/components/app/connect-prompt";
import { RewardsSummary } from "@/components/app/rewards-summary";
import { ConfidentialValue, RevealButton } from "@/components/ui/confidential-value";
import { Card, EmptyState, PageHeader, PrivacyNote } from "@/components/ui/primitives";
import { useRoundPayout } from "@/lib/hooks/use-round-payout";
import { useAllRounds, type RoundSummary } from "@/lib/hooks/use-rounds";

/**
 * Rewards.
 *
 * Alongside the claimable balance, a saver can reveal their own draw weight for a settled
 * round — a number that means something to them and to nobody else.
 *
 * There is deliberately no ranking, no percentile and no "your odds versus others". Sable
 * can compute a personal weight privately; it cannot compute a comparison without knowing
 * everyone else's, which is exactly what the protocol refuses to know.
 */
export default function RewardsPage() {
  const { isConnected } = useAccount();
  const { rounds } = useAllRounds();

  const settled = rounds.filter((round) => round.lifecycle.state === RoundState.Complete);
  const latest = settled[0] ?? null;

  if (!isConnected) {
    return (
      <ConnectPrompt
        title="Connect to see your rewards"
        description="Prize results are encrypted per account. Only the winning wallet can decrypt its own result."
      />
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Rewards"
        title="Your private results"
        description="Every participant receives an encrypted result each round. Winners see an amount; everyone else sees zero — and nobody sees anyone else's."
      />

      <div className="flex flex-col gap-4">
        <RewardsSummary />

        {latest ? (
          <RoundHistory />
        ) : (
          <Card>
            <EmptyState
              title="No settled rounds yet"
              description="Once a round completes, your private draw weight for it will be revealable here."
            />
          </Card>
        )}
      </div>
    </>
  );
}

/**
 * Every settled round, with the share this wallet held in each.
 *
 * ## What this can and cannot say
 *
 * `confidentialWeightOf(roundId, account)` is stored per round and per account, and only its
 * owner can decrypt it — so each row can honestly report *your* stake in that specific draw.
 *
 * Winnings cannot be broken down the same way. Settlement folds every round's prize into one
 * cumulative `reward` handle, so the chain simply does not hold "you won 0.7 in round four".
 * Showing a per-round payout would mean inventing an attribution, which on a protocol whose
 * claim is that anyone can check the arithmetic is the worst kind of convenience. The total is
 * above; the per-round prize figures are public and one click away on each round.
 *
 * Rounds you were not in reveal a weight of zero, which is the truthful answer and needs no
 * lookup of when the wallet registered.
 */
function RoundHistory() {
  const { rounds } = useAllRounds();
  const settled = rounds.filter((round) => round.lifecycle.state === RoundState.Complete);

  if (settled.length === 0) return null;

  return (
    <Card className="overflow-hidden">
      <div className="px-7 pt-7 sm:px-8">
        <p className="text-eyebrow">Your rounds</p>
        <p className="mt-2 max-w-[62ch] text-[13px] leading-relaxed text-[var(--color-tertiary)]">
          What each settled draw paid you. Revealing decrypts your ticket range for that round
          and works out which of its winning numbers fell inside it — nobody else can do this
          for your wallet, and you cannot do it for theirs.
        </p>
      </div>

      <ul className="mt-5">
        {settled.map((round) => (
          <RoundHistoryRow key={round.id} round={round} />
        ))}
      </ul>

      {/*
        The limitation stated on screen, not just in the source.
        
        A reader could reasonably expect this list to break their winnings down by round, and
        it cannot. Saying why — one cumulative handle, not one per round — is more useful than
        letting them wonder whether the app is hiding it or the protocol failed to record it.
      */}
      <div className="border-t border-[var(--color-hairline)] px-7 py-5 sm:px-8">
        <PrivacyNote className="items-start">
          <span>
            Each figure is recomputed in your browser from the round&rsquo;s published draw
            points and prize tiers, checked against your own ticket range — the one input only
            you can decrypt. The contract stores a single running total rather than a
            per-round record, so this is that total broken down, not a second source of truth.
          </span>
        </PrivacyNote>
      </div>
    </Card>
  );
}

function RoundHistoryRow({ round }: { round: RoundSummary }) {
  const roundId = round.id;
  const closedAt = round.lifecycle.closedAt;

  /*
   * Reveals the ticket range and recomputes what this round paid, using the same expression
   * the contract settles with. The private half is the range; everything else is published.
   */
  const payout = useRoundPayout(round);

  return (
    <li className="flex flex-col gap-3 border-t border-[var(--color-hairline)] px-7 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-8">
      <div className="min-w-0">
        <Link
          href={`/draws/${roundId}`}
          className="text-[14px] font-medium text-[var(--color-primary)] underline decoration-[var(--color-quaternary)] underline-offset-[3px] transition-colors hover:text-[var(--color-accent)]"
        >
          Round #{roundId}
        </Link>
        <p className="mt-1 text-[12px] text-[var(--color-tertiary)]">
          {closedAt > 0n ? formatTimestamp(closedAt) : "—"}
          {payout.result ? (
            <>
              <span className="mx-2 text-[var(--color-quaternary)]">·</span>
              {payout.result.wins.length > 0
                ? payout.result.wins.map((win) => win.tier).join(", ")
                : `no match across ${payout.result.pointsChecked} draw points`}
            </>
          ) : null}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <ConfidentialValue
          state={payout.isComputing ? "decrypting" : payout.state}
          display={
            payout.result
              ? `${formatAmount(payout.result.total, { decimals: 6, currency: false })} ${assetSymbol()}`
              : undefined
          }
          error={payout.error}
          size="sm"
          currency={false}
          showStatus={false}
        />
        <RevealButton
          state={payout.state}
          onReveal={payout.reveal}
          onHide={payout.hide}
          labelReveal="Reveal"
          labelHide="Hide"
        />
      </div>
    </li>
  );
}
