"use client";

import {
  assetSymbol,
  SABLE_CHAIN_ID,
  addresses,
  confidentialAssetAbi,
  formatAmount,
} from "@sable/config";
import { useState } from "react";
import { useAccount, useConfig } from "wagmi";
import { waitForTransactionReceipt, writeContract } from "wagmi/actions";

import { ConnectPrompt } from "@/components/app/connect-prompt";
import { AcquireAssetCard } from "@/components/app/acquire-card";
import { DepositSteps } from "@/components/app/deposit-steps";
import { TransactionStatus } from "@/components/app/transaction-status";
import { Button } from "@/components/ui/button";
import { ConfidentialValue, RevealButton } from "@/components/ui/confidential-value";
import { CurrencyInput, validateAmount } from "@/components/ui/currency-input";
import { Card, PageHeader, PrivacyNote } from "@/components/ui/primitives";
import { ErrorNotice } from "@/components/ui/error-notice";
import { useToast } from "@/components/ui/toast";
import {
  WRONG_NETWORK_MESSAGE,
  toErrorDetail,
  toTxError,
  useConfidentialTx,
} from "@/lib/hooks/use-confidential-tx";
import { useReveal } from "@/lib/hooks/use-reveal";
import {
  useEnsureChain,
  useOperatorStatus,
  usePositionHandles,
  useWalletBalanceHandle,
} from "@/lib/hooks/use-sable";

/** Operator authorisation window: one year, matching typical wallet-approval expectations. */
const OPERATOR_WINDOW_SECONDS = 365 * 24 * 3600;

/**
 * Deposit.
 *
 * Two steps, and the first is unavoidable: ERC-7984 uses time-bounded *operators* rather
 * than allowances, so the vault has to be authorised before it can move anything. The flow
 * makes that explicit instead of surfacing it as a confusing revert mid-deposit.
 */
