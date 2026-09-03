"use client";

import { addresses, formatAmount, truncateAddress } from "@sable/config";
import { useState } from "react";
import { useAccount } from "wagmi";

import { ConnectPrompt } from "@/components/app/connect-prompt";
import { UnwrapCard } from "@/components/app/unwrap-card";
import { TransactionStatus } from "@/components/app/transaction-status";
import { Button } from "@/components/ui/button";
import { ConfidentialValue, RevealButton } from "@/components/ui/confidential-value";
import { CurrencyInput, validateAmount } from "@/components/ui/currency-input";
import { Card, DataRow, PageHeader, PrivacyNote } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { useConfidentialTx } from "@/lib/hooks/use-confidential-tx";
import { useReveal } from "@/lib/hooks/use-reveal";
import { usePositionHandles, useWalletBalanceHandle } from "@/lib/hooks/use-sable";

/**
 * Withdraw.
 *
 * A first-class flow with a review step, because withdrawing is the moment the product's
 * central promise is actually tested. There is no lock-up and no round restriction — the
 * only real constraint is the balance itself.
 */
export default function WithdrawPage() {
  const { isConnected, address } = useAccount();
  const { notify } = useToast();

  const { balanceHandle, isParticipant, refetch: refetchPosition } = usePositionHandles();
  const { refetch: refetchWallet } = useWalletBalanceHandle();
  const reveal = useReveal(balanceHandle, { contractAddress: addresses.sable ?? undefined });
  const tx = useConfidentialTx();

  const [amount, setAmount] = useState("");
  const [reviewing, setReviewing] = useState(false);

  const available =
    reveal.state === "revealed" && typeof reveal.value === "bigint" ? reveal.value : null;

  const { amount: parsed, error: amountError } = validateAmount(amount, {
    max: available,
    maxMessage: `That is more than your available ${formatAmount(available ?? 0n)}.`,
  });

  if (!isConnected) {
    return (
      <ConnectPrompt
        title="Connect to withdraw"
        description="Only the wallet that owns a position can withdraw from it. Connect it to continue."
      />
    );
  }

  const submit = async () => {
    if (!parsed) return;

    const hash = await tx.sendAmount("withdraw", parsed);
    if (hash) {
      notify({
        title: "Withdrawal confirmed",
        description: "The tokens are back in your wallet.",
        tone: "verified",
        txHash: hash,
      });
      setAmount("");
      setReviewing(false);
      reveal.hide();
      await Promise.all([refetchPosition(), refetchWallet()]);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Withdraw"
        title="Take your savings out"
        description="Principal remains yours. There is no lock-up, and withdrawals stay open even while the protocol is paused."
      />

      <Card className="p-7 sm:p-9">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-eyebrow">Available savings</p>
            <div className="mt-2.5">
              <ConfidentialValue
                state={reveal.state}
                value={available}
                error={reveal.error}
                size="md"
              />
            </div>
          </div>
          <RevealButton
            state={reveal.state}
            onReveal={reveal.reveal}
            onHide={reveal.hide}
            labelReveal="Reveal"
            labelHide="Hide"
            disabled={!isParticipant}
          />
        </div>

        <div className="rule-fade my-7" />

        {!reviewing ? (
          <>
            <CurrencyInput
              label="Amount to withdraw"
              value={amount}
              onChange={setAmount}
              max={available}
              error={amountError}
              disabled={tx.isBusy}
              hint={
                available === null
                  ? "Reveal your balance to enable Max and amount checks."
                  : undefined
              }
            />

            <div className="mt-7">
              <p className="text-eyebrow mb-2.5">Withdraw to</p>
              <p className="surface-inset break-all px-4 py-3.5 font-mono text-[12px] text-[var(--color-secondary)]">
                {address}
              </p>
              <p className="mt-2.5 text-[12px] text-[var(--color-tertiary)]">
                Funds always return to the wallet that owns the position.
              </p>
            </div>

            <div className="mt-7">
              <Button
                size="lg"
                fullWidth
                disabled={!parsed || Boolean(amountError)}
                onClick={() => setReviewing(true)}
              >
                Review withdrawal
              </Button>
            </div>
          </>
        ) : (
          <>
            <h2 className="text-[15px] font-semibold text-[var(--color-primary)]">
              Review withdrawal
            </h2>

            <dl className="mt-5">
              <DataRow label="Amount">
                <span className="text-numeric font-medium">
                  {parsed !== null ? formatAmount(parsed, { currency: true }) : "—"}
                </span>
              </DataRow>
              <DataRow label="Destination">
                <span className="font-mono text-[12px]">{truncateAddress(address ?? "")}</span>
              </DataRow>
              <DataRow label="Remaining">
                <span className="text-numeric font-medium">
                  {available !== null && parsed !== null
                    ? formatAmount(available - parsed, { currency: true })
                    : "—"}
                </span>
              </DataRow>
            </dl>

            <div className="mt-7 flex flex-col gap-2.5 sm:flex-row">
              <Button size="lg" onClick={submit} loading={tx.isBusy} className="flex-1">
                Confirm withdrawal
              </Button>
              <Button
                size="lg"
                variant="ghost"
                onClick={() => setReviewing(false)}
                disabled={tx.isBusy}
              >
                Back
              </Button>
            </div>
          </>
        )}

        <TransactionStatus stage={tx.stage} error={tx.error} detail={tx.detail} txHash={tx.txHash} className="mt-6" />

        <PrivacyNote className="mt-6">
          The withdrawal amount is encrypted before it is submitted.
        </PrivacyNote>
      </Card>

      {/* Withdrawing returns the confidential token; unwrapping converts it back to the
          public one. Two distinct steps, because they are two distinct systems. */}
      <UnwrapCard className="mt-4" />
    </>
  );
}
