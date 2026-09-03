"use client";

import { addresses } from "@sable/config";
import Link from "next/link";

import { ButtonLink } from "@/components/ui/button";
import { ConfidentialValue, RevealButton } from "@/components/ui/confidential-value";
import { Card, PrivacyNote } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { useReveal } from "@/lib/hooks/use-reveal";
import { usePositionHandles } from "@/lib/hooks/use-sable";

/**
 * The primary savings card.
 *
 * The balance is masked until the saver proves ownership. That is not decoration: the
 * value genuinely is not available to the page until the Zama relayer re-encrypts it to a
 * key held only by this browser session.
 */
export function SavingsCard({ className }: { className?: string }) {
  const { balanceHandle, isParticipant } = usePositionHandles();
  const { state, value, error, reveal, hide } = useReveal(balanceHandle, {
    contractAddress: addresses.sable ?? undefined,
  });

  return (
    <Card className={cn("relative overflow-hidden p-7 sm:p-9", className)}>
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--color-hairline-accent)] to-transparent"
      />

      <p className="text-eyebrow">Your savings</p>

      <div className="accent-halo mt-4">
        <ConfidentialValue
          state={state}
          value={typeof value === "bigint" ? value : null}
          error={error}
          size="lg"
        />
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-4">
        <RevealButton state={state} onReveal={reveal} onHide={hide} />
        {state === "revealed" ? (
          <span className="text-[11px] text-[var(--color-quaternary)]">
            Hides automatically after 90 seconds.
          </span>
        ) : null}
      </div>

      <PrivacyNote className="mt-5">Balance visible only to you.</PrivacyNote>

      <div className="rule-fade my-7" />

      <div className="grid gap-2.5 sm:grid-cols-3">
        <ButtonLink href="/app/deposit" size="md" variant="primary" fullWidth>
          Deposit
        </ButtonLink>
        <ButtonLink href="/app/withdraw" size="md" variant="secondary" fullWidth>
          Withdraw
        </ButtonLink>
        <ButtonLink href="/app/statements" size="md" variant="outline" fullWidth>
          Statement
        </ButtonLink>
      </div>

      {!isParticipant ? (
        <p className="mt-6 text-[12px] leading-relaxed text-[var(--color-tertiary)]">
          This wallet has no Sable position yet.{" "}
          <Link
            href="/app/deposit"
            className="underline decoration-[var(--color-quaternary)] underline-offset-[3px] transition-colors hover:text-[var(--color-accent)]"
          >
            Make your first confidential deposit
          </Link>
          .
        </p>
      ) : null}
    </Card>
  );
}