export default function DepositPage() {
  const { isConnected } = useAccount();
  const config = useConfig();
  const { notify } = useToast();

  const ensureChain = useEnsureChain();
  const { isOperator, refetch: refetchOperator } = useOperatorStatus();
  const { handle: walletHandle, refetch: refetchWallet } = useWalletBalanceHandle();
  const { refetch: refetchPosition } = usePositionHandles();

  const walletReveal = useReveal(walletHandle, { contractAddress: addresses.asset ?? undefined });
  const tx = useConfidentialTx();

  const [amount, setAmount] = useState("");
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [approveDetail, setApproveDetail] = useState<string | null>(null);

  const revealedWallet =
    walletReveal.state === "revealed" && typeof walletReveal.value === "bigint"
      ? walletReveal.value
      : null;

  const { amount: parsed, error: amountError } = validateAmount(amount, {
    max: revealedWallet,
    maxMessage: `That is more than the ${formatAmount(revealedWallet ?? 0n)} in your wallet. An over-sized transfer moves nothing at all.`,
  });

  if (!isConnected) {
    return (
      <ConnectPrompt
        title="Connect to deposit"
        description="Your deposit amount is encrypted in your browser before it is submitted. Connect a wallet to begin."
      />
    );
  }

  const authorize = async () => {
    if (!addresses.asset || !addresses.sable) return;

    setApproving(true);
    setApproveError(null);
    setApproveDetail(null);

    // This is the first transaction a saver ever sends, so it is where a wrong network is
    // most likely — and where being told to go and fix it themselves is most discouraging.
    if (!(await ensureChain())) {
      setApproveError(WRONG_NETWORK_MESSAGE);
      setApproving(false);
      return;
    }

    try {
      // `setOperator` takes a `uint48`, which viem represents as a plain number.
      const until = Math.floor(Date.now() / 1000) + OPERATOR_WINDOW_SECONDS;
      const hash = await writeContract(config, {
        address: addresses.asset,
        abi: confidentialAssetAbi,
        functionName: "setOperator",
        args: [addresses.sable, until],
        chainId: SABLE_CHAIN_ID,
      });

      await waitForTransactionReceipt(config, { hash, chainId: SABLE_CHAIN_ID });
      await refetchOperator();

      notify({
        title: "Sable authorised",
        description: "The vault can now move tokens you explicitly deposit.",
        tone: "verified",
        txHash: hash,
      });
    } catch (caught) {
      setApproveError(toTxError(caught));
      // Keep the raw failure available: the friendly mapping is a best guess, and when it
      // guesses wrong the real message is the only thing that helps.
      setApproveDetail(toErrorDetail(caught));
    } finally {
      setApproving(false);
    }
  };

  const submit = async () => {
    if (!parsed) return;

    const hash = await tx.sendAmount("deposit", parsed);
    if (hash) {
      notify({
        title: "Deposit confirmed",
        description: "Your savings position has been updated privately.",
        tone: "verified",
        txHash: hash,
      });
      setAmount("");
      walletReveal.hide();
      await Promise.all([refetchWallet(), refetchPosition()]);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Deposit"
        title="Add to your savings"
        description="Your amount is encrypted locally before it leaves your device. Nobody — including Sable's operators — can read it."
      />

      <DepositSteps className="mb-6" />

      <div className="flex flex-col gap-4">
        <AcquireAssetCard />

        {/* ------------------------------------------------- Step 1: authorise */}
        {!isOperator ? (
          <Card className="p-7 sm:p-8">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[var(--color-hairline-accent)] font-mono text-[10px] text-[var(--color-accent)]">
                1
              </span>
              <div className="min-w-0">
                <h2 className="text-[15px] font-semibold text-[var(--color-primary)]">
                  Authorise Sable
                </h2>
                <p className="mt-2 text-[13px] leading-relaxed text-[var(--color-secondary)]">
                  {assetSymbol()} uses time-bounded operators rather than spending allowances. This
                  lets the vault move only the amounts you explicitly deposit, and the permission
                  expires on its own after a year.
                </p>

                <div className="mt-5">
                  <Button size="md" loading={approving} onClick={authorize}>
                    Authorise vault
                  </Button>
                </div>

                {approveError ? (
                  <ErrorNotice message={approveError} detail={approveDetail} className="mt-4" />
                ) : null}
              </div>
            </div>
          </Card>
        ) : null}

        {/* ---------------------------------------------------- Step 2: deposit */}
        <Card className={isOperator ? "p-7 sm:p-9" : "p-7 opacity-55 sm:p-9"}>
          <div className="flex items-start gap-3">
            {!isOperator ? (
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[var(--color-hairline)] font-mono text-[10px] text-[var(--color-quaternary)]">
                2
              </span>
            ) : null}

            <div className="min-w-0 flex-1">
              {/* Wallet balance, revealable so the Max button has something real to use. */}
              <div className="mb-7 flex items-end justify-between gap-4">
                <div>
                  <p className="text-eyebrow">In your wallet</p>
                  <div className="mt-2.5">
                    <ConfidentialValue
                      state={walletReveal.state}
                      value={revealedWallet}
                      error={walletReveal.error}
                      size="sm"
                    />
                  </div>
                </div>
                <RevealButton
                  state={walletReveal.state}
                  onReveal={walletReveal.reveal}
                  onHide={walletReveal.hide}
                  labelReveal="Reveal"
                  labelHide="Hide"
                />
              </div>

              <CurrencyInput
                label="Amount to deposit"
                value={amount}
                onChange={setAmount}
                max={revealedWallet}
                error={amountError}
                disabled={!isOperator || tx.isBusy}
                hint={
                  revealedWallet === null
                    ? "Reveal your wallet balance to enable Max and amount checks."
                    : undefined
                }
              />

              <div className="mt-6">
                <Button
                  size="lg"
                  fullWidth
                  onClick={submit}
                  loading={tx.isBusy}
                  disabled={!isOperator || !parsed || Boolean(amountError)}
                >
                  Deposit privately
                </Button>
              </div>

              <TransactionStatus
                stage={tx.stage}
                error={tx.error} detail={tx.detail}
                txHash={tx.txHash}
                className="mt-5"
              />

              {/*
                Why a decline is worth a second sentence here.

                With the balance still encrypted the page cannot check affordability, so an
                over-large amount reaches the wallet intact — where simulation predicts the
                revert and warns. Backing out of that warning is the sensible response, and it
                arrives here as a plain decline, which describes the click and not the cause.

                Only shown when the balance is unrevealed, because that is the only state in
                which the app failed to catch it first.
              */}
              {tx.stage === "error" && revealedWallet === null && tx.error?.startsWith("You declined") ? (
                <p className="mt-3 text-[12px] leading-relaxed text-[var(--color-tertiary)]">
                  If your wallet warned the transaction would fail, the amount is likely more
                  than this wallet holds — nothing was sent either way. Reveal your balance
                  above to check it and enable Max.
                </p>
              ) : null}

              <PrivacyNote className="mt-6">
                The amount is never sent to a server, stored, or written to the URL.
              </PrivacyNote>
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}
