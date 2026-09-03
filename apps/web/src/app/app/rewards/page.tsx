"use client";

import { RoundState, addresses, formatAmount } from "@sable/config";
import { useAccount } from "wagmi";

import { ConnectPrompt } from "@/components/app/connect-prompt";
import { RewardsSummary } from "@/components/app/rewards-summary";
import { ConfidentialValue, RevealButton } from "@/components/ui/confidential-value";
import { Card, EmptyState, PageHeader, PrivacyNote } from "@/components/ui/primitives";
import { useReveal } from "@/lib/hooks/use-reveal";
import { useAllRounds } from "@/lib/hooks/use-rounds";
import { useSableContract } from "@/lib/hooks/use-sable";
import { useReadContract } from "wagmi";

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
          <DrawWeightCard roundId={latest.id} />
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

/** Reveals the caller's own time-weighted eligibility for a specific round. */
function DrawWeightCard({ roundId }: { roundId: number }) {
  const { address } = useAccount();
  const sable = useSableContract();

  const { data: weightHandle } = useReadContract({
    ...sable,
    functionName: "confidentialWeightOf",
    args: address ? [BigInt(roundId), address] : undefined,
    query: { enabled: Boolean(sable.address && address) },
  });

  const reveal = useReveal(weightHandle as `0x${string}` | undefined, {
    contractAddress: addresses.sable ?? undefined,
  });

  const weight = typeof reveal.value === "bigint" ? reveal.value : null;

  return (
    <Card className="p-7 sm:p-8">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-eyebrow">Your draw weight — round #{roundId}</p>
          <div className="mt-2.5">
            <ConfidentialValue
              state={reveal.state}
              display={weight !== null ? formatAmount(weight, { decimals: 0, currency: false }) : undefined}
              error={reveal.error}
              size="md"
              currency={false}
            />
          </div>
        </div>
        <RevealButton
          state={reveal.state}
          onReveal={reveal.reveal}
          onHide={reveal.hide}
          labelReveal="Reveal weight"
          labelHide="Hide weight"
        />
      </div>

      {reveal.state === "revealed" ? (
        weight !== null && weight > 0n ? (
          <p className="mt-5 text-[13px] leading-relaxed text-[var(--color-secondary)]">
            This is your balance multiplied by the minutes you held it while in Lucky mode. It
            determined the size of your private ticket range for this round.
          </p>
        ) : (
          <p className="mt-5 text-[13px] leading-relaxed text-[var(--color-tertiary)]">
            No eligibility for this round — either you were saving in Steady mode, or the balance
            was not held long enough to accrue whole minutes of weight.
          </p>
        )
      ) : (
        <PrivacyNote className="mt-5">
          Weights are never ranked or published. Yours is visible only to you.
        </PrivacyNote>
      )}
    </Card>
  );
}
