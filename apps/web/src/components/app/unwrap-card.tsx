"use client";

import { assetSymbol, addresses, deployment, formatAmount, isWrappedAsset, unwrappedAmountFor } from "@sable/config";
import { useState } from "react";
import { erc20Abi, formatUnits } from "viem";
import { useReadContract } from "wagmi";

import { Button } from "@/components/ui/button";
import { ConfidentialValue, RevealButton } from "@/components/ui/confidential-value";
import { CurrencyInput, validateAmount } from "@/components/ui/currency-input";
import { Card, PrivacyNote } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { useReveal } from "@/lib/hooks/use-reveal";
import { useAssetContract, useWalletBalanceHandle } from "@/lib/hooks/use-sable";
import {
  UNWRAP_STAGE_COPY,
  useUnderlyingBalance,
  useUnwrap,
  useWrapperInfo,
  wrapperBlockReason,
} from "@/lib/hooks/use-wrapper";

/**
 * Taking value back out of the confidential side.
 *
 * The counterpart to wrapping, and the reason it exists: without it, Sable would be a
 * one-way door. A saver could withdraw from the vault and still be holding a confidential
 * token with no route back to the public one.
 *
 * ## Why this shows three stages
 *
 * Zama's unwrap is genuinely asynchronous, and the middle step is not a transaction:
 *
 * 1. **Request** — the confidential amount is burned and its handle marked publicly
 *    decryptable. Nothing public has moved yet.
 * 2. **Decrypt** — the released amount becomes a cleartext with a KMS proof. This is a
 *    legitimate use of *public* decryption: the amount is about to appear as a public ERC-20
 *    transfer, so it cannot stay secret.
 * 3. **Finalize** — the contract re-verifies the proof and releases the underlying.
 *
 * Collapsing that into one spinner would misrepresent what is happening, and — more
 * practically — leave a saver with no idea what to do if the flow is interrupted between
 * the burn and the release. So the stages are named, and an interrupted request is offered
 * back for completion rather than abandoned.
 */
