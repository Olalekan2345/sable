"use client";

import { addresses } from "@sable/config";

import { Button } from "@/components/ui/button";
import { ConfidentialValue, RevealButton } from "@/components/ui/confidential-value";
import { Card, PrivacyNote } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { useConfidentialTx } from "@/lib/hooks/use-confidential-tx";
import { useReveal } from "@/lib/hooks/use-reveal";
import { usePositionHandles } from "@/lib/hooks/use-sable";
import { TransactionStatus } from "./transaction-status";

/**
 * Unclaimed prize rewards.
 *
 * Every participant in a settled round holds a reward handle — winners a positive amount,
 * everyone else an encrypted zero. That symmetry is deliberate and is why this card is
 * always present rather than appearing only for winners: a card that showed up exactly
 * when someone won would announce the win to anyone watching over their shoulder, and its
 * absence would announce the opposite.
 */
export function RewardsSummary({ className }: { className?: string }) {
  const { rewardHandle, isParticipant, refetch } = usePositionHandles();
  const { state, value, error, reveal, hide } = useReveal(rewardHandle, {
    contractAddress: addresses.sable ?? undefined,
  });
  const tx = useConfidentialTx();
  const { notify } = useToast();

  const amount = typeof value === "bigint" ? value : null;
  const hasRewards = amount !== null && amount > 0n;

  const claim = async () => {
    const hash = await tx.sendPlain("claimRewards");
    if (hash) {
      notify({
        title: "Rewards moved to savings",
        description: "Your winnings now compound with the rest of your position.",
        tone: "verified",
        txHash: hash,
      });
      hide();
      await refetch();
    }
  };

  return (
    <Card className={cn("p-7 sm:p-8", className)}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-eyebrow">Unclaimed rewards</p>
          <div className="mt-4">
            <ConfidentialValue
              state={state}
              value={amount}
              error={error}
              size="md"
            />
          </div>
        </div>

        <RevealButton
          state={state}
          onReveal={reveal}
          onHide={hide}
          labelReveal="Reveal"
          labelHide="Hide"
          disabled={!isParticipant}
        />
      </div>

      {state === "revealed" ? (
        hasRewards ? (
          <>
            <p className="mt-5 text-[13px] leading-relaxed text-[var(--color-secondary)]">
              You won a prize. Move it into your savings position to withdraw or compound it.
            </p>
            <div className="mt-5">
              <Button size="md" onClick={claim} loading={tx.isBusy}>
                Move to savings
              </Button>
            </div>
            <TransactionStatus stage={tx.stage} error={tx.error} detail={tx.detail} txHash={tx.txHash} className="mt-5" />
          </>
        ) : (
          <p className="mt-5 text-[13px] leading-relaxed text-[var(--color-tertiary)]">
            No rewards yet. Private rewards appear here when they are won.
          </p>
        )
      ) : (
        <PrivacyNote className="mt-5">
          Only you can see whether you won — results are never published.
        </PrivacyNote>
      )}
    </Card>
  );
}