export function UnwrapCard({ className }: { className?: string }) {
  const asset = useAssetContract();
  const { notify } = useToast();

  const info = useWrapperInfo();
  const { handle: walletHandle, refetch: refetchWallet } = useWalletBalanceHandle();
  const { refetch: refetchUnderlying } = useUnderlyingBalance(info.underlying);
  const reveal = useReveal(walletHandle, { contractAddress: addresses.asset ?? undefined });
  const { unwrap, finalize, stage, error, pendingRequestId, isBusy } = useUnwrap();

  const [amount, setAmount] = useState("");

  const { data: underlyingSymbol } = useReadContract({
    address: info.underlying,
    abi: erc20Abi,
    functionName: "symbol",
    query: { enabled: Boolean(info.underlying) },
  });

  if (!isWrappedAsset() || !asset.address) return null;

  const symbol = assetSymbol();
  const uSymbol = (underlyingSymbol as string | undefined) ?? "the public token";
  const decimals = Number(deployment?.asset.underlyingDecimals ?? 6);

  const available =
    reveal.state === "revealed" && typeof reveal.value === "bigint" ? reveal.value : null;

  const { amount: parsed, error: amountError } = validateAmount(amount, {
    max: available,
    maxMessage: `That is more than the ${formatAmount(available ?? 0n)} ${symbol} in your wallet.`,
  });

  const blockedReason = wrapperBlockReason(info);

  const onUnwrap = async () => {
    if (!parsed) return;
    const hash = await unwrap(parsed);
    if (hash) {
      notify({
        title: `Unwrapped to ${uSymbol}`,
        description: "The public tokens are back in your wallet.",
        tone: "verified",
        txHash: hash,
      });
      setAmount("");
      reveal.hide();
      await Promise.all([refetchWallet(), refetchUnderlying()]);
    }
  };

  const onFinalize = async () => {
    if (!pendingRequestId) return;
    const hash = await finalize(pendingRequestId);
    if (hash) {
      notify({
        title: "Unwrap completed",
        description: "The public tokens have been released.",
        tone: "verified",
        txHash: hash,
      });
      await Promise.all([refetchWallet(), refetchUnderlying()]);
    }
  };

  return (
    <Card className={cn("p-7 sm:p-8", className)}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-eyebrow">Convert back to {uSymbol}</p>
          <p className="mt-2 max-w-[52ch] text-[13px] leading-relaxed text-[var(--color-secondary)]">
            Unwrapping turns {symbol} back into the public token. Do this after withdrawing from
            Sable, when you want the value outside the confidential system.
          </p>
        </div>
      </div>

      {blockedReason ? (
        <p className="mt-5 text-[13px] leading-relaxed text-[var(--color-caution)]">{blockedReason}</p>
      ) : pendingRequestId ? (
        // A burned-but-unreleased request. The tokens are not lost; they are waiting.
        <div className="surface-inset mt-6 p-5">
          <p className="text-[13px] font-medium text-[var(--color-caution)]">
            You have an unwrap waiting to be completed
          </p>
          <p className="mt-2 text-[12px] leading-relaxed text-[var(--color-tertiary)]">
            The confidential amount was already burned, but the public tokens have not been
            released yet. Nothing is lost — finish the release to receive them.
          </p>
          <div className="mt-4">
            <Button size="sm" onClick={onFinalize} loading={isBusy}>
              Complete the unwrap
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="mt-6 flex items-end justify-between gap-4">
            <div>
              <p className="text-eyebrow">Wrapped balance</p>
              <div className="mt-2.5">
                <ConfidentialValue
                  state={reveal.state}
                  value={available}
                  error={reveal.error}
                  size="sm"
                />
              </div>
            </div>
            <RevealButton
              state={reveal.state}
              onReveal={reveal.reveal}
              onHide={reveal.hide}
              labelReveal="Reveal"
              labelHide="Hide"
            />
          </div>

          <div className="mt-6">
            <CurrencyInput
              label={`Amount to unwrap`}
              value={amount}
              onChange={setAmount}
              max={available}
              error={amountError}
              disabled={isBusy}
              hint={
                available === null
                  ? "Reveal your wrapped balance to enable Max and amount checks."
                  : parsed
                    ? `Releases ${formatUnits(unwrappedAmountFor(parsed, info.rate), decimals)} ${uSymbol}.`
                    : undefined
              }
            />
          </div>

          <div className="mt-6">
            <Button
              size="lg"
              fullWidth
              onClick={onUnwrap}
              loading={isBusy}
              disabled={!parsed || Boolean(amountError)}
            >
              Unwrap to {uSymbol}
            </Button>
          </div>
        </>
      )}

      {isBusy && stage !== "idle" ? (
        <div role="status" aria-live="polite" className="surface-inset mt-5 p-4">
          <div className="flex items-center gap-3">
            <span aria-hidden="true" className="relative flex h-2 w-2 shrink-0 items-center justify-center">
              <span className="pulse-ring absolute inset-0" />
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]" />
            </span>
            <p className="text-[13px] font-medium text-[var(--color-primary)]">
              {UNWRAP_STAGE_COPY[stage]}
            </p>
          </div>

          {/* Four discrete stages, not a fake percentage. */}
          <div className="mt-4 flex gap-1.5 pl-5">
            {(["encrypting", "requesting", "decrypting", "finalizing"] as const).map((step, index) => {
              const order = ["encrypting", "requesting", "decrypting", "finalizing"];
              const active = order.indexOf(stage) >= index;
              return (
                <span
                  key={step}
                  className={cn(
                    "h-[2px] flex-1 rounded-full transition-colors duration-500",
                    active ? "bg-[var(--color-accent)]" : "bg-[var(--color-elevated)]",
                  )}
                />
              );
            })}
          </div>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="mt-5 text-[13px] text-[var(--color-danger)]">
          {error}
        </p>
      ) : null}

      <PrivacyNote className="mt-6">
        The released amount becomes public — it has to, since it arrives as an ordinary ERC-20
        transfer. Your remaining balance stays encrypted.
      </PrivacyNote>
    </Card>
  );
}
